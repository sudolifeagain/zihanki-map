// OpenStreetMap Nominatim を使った施設名・駅名の緯度経度検索。
//
// 利用規約(https://operations.osmfoundation.org/policies/nominatim/)の要求:
//  - 毎秒1リクエストまで        → geocode_throttle で送信間隔を守る
//  - 結果をキャッシュすること    → geocode_cache に保存し、同じ検索で上流を叩かない
//  - アプリを識別する User-Agent → ブラウザからは送れないのでWorkerが送る
//  - オートコンプリート禁止      → 明示的な検索操作のときだけ呼ぶ(UI側で担保)
//  - 帰属表示                   → 画面に表示する

const UPSTREAM = 'https://nominatim.openstreetmap.org/search'
const USER_AGENT =
  'zihanki-map/0.1 (https://github.com/sudolifeagain/zihanki-map)'
const MIN_UPSTREAM_INTERVAL_MS = 1_100
const MAX_QUERY_LENGTH = 120
const MAX_CACHE_ROWS = 1_000

export interface GeocodeResult {
  lat: number
  lng: number
  displayName: string
}

export type GeocodeOutcome =
  | { kind: 'found'; result: GeocodeResult; cached: boolean }
  | { kind: 'not_found' }
  | { kind: 'busy' }
  | { kind: 'upstream_error' }

interface CacheRow {
  lat: number | null
  lng: number | null
  display_name: string | null
  found: number
}

function normalizeQuery(query: string): string {
  return query.trim().replace(/\s+/g, ' ').slice(0, MAX_QUERY_LENGTH).toLowerCase()
}

async function readCache(db: D1Database, key: string): Promise<GeocodeOutcome | undefined> {
  const row = await db
    .prepare('SELECT lat, lng, display_name, found FROM geocode_cache WHERE query = ?')
    .bind(key)
    .first<CacheRow>()

  if (!row) return undefined
  if (row.found === 0 || row.lat === null || row.lng === null) return { kind: 'not_found' }

  return {
    kind: 'found',
    cached: true,
    result: { lat: row.lat, lng: row.lng, displayName: row.display_name ?? '' },
  }
}

/** 上流へ問い合わせて良ければ true を返し、同時に送信時刻を記録する。 */
async function reserveUpstreamSlot(db: D1Database): Promise<boolean> {
  const now = new Date()
  const threshold = new Date(now.getTime() - MIN_UPSTREAM_INTERVAL_MS).toISOString()

  // 直前の送信から十分に間隔が空いている場合だけ書き換わる。
  const result = await db
    .prepare(
      'INSERT INTO geocode_throttle (id, last_request_at) VALUES (1, ?) ' +
        'ON CONFLICT(id) DO UPDATE SET last_request_at = excluded.last_request_at ' +
        'WHERE geocode_throttle.last_request_at < ?',
    )
    .bind(now.toISOString(), threshold)
    .run()

  return (result.meta.changes ?? 0) > 0
}

async function writeCache(
  db: D1Database,
  key: string,
  result: GeocodeResult | undefined,
): Promise<void> {
  await db
    .prepare(
      'INSERT INTO geocode_cache (query, lat, lng, display_name, found) VALUES (?, ?, ?, ?, ?) ' +
        'ON CONFLICT(query) DO UPDATE SET lat = excluded.lat, lng = excluded.lng, ' +
        'display_name = excluded.display_name, found = excluded.found',
    )
    .bind(key, result?.lat ?? null, result?.lng ?? null, result?.displayName ?? null, result ? 1 : 0)
    .run()

  // 匿名の検索でキャッシュが無制限に増えないよう、古い行から捨てる。
  await db
    .prepare(
      'DELETE FROM geocode_cache WHERE query IN (' +
        'SELECT query FROM geocode_cache ORDER BY created_at DESC LIMIT -1 OFFSET ?)',
    )
    .bind(MAX_CACHE_ROWS)
    .run()
}

export async function geocode(db: D1Database, query: string): Promise<GeocodeOutcome> {
  const key = normalizeQuery(query)
  if (!key) return { kind: 'not_found' }

  const cached = await readCache(db, key)
  if (cached) return cached

  if (!(await reserveUpstreamSlot(db))) return { kind: 'busy' }

  const url = new URL(UPSTREAM)
  url.searchParams.set('q', key)
  url.searchParams.set('format', 'jsonv2')
  url.searchParams.set('limit', '1')
  url.searchParams.set('accept-language', 'ja')

  let payload: { lat?: string; lon?: string; display_name?: string }[]
  try {
    const response = await fetch(url, {
      headers: { 'user-agent': USER_AGENT, accept: 'application/json' },
    })
    if (!response.ok) return { kind: 'upstream_error' }
    payload = await response.json()
  } catch {
    return { kind: 'upstream_error' }
  }

  const first = Array.isArray(payload) ? payload[0] : undefined
  const lat = Number(first?.lat)
  const lng = Number(first?.lon)

  if (!first || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    await writeCache(db, key, undefined)
    return { kind: 'not_found' }
  }

  const result: GeocodeResult = {
    lat,
    lng,
    displayName: first.display_name ?? query.trim(),
  }
  await writeCache(db, key, result)
  return { kind: 'found', result, cached: false }
}
