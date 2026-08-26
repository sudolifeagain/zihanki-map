import type { Env } from './env'

/** 同一端末が同じ自販機へ連続投稿できない間隔。 */
export const MACHINE_COOLDOWN_SECONDS = 180
/** 同一端末が全体で投稿できる1時間あたりの上限。 */
export const HOURLY_POST_LIMIT = 20

/**
 * IPを生のまま保存しないためのハッシュ。
 * ソルトが未設定なら undefined を返す。IPv4は総数が少なく、ソルト無しのハッシュは
 * 総当たりで元に戻せてしまうため、その場合は保存しない。
 */
export async function hashIp(env: Env, request: Request): Promise<string | undefined> {
  const salt = env.IP_HASH_SALT
  if (!salt) return undefined

  const ip = request.headers.get('cf-connecting-ip')
  if (!ip) return undefined

  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`${salt}:${ip}`),
  )
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

export interface RateLimitVerdict {
  allowed: boolean
  reason?: 'machine_cooldown' | 'hourly_limit'
  retryAfterSeconds?: number
}

/**
 * 匿名セッションとIPハッシュの両方を見て、自販機単位のクールダウンと
 * 1時間あたりの投稿数を制限する。
 */
export async function checkReportRateLimit(
  db: D1Database,
  machineId: string,
  sessionId: string,
  ipHash: string | undefined,
): Promise<RateLimitVerdict> {
  const cooldownSince = new Date(Date.now() - MACHINE_COOLDOWN_SECONDS * 1000).toISOString()
  const hourSince = new Date(Date.now() - 3_600_000).toISOString()

  const recentForMachine = await db
    .prepare(
      'SELECT created_at FROM inventory_reports WHERE machine_id = ? AND created_at > ? ' +
        'AND (reporter_session_id = ? OR (? IS NOT NULL AND reporter_ip_hash = ?)) ' +
        'ORDER BY created_at DESC LIMIT 1',
    )
    .bind(machineId, cooldownSince, sessionId, ipHash ?? null, ipHash ?? null)
    .first<{ created_at: string }>()

  if (recentForMachine) {
    const elapsedSeconds = Math.floor(
      (Date.now() - new Date(recentForMachine.created_at).getTime()) / 1000,
    )
    return {
      allowed: false,
      reason: 'machine_cooldown',
      retryAfterSeconds: Math.max(1, MACHINE_COOLDOWN_SECONDS - elapsedSeconds),
    }
  }

  const hourly = await db
    .prepare(
      'SELECT COUNT(*) AS count FROM inventory_reports WHERE created_at > ? ' +
        'AND (reporter_session_id = ? OR (? IS NOT NULL AND reporter_ip_hash = ?))',
    )
    .bind(hourSince, sessionId, ipHash ?? null, ipHash ?? null)
    .first<{ count: number }>()

  if ((hourly?.count ?? 0) >= HOURLY_POST_LIMIT) {
    return { allowed: false, reason: 'hourly_limit', retryAfterSeconds: 600 }
  }

  return { allowed: true }
}
