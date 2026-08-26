import type {
  DemandInsight,
  InventoryReport,
  Product,
  ProductId,
  StockStatus,
  VendingMachine,
} from './types'

const FRESH_REPORT_MINUTES = 30

export function minutesSince(isoDate: string, now = new Date()): number {
  return Math.max(
    0,
    Math.floor((now.getTime() - new Date(isoDate).getTime()) / 60_000),
  )
}

export function formatFreshness(isoDate?: string, now = new Date()): string {
  if (!isoDate) return 'まだ確認なし'
  const minutes = minutesSince(isoDate, now)
  if (minutes < 1) return 'たった今'
  if (minutes < 60) return `${minutes}分前に確認`
  return `${Math.floor(minutes / 60)}時間前に確認`
}

export function latestReport(
  reports: InventoryReport[],
  machineId: string,
  productId: ProductId,
): InventoryReport | undefined {
  return reports
    .filter(
      (report) =>
        report.machineId === machineId && report.productId === productId,
    )
    .sort(
      (a, b) =>
        new Date(b.observedAt).getTime() - new Date(a.observedAt).getTime(),
    )[0]
}

export function deriveStockStatus(
  machine: VendingMachine,
  productId: ProductId,
  reports: InventoryReport[],
  now = new Date(),
): StockStatus {
  const latest = latestReport(reports, machine.id, productId)
  if (latest && minutesSince(latest.observedAt, now) <= FRESH_REPORT_MINUTES) {
    return latest.type
  }
  return machine.stock[productId] ?? 'unknown'
}

export function findAlternatives(
  machines: VendingMachine[],
  reports: InventoryReport[],
  productId: ProductId,
  excludedMachineId: string,
  now = new Date(),
): VendingMachine[] {
  return machines
    .filter(
      (machine) =>
        machine.id !== excludedMachineId &&
        deriveStockStatus(machine, productId, reports, now) === 'available',
    )
    .sort((a, b) => a.distanceMeters - b.distanceMeters)
}

export function buildDemandInsights(
  reports: InventoryReport[],
  machines: VendingMachine[],
  products: Product[],
): DemandInsight[] {
  const counts = new Map<string, number>()
  for (const report of reports) {
    if (report.type !== 'sold_out') continue
    const key = `${report.machineId}:${report.productId}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }

  return [...counts.entries()]
    .map(([key, count]) => {
      const [machineId, productId] = key.split(':') as [string, ProductId]
      const product = products.find((item) => item.id === productId)
      const machine = machines.find((item) => item.id === machineId)
      if (!product || !machine) return undefined

      const estimatedMissedSales = Math.ceil(count * 0.65)
      return {
        machineId,
        productId,
        reports: count,
        estimatedMissedSales,
        potentialRevenue: estimatedMissedSales * product.price,
        priority: count >= 3 ? 'high' : count >= 2 ? 'medium' : 'low',
      } satisfies DemandInsight
    })
    .filter((item): item is DemandInsight => Boolean(item))
    .sort((a, b) => b.reports - a.reports)
}
