import type {
  ExperienceOutcome,
  ExperienceReason,
  ProductId,
  StockStatus,
} from '../src/types'
import {
  insertExperience,
  insertReports,
  listExperiences,
  listMachines,
  listProductIds,
  listProducts,
  listReports,
  machineExists,
} from './db'
import type { Env } from './env'
import { resolveSessionId, sessionSetCookieHeader } from './session'

const REPORT_STATUSES = new Set<StockStatus>(['available', 'low', 'sold_out'])
const EXPERIENCE_REASONS = new Set<ExperienceReason>([
  'sold_out',
  'not_found',
  'payment_issue',
])
const EXPERIENCE_OUTCOMES = new Set<ExperienceOutcome>([
  'another_machine',
  'convenience_store',
  'different_product',
  'gave_up',
])

const DEFAULT_LIST_LIMIT = 300
const MAX_LIST_LIMIT = 1000

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

function errorResponse(status: number, message: string): Response {
  return json({ error: message }, status)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function readJsonBody(request: Request): Promise<unknown> {
  const text = await request.text()
  if (!text) return undefined
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

function parseLimit(url: URL): number {
  const raw = url.searchParams.get('limit')
  if (!raw) return DEFAULT_LIST_LIMIT
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIST_LIMIT
  return Math.min(parsed, MAX_LIST_LIMIT)
}

async function handleGetMachines(env: Env): Promise<Response> {
  const [machines, products] = await Promise.all([
    listMachines(env.DB),
    listProducts(env.DB),
  ])
  return json({ machines, products })
}

async function handleGetReports(env: Env, url: URL): Promise<Response> {
  const reports = await listReports(env.DB, parseLimit(url))
  return json({ reports })
}

async function handlePostReports(
  env: Env,
  request: Request,
  sessionId: string,
): Promise<Response> {
  const body = await readJsonBody(request)
  if (!isRecord(body)) return errorResponse(400, 'invalid_body')

  const machineId = body.machineId
  if (typeof machineId !== 'string' || !machineId) {
    return errorResponse(400, 'machineId_required')
  }
  if (!(await machineExists(env.DB, machineId))) {
    return errorResponse(404, 'machine_not_found')
  }

  const statuses = body.statuses
  if (!isRecord(statuses)) return errorResponse(400, 'statuses_required')

  const validProductIds = await listProductIds(env.DB)
  const entries: { productId: ProductId; status: Exclude<StockStatus, 'unknown'> }[] = []
  for (const [productId, status] of Object.entries(statuses)) {
    if (status === 'unknown') continue
    if (!validProductIds.has(productId)) {
      return errorResponse(400, `unknown_product:${productId}`)
    }
    if (typeof status !== 'string' || !REPORT_STATUSES.has(status as StockStatus)) {
      return errorResponse(400, `invalid_status:${productId}`)
    }
    entries.push({ productId: productId as ProductId, status: status as Exclude<StockStatus, 'unknown'> })
  }

  if (entries.length === 0) return errorResponse(400, 'no_reportable_statuses')

  const reports = await insertReports(env.DB, machineId, entries, sessionId)
  return json({ reports }, 201)
}

async function handleGetExperiences(env: Env, url: URL): Promise<Response> {
  const experiences = await listExperiences(env.DB, parseLimit(url))
  return json({ experiences })
}

async function handlePostExperiences(
  env: Env,
  request: Request,
  sessionId: string,
): Promise<Response> {
  const body = await readJsonBody(request)
  if (!isRecord(body)) return errorResponse(400, 'invalid_body')

  const { machineId, wantedProductId, reason, outcome } = body
  if (typeof machineId !== 'string' || !machineId) {
    return errorResponse(400, 'machineId_required')
  }
  if (!(await machineExists(env.DB, machineId))) {
    return errorResponse(404, 'machine_not_found')
  }
  if (typeof wantedProductId !== 'string' || !wantedProductId) {
    return errorResponse(400, 'wantedProductId_required')
  }
  const validProductIds = await listProductIds(env.DB)
  if (!validProductIds.has(wantedProductId)) {
    return errorResponse(400, 'unknown_product')
  }
  if (typeof reason !== 'string' || !EXPERIENCE_REASONS.has(reason as ExperienceReason)) {
    return errorResponse(400, 'invalid_reason')
  }
  if (typeof outcome !== 'string' || !EXPERIENCE_OUTCOMES.has(outcome as ExperienceOutcome)) {
    return errorResponse(400, 'invalid_outcome')
  }

  const experience = await insertExperience(
    env.DB,
    {
      machineId,
      wantedProductId: wantedProductId as ProductId,
      reason: reason as ExperienceReason,
      outcome: outcome as ExperienceOutcome,
    },
    sessionId,
  )
  return json({ experience }, 201)
}

async function routeApi(
  request: Request,
  env: Env,
  url: URL,
  sessionId: string,
): Promise<Response> {
  const { pathname } = url

  if (pathname === '/api/machines' && request.method === 'GET') {
    return handleGetMachines(env)
  }
  if (pathname === '/api/reports' && request.method === 'GET') {
    return handleGetReports(env, url)
  }
  if (pathname === '/api/reports' && request.method === 'POST') {
    return handlePostReports(env, request, sessionId)
  }
  if (pathname === '/api/experiences' && request.method === 'GET') {
    return handleGetExperiences(env, url)
  }
  if (pathname === '/api/experiences' && request.method === 'POST') {
    return handlePostExperiences(env, request, sessionId)
  }

  return errorResponse(404, 'not_found')
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (!url.pathname.startsWith('/api/')) {
      return env.ASSETS.fetch(request)
    }

    const { sessionId, isNew } = resolveSessionId(request)
    let response: Response
    try {
      response = await routeApi(request, env, url, sessionId)
    } catch (error) {
      console.error('api_error', error)
      response = errorResponse(500, 'internal_error')
    }

    if (isNew) {
      response.headers.append('Set-Cookie', sessionSetCookieHeader(sessionId))
    }
    return response
  },
} satisfies ExportedHandler<Env>
