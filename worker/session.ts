const SESSION_COOKIE = 'zihanki_session'
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 365

function readSessionCookie(request: Request): string | undefined {
  const cookie = request.headers.get('cookie')
  if (!cookie) return undefined
  for (const part of cookie.split(';')) {
    const [rawKey, ...rawValue] = part.trim().split('=')
    if (rawKey === SESSION_COOKIE) return rawValue.join('=')
  }
  return undefined
}

export function resolveSessionId(request: Request): {
  sessionId: string
  isNew: boolean
} {
  const existing = readSessionCookie(request)
  if (existing) return { sessionId: existing, isNew: false }
  return { sessionId: crypto.randomUUID(), isNew: true }
}

export function sessionSetCookieHeader(sessionId: string): string {
  return `${SESSION_COOKIE}=${sessionId}; Path=/; Max-Age=${SESSION_MAX_AGE_SECONDS}; HttpOnly; Secure; SameSite=Lax`
}
