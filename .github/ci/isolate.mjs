// Standalone public-target CI supervisor. No imports from the private management repository.
// Run THIS file from the trusted PR base checkout; the other checkout is data only.
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = code => { throw Error(code); };
const stable = value => value && typeof value === 'object'
  ? Array.isArray(value) ? value.map(stable) : Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
const equal = (a, b) => JSON.stringify(stable(a)) === JSON.stringify(stable(b));
function manifest(value, baseline) {
  if (!value || Array.isArray(value) || typeof value !== 'object' || value.workspaces || value.bundleDependencies || value.bundledDependencies) fail('unsupported_manifest');
  for (const key of new Set([...Object.keys(value), ...Object.keys(baseline)])) {
    if (!['dependencies', 'devDependencies', 'optionalDependencies'].includes(key) && !equal(value[key], baseline[key])) fail('manifest_policy_changed');
  }
  if (value.scripts?.test !== 'vitest run' || value.scripts?.build !== 'tsc -b && vite build') fail('unsupported_test_commands');
  for (const group of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    const values = value[group] ?? {};
    if (!values || Array.isArray(values) || typeof values !== 'object') fail('unsupported_dependency');
    for (const [name, version] of Object.entries(values)) {
      if (!/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(name) || typeof version !== 'string'
        || !/^[0-9^~*<>=|. +xv-]{1,128}$/.test(version)) fail('unsupported_dependency');
    }
  }
}
function lockfile(value, packageJson) {
  if (!value || value.lockfileVersion !== 3 || !value.packages || Array.isArray(value.packages)
    || Object.keys(value.packages).length < 2 || Object.keys(value.packages).length > 1001) fail('unsupported_lockfile');
  const root = value.packages[''];
  if (!root || ['dependencies', 'devDependencies', 'optionalDependencies'].some(key => !equal(root[key] ?? {}, packageJson[key] ?? {}))) fail('root_lock_mismatch');
  for (const [path, entry] of Object.entries(value.packages)) {
    if (path === '') continue;
    if (!/^node_modules\/(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*(?:\/node_modules\/(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*)*$/.test(path)
      || !entry || entry.link || entry.inBundle || entry.bundleDependencies || entry.bundledDependencies
      || typeof entry.version !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(entry.version)
      || typeof entry.integrity !== 'string' || !/^sha512-[A-Za-z0-9+/]{86}==$/.test(entry.integrity)) fail('unsupported_locked_dependency');
    const name = path.slice(path.lastIndexOf('node_modules/') + 13), plain = name.split('/').at(-1);
    let url; try { url = new URL(entry.resolved); } catch { fail('unsupported_package_url'); }
    if (url.origin !== 'https://registry.npmjs.org' || url.username || url.password || url.port || url.search || url.hash
      || decodeURIComponent(url.pathname) !== '/' + name + '/-/' + plain + '-' + entry.version + '.tgz') fail('unsupported_package_url');
  }
}
async function bytes(path, max = 1024 * 1024) {
  const info = await lstat(path); if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size < 1 || info.size > max) fail('unsafe_input_file');
  return await readFile(path);
}
async function sourceFiles(source, baseline) {
  let count = 0, size = 0; const output = [];
  async function walk(folder, prefix = '') {
    for (const name of (await readdir(folder)).sort()) {
      if (!prefix && name === '.git') continue;
      if (name === 'node_modules' || name === '.npmrc' || !/^[A-Za-z0-9_@.()[\]-]+$/.test(name)) fail('unsafe_source_path');
      const path = join(folder, name), key = prefix + name, info = await lstat(path);
      if (info.isSymbolicLink() || !info.isDirectory() && !info.isFile() || info.isFile() && info.nlink !== 1) fail('unsafe_source_path');
      if (info.isDirectory()) await walk(path, key + '/');
      else {
        if (++count > 100000 || info.size > 10 * 1024 * 1024 || (size += info.size) > 64 * 1024 * 1024) fail('source_limit');
        const content = await readFile(path);
        if (/^(?:\.env(?:\..*)?|\.dev\.vars(?:\..*)?)$/.test(name)) {
          if (!name.endsWith('.example') || !content.equals(await bytes(join(baseline, key)))) fail('secret_source_file');
        }
        output.push({ path, key, content });
      }
    }
  }
  await walk(source); return output;
}
async function processRun(executable, args, env, timeout = 15 * 60 * 1000, max = 4 * 1024 * 1024) {
  return await new Promise((accept, reject) => {
    const child = spawn(executable, args, { env, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    let count = 0, finished = false; const chunks = [], errors = [];
    const stop = code => { if (finished) return; finished = true; child.kill('SIGKILL'); clearTimeout(timer); reject(Error(code)); };
    const timer = setTimeout(() => stop('ci_process_timeout'), timeout);
    for (const [stream, target] of [[child.stdout, chunks], [child.stderr, errors]]) stream.on('data', chunk => {
      count += chunk.length; if (count > max) stop('ci_output_limit'); else target.push(chunk);
    });
    child.once('error', () => stop('ci_process_unavailable'));
    child.once('close', code => { if (!finished) { finished = true; clearTimeout(timer);
      if (code !== 0) reject(Error('ci_process_failed:' + sha(Buffer.concat([...chunks,...errors])))); else accept(Buffer.concat(chunks).toString('utf8')); } });
  });
}
// Only the fixed npm implementation runs in the networked phase. No repository config, hooks, credential or candidate program is present.
const installer = String.raw`
import {copyFileSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
copyFileSync('/inputs/package.json','/work/package.json');copyFileSync('/inputs/package-lock.json','/work/package-lock.json');
writeFileSync('/tmp/user.npmrc','');writeFileSync('/tmp/global.npmrc','');
const env={PATH:'/usr/local/bin:/usr/bin:/bin',HOME:'/tmp',CI:'true',LANG:'C.UTF-8',npm_config_userconfig:'/tmp/user.npmrc',
 npm_config_globalconfig:'/tmp/global.npmrc',npm_config_registry:'https://registry.npmjs.org/',npm_config_cache:'/tmp/cache',
 npm_config_ignore_scripts:'true',npm_config_audit:'false',npm_config_fund:'false',npm_config_git:'/usr/bin/false'};
const result=spawnSync('/usr/local/bin/npm',['ci','--ignore-scripts','--no-audit','--no-fund','--registry=https://registry.npmjs.org/'],
 {cwd:'/work',env,stdio:'pipe',timeout:600000,maxBuffer:4*1024*1024});
if(result.status!==0)throw Error('isolated_install_failed');
`;
const supervisor = String.raw`
import {spawn} from 'node:child_process';
import {cpSync,readFileSync,writeFileSync,lstatSync,unlinkSync} from 'node:fs';
if(process.pid!==1||process.getuid()!==0||!/^24\./.test(process.versions.node))throw Error('invalid_supervisor');
unlinkSync('/work/package.json');unlinkSync('/work/package-lock.json');
cpSync('/inputs/source','/work',{recursive:true,dereference:false});
writeFileSync('/tmp/user.npmrc','',{mode:0o444});writeFileSync('/tmp/global.npmrc','',{mode:0o444});
const env={PATH:'/usr/local/bin:/usr/bin:/bin',HOME:'/tmp',CI:'true',LANG:'C.UTF-8',TZ:'UTC',npm_config_userconfig:'/tmp/user.npmrc',
 npm_config_globalconfig:'/tmp/global.npmrc',npm_config_registry:'https://registry.npmjs.org/',npm_config_cache:'/tmp/cache',
 npm_config_ignore_scripts:'true',npm_config_offline:'true',npm_config_audit:'false',npm_config_fund:'false',WRANGLER_SEND_METRICS:'false',
 CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV:'false'};
async function run(args){await new Promise((accept,reject)=>{
 const child=spawn('/usr/local/bin/npm',args,{cwd:'/work',env,uid:65532,gid:65532,shell:false,detached:true,stdio:['ignore','pipe','pipe']});
 let count=0,bad=false;const kill=()=>{try{process.kill(-1,'SIGKILL')}catch(e){if(e.code!=='ESRCH')throw e}};
 const stop=()=>{bad=true;kill()};const timer=setTimeout(stop,600000);
 for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>{if((count+=chunk.length)>4*1024*1024)stop()});
 child.once('error',stop);child.once('close',code=>{clearTimeout(timer);kill();if(bad||code!==0)reject(Error('isolated_check_failed'));else accept()});
})}
await run(['run','test','--ignore-scripts','--','--run','--reporter=json','--outputFile=/work/native-ci-results.json']);
const info=lstatSync('/work/native-ci-results.json');if(!info.isFile()||info.nlink!==1||info.size>4*1024*1024)throw Error('invalid_test_report');
const report=JSON.parse(readFileSync('/work/native-ci-results.json','utf8')),n=report.numTotalTests;
if(!Number.isSafeInteger(n)||n<1||n>100000||report.success!==true||report.numPassedTests!==n||report.numFailedTests!==0
 ||report.numPendingTests!==0||report.numTodoTests!==0||!Array.isArray(report.testResults)||!report.testResults.length
 ||report.testResults.some(suite=>suite.status!=='passed'||!Array.isArray(suite.assertionResults))
 ||report.testResults.flatMap(suite=>suite.assertionResults).length!==n
 ||report.testResults.flatMap(suite=>suite.assertionResults).some(test=>test.status!=='passed'))throw Error('invalid_test_report');
await run(['run','build','--ignore-scripts']);process.stdout.write(JSON.stringify({tests:n,build:true})+'\n');
`;
export function nativeCiContainerArguments(image, folder, name, stage) {
  if (!/^node@sha256:[a-f0-9]{64}$/.test(image) || typeof folder !== 'string' || !folder.length || /[,\r\n\0]/.test(folder)
    || !/^native-ci-[a-f0-9]{32}$/.test(name) || !['install','test'].includes(stage)) fail('invalid_container_profile');
  const common = ['--rm','--pull=never','--read-only','--pids-limit=512','--memory=4g','--memory-swap=4g','--cpus=2','--cap-drop=ALL',
    '--security-opt=no-new-privileges','--tmpfs=/tmp:rw,nosuid,nodev,size=1073741824,mode=1777',
    '--mount=type=volume,source='+name+',target=/work,volume-nocopy','--workdir=/work','--entrypoint=/usr/local/bin/node'];
  return stage === 'install' ? ['run','--name='+name+'-install','--user=65532:65532',...common,
    '--mount=type=bind,source='+join(folder,'install')+',target=/inputs,readonly',image,'/inputs/install.mjs']
    : ['run','--name='+name+'-test','--network=none','--user=0:0',...common,'--cap-add=SETUID','--cap-add=SETGID','--cap-add=KILL',
      '--mount=type=bind,source='+folder+',target=/inputs,readonly',image,'/inputs/supervisor.mjs'];
}
export function nativeCiAnchorArguments(image, name) {
  if (!/^node@sha256:[a-f0-9]{64}$/.test(image) || !/^native-ci-[a-f0-9]{32}$/.test(name)) fail('invalid_container_profile');
  // A tmpfs volume vanishes when its final mount disappears. Keep this inert, credential-free holder until BOTH phases finish.
  return ['run','-d','--name='+name+'-cache','--pull=never','--read-only','--network=none','--user=65532:65532',
    '--cap-drop=ALL','--security-opt=no-new-privileges','--pids-limit=16','--memory=64m','--cpus=0.1',
    '--mount=type=volume,source='+name+',target=/work,volume-nocopy','--entrypoint=/usr/local/bin/node',image,'-e','setInterval(()=>{},60000)'];
}
export { manifest as validateNativeCiManifest, lockfile as validateNativeCiLockfile, installer as nativeCiInstaller, supervisor as nativeCiSupervisor };
async function main() {
  const [candidatePath, ...extra] = process.argv.slice(2), image = process.env.ISOLATED_NODE_IMAGE;
  if (!candidatePath || extra.length || process.env.GITHUB_REPOSITORY_ID !== '1346997039'
    || !['pull_request', 'push'].includes(process.env.GITHUB_EVENT_NAME) || !/^24\./.test(process.versions.node)
    || !/^node@sha256:[a-f0-9]{64}$/.test(image ?? '') || !/^[a-f0-9]{40}$/.test(process.env.SUBJECT_SHA ?? '')
    || !/^[a-f0-9]{40}$/.test(process.env.TRUSTED_BASE_SHA ?? '')) fail('native_ci_context_untrusted');
  const candidate = await realpath(candidatePath), baseline = await realpath(resolve(dirname(fileURLToPath(import.meta.url)), '../..'));
  if (basename(candidate) !== 'candidate' || candidate === baseline || candidate.includes(',') || baseline.includes(',')) fail('unsafe_ci_workspace');
  const folder = await realpath(await mkdtemp(join(tmpdir(), 'isolated-native-ci-'))), name = 'native-ci-' + randomUUID().replaceAll('-', '');
  const env = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, HOME: folder, DOCKER_CONFIG: join(folder, 'docker'), GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null', GIT_NO_REPLACE_OBJECTS: '1', GIT_CONFIG_COUNT: '0' };
  if (process.platform === 'win32') env.DOCKER_HOST = 'npipe:////./pipe/dockerDesktopLinuxEngine';
  const docker = args => processRun('docker', args, env), git = path => processRun('git', ['-c', 'safe.directory=' + path, '-C', path, 'rev-parse', 'HEAD'], env, 30000, 1024);
  let volume = false;
  try {
    if ((await git(candidate)).trim() !== process.env.SUBJECT_SHA || (await git(baseline)).trim() !== process.env.TRUSTED_BASE_SHA) fail('ci_source_changed');
    const packageBytes = await bytes(join(candidate, 'package.json')), lockBytes = await bytes(join(candidate, 'package-lock.json'), 32 * 1024 * 1024);
    const packageJson = JSON.parse(packageBytes), lock = JSON.parse(lockBytes);
    manifest(packageJson, JSON.parse(await bytes(join(baseline, 'package.json')))); lockfile(lock, packageJson);
    const files = await sourceFiles(candidate, baseline);
    await chmod(folder,0o755);await mkdir(join(folder, 'source')); await mkdir(join(folder, 'docker'));await mkdir(join(folder,'install'));
    for (const file of files) { const path = join(folder, 'source', file.key); await mkdir(dirname(path), { recursive: true }); await writeFile(path, file.content, {flag:'wx',mode:0o444}); }
    await writeFile(join(folder, 'install','package.json'), packageBytes, {flag:'wx',mode:0o444});
    await writeFile(join(folder, 'install','package-lock.json'), lockBytes, {flag:'wx',mode:0o444});
    await writeFile(join(folder, 'install','install.mjs'), installer, {flag:'wx',mode:0o444});
    await writeFile(join(folder, 'supervisor.mjs'), supervisor, {flag:'wx',mode:0o444});
    await docker(['pull', image]);
    await docker(['volume','create','--driver=local','--opt=type=tmpfs','--opt=device=tmpfs','--opt=o=size=4294967296,uid=65532,gid=65532,mode=0777',name]); volume = true;
    await docker(nativeCiAnchorArguments(image,name));
    await docker(nativeCiContainerArguments(image,folder,name,'install'));
    const output = await docker(nativeCiContainerArguments(image,folder,name,'test'));
    const result = JSON.parse(output.trim()); if (!Number.isSafeInteger(result.tests) || result.tests < 1 || result.build !== true) fail('native_ci_result_untrusted');
    process.stdout.write(JSON.stringify({source_sha:process.env.SUBJECT_SHA,tests:result.tests,build:true,installation_hooks:false,candidate_network:false})+'\n');
  } finally {
    for (const suffix of ['-install','-test','-cache']) try { await docker(['rm','-f',name+suffix]); } catch {}
    if (volume) try { await docker(['volume','rm',name]); } catch {}
    if (dirname(folder) === await realpath(tmpdir()) && basename(folder).startsWith('isolated-native-ci-')) await rm(folder,{recursive:true,force:true});
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await main(); } catch (error) { process.stderr.write(JSON.stringify({error:/^[a-z0-9_:-]{1,160}$/.test(error.message)?error.message:'native_ci_failed'})+'\n'); process.exitCode=2; }
}
