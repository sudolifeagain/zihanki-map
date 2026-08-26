export type ProductId = 'water' | 'tea' | 'cola' | 'sports' | 'coffee'

export type StockStatus = 'available' | 'low' | 'sold_out' | 'unknown'

export type ReportType = 'available' | 'low' | 'sold_out'

export interface Product {
  id: ProductId
  name: string
  shortName: string
  brand: string
  price: number
  emoji: string
  color: string
}

export interface VendingMachine {
  id: string
  name: string
  area: string
  lat: number
  lng: number
  distanceMeters: number
  landmark: string
  photoUrl: string
  /** 掲載写真の撮影地がこの座標と一致するか。false のデモ写真は画面上で明示する。 */
  photoLocationMatches: boolean
  stock: Partial<Record<ProductId, StockStatus>>
}

export interface InventoryReport {
  id: string
  machineId: string
  productId: ProductId
  type: ReportType
  observedAt: string
  source: 'demo' | 'user' | 'vendor'
}

export interface DemandInsight {
  machineId: string
  productId: ProductId
  reports: number
  estimatedMissedSales: number
  potentialRevenue: number
  priority: 'high' | 'medium' | 'low'
}

export type ExperienceReason = 'sold_out' | 'not_found' | 'payment_issue'

export type ExperienceOutcome =
  | 'another_machine'
  | 'convenience_store'
  | 'different_product'
  | 'gave_up'

export interface PurchaseExperience {
  id: string
  machineId: string
  wantedProductId: ProductId
  reason: ExperienceReason
  outcome: ExperienceOutcome
  observedAt: string
}
