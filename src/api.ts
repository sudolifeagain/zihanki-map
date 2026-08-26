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
    throw new ApiError(`http_${response.status}`)
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
): Promise<{ reports: InventoryReport[] }> {
  return request('/api/reports', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ machineId, statuses }),
  })
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
