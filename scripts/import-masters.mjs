#!/usr/bin/env node
// data/*.csv の自販機・商品マスターをD1へ取り込む管理用スクリプト。
// コードを変更せずにマスターを追加・更新するための入口。
//
//   node scripts/import-masters.mjs            # ローカルD1
//   node scripts/import-masters.mjs --remote   # 本番D1
//   node scripts/import-masters.mjs --dry-run  # SQLを表示するだけ

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DB_NAME = 'zihanki-map-db'
const DUPLICATE_THRESHOLD_METERS = 15

const MACHINE_STATUSES = new Set(['active', 'hidden', 'removed', 'duplicate'])
const BASE_STATUSES = new Set(['available', 'low', 'sold_out', 'unknown'])

const args = process.argv.slice(2)
const isRemote = args.includes('--remote')
const isDryRun = args.includes('--dry-run')

/** RFC4180風のCSVパーサ。引用符つきフィールドと埋め込みカンマに対応する。 */
function parseCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let quoted = false

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]

    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 1
        } else {
          quoted = false
        }
      } else {
        field += char
      }
      continue
    }

    if (char === '"') {
      quoted = true
    } else if (char === ',') {
      row.push(field)
      field = ''
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i += 1
      row.push(field)
      field = ''
      if (row.some((cell) => cell !== '')) rows.push(row)
      row = []
    } else {
      field += char
    }
  }

  row.push(field)
  if (row.some((cell) => cell !== '')) rows.push(row)

  if (rows.length === 0) return []
  const header = rows[0].map((name) => name.trim())
  return rows.slice(1).map((cells) =>
    Object.fromEntries(header.map((name, column) => [name, (cells[column] ?? '').trim()])),
  )
}

function readCsv(name, { allowEmpty = false } = {}) {
  const path = join('data', name)
  const rows = parseCsv(readFileSync(path, 'utf8'))
  if (rows.length === 0 && !allowEmpty) throw new Error(`${path} に行がありません`)
  return rows
}

function sqlText(value) {
  return `'${String(value).replace(/'/g, "''")}'`
}

function sqlNumber(value, label) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) throw new Error(`${label}: 数値ではありません (${value})`)
  return String(parsed)
}

function distanceMeters(a, b) {
  const R = 6_371_000
  const toRad = (deg) => (deg * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

function findDuplicates(machines) {
  const active = machines.filter((machine) => machine.status === 'active')
  const pairs = []
  for (let i = 0; i < active.length; i += 1) {
    for (let j = i + 1; j < active.length; j += 1) {
      const meters = distanceMeters(active[i], active[j])
      if (meters < DUPLICATE_THRESHOLD_METERS) {
        pairs.push({ a: active[i].id, b: active[j].id, meters: Math.round(meters) })
      }
    }
  }
  return pairs
}

function buildStatements() {
  const products = readCsv('products.csv').map((row, index) => {
    for (const column of ['id', 'name', 'short_name', 'brand', 'price', 'emoji', 'color']) {
      if (!row[column]) throw new Error(`products.csv 行${index + 2}: ${column} が空です`)
    }
    return row
  })

  const machines = readCsv('machines.csv').map((row, index) => {
    const line = `machines.csv 行${index + 2}`
    for (const column of ['id', 'name', 'area', 'lat', 'lng', 'landmark', 'photo_url']) {
      if (!row[column]) throw new Error(`${line}: ${column} が空です`)
    }
    const status = row.status || 'active'
    if (!MACHINE_STATUSES.has(status)) throw new Error(`${line}: status が不正です (${status})`)
    const matches = row.photo_location_matches || '0'
    if (matches !== '0' && matches !== '1') {
      throw new Error(`${line}: photo_location_matches は 0 か 1 です (${matches})`)
    }
    return {
      ...row,
      status,
      photo_location_matches: matches,
      lat: Number(sqlNumber(row.lat, `${line}: lat`)),
      lng: Number(sqlNumber(row.lng, `${line}: lng`)),
    }
  })

  const productIds = new Set(products.map((product) => product.id))
  const machineIds = new Set(machines.map((machine) => machine.id))

  const links = readCsv('machine_products.csv').map((row, index) => {
    const line = `machine_products.csv 行${index + 2}`
    if (!machineIds.has(row.machine_id)) {
      throw new Error(`${line}: 未登録の machine_id (${row.machine_id})`)
    }
    if (!productIds.has(row.product_id)) {
      throw new Error(`${line}: 未登録の product_id (${row.product_id})`)
    }
    const status = row.base_status || 'unknown'
    if (!BASE_STATUSES.has(status)) throw new Error(`${line}: base_status が不正です (${status})`)
    return { ...row, base_status: status }
  })

  const duplicates = findDuplicates(machines)
  if (duplicates.length > 0) {
    const detail = duplicates
      .map((pair) => `  ${pair.a} と ${pair.b} が約${pair.meters}m以内`)
      .join('\n')
    throw new Error(
      `同一地点への重複登録を検出しました(閾値${DUPLICATE_THRESHOLD_METERS}m):\n${detail}\n` +
        'いずれかの status を duplicate / removed / hidden にしてください。',
    )
  }

  const statements = []

  for (const product of products) {
    statements.push(
      `INSERT INTO products (id, name, short_name, brand, price, emoji, color) VALUES (` +
        [
          sqlText(product.id),
          sqlText(product.name),
          sqlText(product.short_name),
          sqlText(product.brand),
          sqlNumber(product.price, `products.csv ${product.id}: price`),
          sqlText(product.emoji),
          sqlText(product.color),
        ].join(', ') +
        `) ON CONFLICT(id) DO UPDATE SET name = excluded.name, short_name = excluded.short_name, ` +
        `brand = excluded.brand, price = excluded.price, emoji = excluded.emoji, color = excluded.color;`,
    )
  }

  for (const machine of machines) {
    statements.push(
      `INSERT INTO vending_machines (id, name, area, lat, lng, distance_meters, landmark, photo_url, status, photo_location_matches, updated_at) VALUES (` +
        [
          sqlText(machine.id),
          sqlText(machine.name),
          sqlText(machine.area),
          String(machine.lat),
          String(machine.lng),
          sqlNumber(machine.distance_meters || '0', `machines.csv ${machine.id}: distance_meters`),
          sqlText(machine.landmark),
          sqlText(machine.photo_url),
          sqlText(machine.status),
          machine.photo_location_matches,
          `strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
        ].join(', ') +
        `) ON CONFLICT(id) DO UPDATE SET name = excluded.name, area = excluded.area, lat = excluded.lat, ` +
        `lng = excluded.lng, distance_meters = excluded.distance_meters, landmark = excluded.landmark, ` +
        `photo_url = excluded.photo_url, status = excluded.status, ` +
        `photo_location_matches = excluded.photo_location_matches, updated_at = excluded.updated_at;`,
    )
  }

  for (const link of links) {
    statements.push(
      `INSERT INTO machine_products (machine_id, product_id, base_status) VALUES (` +
        [sqlText(link.machine_id), sqlText(link.product_id), sqlText(link.base_status)].join(', ') +
        `) ON CONFLICT(machine_id, product_id) DO UPDATE SET base_status = excluded.base_status;`,
    )
  }

  const events = readCsv('events.csv', { allowEmpty: true }).map((row, index) => {
    const line = `events.csv 行${index + 2}`
    for (const column of ['id', 'name', 'starts_at', 'ends_at']) {
      if (!row[column]) throw new Error(`${line}: ${column} が空です`)
    }
    if (Number.isNaN(Date.parse(row.starts_at)) || Number.isNaN(Date.parse(row.ends_at))) {
      throw new Error(`${line}: starts_at / ends_at はISO 8601形式にしてください`)
    }
    if (Date.parse(row.ends_at) <= Date.parse(row.starts_at)) {
      throw new Error(`${line}: ends_at が starts_at より後になっていません`)
    }
    return row
  })

  // 実測値は空でもよい。無ければ画面上すべて「推定」と表示される。
  const actuals = readCsv('sales_actuals.csv', { allowEmpty: true }).map((row, index) => {
    const line = `sales_actuals.csv 行${index + 2}`
    if (!machineIds.has(row.machine_id)) {
      throw new Error(`${line}: 未登録の machine_id (${row.machine_id})`)
    }
    if (!productIds.has(row.product_id)) {
      throw new Error(`${line}: 未登録の product_id (${row.product_id})`)
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.observed_on)) {
      throw new Error(`${line}: observed_on は YYYY-MM-DD 形式にしてください (${row.observed_on})`)
    }
    return row
  })

  for (const event of events) {
    statements.push(
      `INSERT INTO events (id, name, starts_at, ends_at) VALUES (` +
        [sqlText(event.id), sqlText(event.name), sqlText(event.starts_at), sqlText(event.ends_at)].join(', ') +
        `) ON CONFLICT(id) DO UPDATE SET name = excluded.name, starts_at = excluded.starts_at, ` +
        `ends_at = excluded.ends_at;`,
    )
  }

  for (const actual of actuals) {
    statements.push(
      `INSERT INTO sales_actuals (machine_id, product_id, observed_on, units_sold, restock_units) VALUES (` +
        [
          sqlText(actual.machine_id),
          sqlText(actual.product_id),
          sqlText(actual.observed_on),
          sqlNumber(actual.units_sold || '0', `sales_actuals.csv ${actual.machine_id}: units_sold`),
          sqlNumber(actual.restock_units || '0', `sales_actuals.csv ${actual.machine_id}: restock_units`),
        ].join(', ') +
        `) ON CONFLICT(machine_id, product_id, observed_on) DO UPDATE SET ` +
        `units_sold = excluded.units_sold, restock_units = excluded.restock_units;`,
    )
  }

  return {
    statements,
    counts: {
      products: products.length,
      machines: machines.length,
      links: links.length,
      events: events.length,
      actuals: actuals.length,
    },
  }
}

const { statements, counts } = buildStatements()
const sql = `${statements.join('\n')}\n`

console.log(
  `商品 ${counts.products}件 / 自販機 ${counts.machines}件 / 取扱 ${counts.links}件 / ` +
    `イベント ${counts.events}件 / 実測 ${counts.actuals}件 を取り込みます` +
    ` (${isRemote ? '本番' : 'ローカル'}D1)`,
)

if (isDryRun) {
  console.log('\n--dry-run のためSQLを表示して終了します。\n')
  console.log(sql)
  process.exit(0)
}

const dir = mkdtempSync(join(tmpdir(), 'zihanki-masters-'))
const file = join(dir, 'import-masters.sql')
writeFileSync(file, sql, 'utf8')

// wrangler の .cmd シムは Windows で spawn できないため、JSの入口を直接nodeで実行する。
const wranglerBin = join('node_modules', 'wrangler', 'bin', 'wrangler.js')

execFileSync(
  process.execPath,
  [wranglerBin, 'd1', 'execute', DB_NAME, isRemote ? '--remote' : '--local', '--file', file],
  { stdio: 'inherit' },
)

console.log('取り込みが完了しました。')
