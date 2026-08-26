import type { AnalyticsEvent, SalesActual } from './analytics'
import type {
  ExperienceOutcome,
  ExperienceReason,
  InventoryReport,
  Product,
  ProductId,
  PurchaseExperience,
  StockStatus,
  VendingMachine,
} from './types'

export class ApiError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ApiError'
  }
}

async function request<T>(input: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(input, init)
  } catch {
    throw new ApiError('network_error')
  }
  if (!response.ok) {
    let reason = `http_${response.status}`
    try {
      const body = (await response.json()) as { error?: string }
      if (body.error) reason = body.error
    } catch {
      // JSON以外/空のエラーレスポンスはHTTPステータスのみで扱う
    }
    throw new ApiError(reason)
  }
  return (await response.json()) as T
}

export async function fetchMachines(): Promise<{
  machines: VendingMachine[]
  products: Product[]
}> {
  return request('/api/machines')
}

export async function fetchReports(): Promise<{ reports: InventoryReport[] }> {
  return request('/api/reports')
}

export async function fetchExperiences(): Promise<{
  experiences: PurchaseExperience[]
}> {
  return request('/api/experiences')
}

export async function postReports(
  machineId: string,
  statuses: Partial<Record<ProductId, StockStatus>>,
  photoId?: string,
): Promise<{ reports: InventoryReport[] }> {
  return request('/api/reports', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ machineId, statuses, photoId }),
  })
}

export interface UploadedPhoto {
  id: string
  machineId: string
  url: string
  createdAt: string
}

export async function uploadPhoto(
  machineId: string,
  file: File,
): Promise<{ photo: UploadedPhoto }> {
  const form = new FormData()
  form.append('machineId', machineId)
  form.append('file', file)
  return request('/api/photos', { method: 'POST', body: form })
}

export async function fetchAnalytics(): Promise<{
  events: AnalyticsEvent[]
  actuals: SalesActual[]
}> {
  return request('/api/analytics')
}

export interface GeocodedPlace {
  lat: number
  lng: number
  displayName: string
}

export async function geocodePlace(query: string): Promise<{ place: GeocodedPlace }> {
  return request(`/api/geocode?q=${encodeURIComponent(query)}`)
}

export interface AnalysisCandidate {
  productId: ProductId | null
  detectedName: string
  brand: string | null
  status: StockStatus
  confidence: number
}

export async function analyzePhoto(
  photoId: string,
): Promise<{ candidates: AnalysisCandidate[] }> {
  return request(`/api/photos/${photoId}/analyze`, { method: 'POST' })
}

export async function postExperience(input: {
  machineId: string
  wantedProductId: ProductId
  reason: ExperienceReason
  outcome: ExperienceOutcome
}): Promise<{ experience: PurchaseExperience }> {
  return request('/api/experiences', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
}
