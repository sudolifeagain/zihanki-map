import type {
  ExperienceOutcome,
  ExperienceReason,
  InventoryReport,
  Product,
  ProductId,
  PurchaseExperience,
  VendingMachine,
} from './types'

/** 販売・補充の実測値。CSVから取り込む。 */
export interface SalesActual {
  machineId: string
  productId: ProductId
  observedOn: string
  unitsSold: number
  restockUnits: number
}

export interface AnalyticsEvent {
  id: string
  name: string
  startsAt: string
  endsAt: string
}

export interface AnalyticsFilters {
  /** ISO 8601。未指定なら下限なし。 */
  from?: string
  to?: string
  machineId?: string
  productId?: ProductId
}

/**
 * 欠品投稿から推定取りこぼしを出すための仮係数。
 * 「欠品投稿の何割が実際の購買につながっていたか」の仮説で、実測ではない。
 */
export const DEFAULT_CONVERSION_RATE = 0.65

export interface DemandRow {
  machineId: string
  machineName: string
  productId: ProductId
  productName: string
  soldOutReports: number
  /** 推定値。仮係数を掛けた値。 */
  estimatedMissedSales: number
  estimatedRevenue: number
  /** 実測値。CSVが無ければ undefined。 */
  actualUnitsSold?: number
  actualRestockUnits?: number
  priority: 'high' | 'medium' | 'low'
}

export interface CountRow<T extends string> {
  key: T
  label: string
  count: number
}

export interface AnalyticsReport {
  rows: DemandRow[]
  soldOutReportCount: number
  experienceCount: number
  estimatedMissedSales: number
  estimatedRevenue: number
  /** 実測データがひとつも無ければ false。画面では常に「推定」と明示する。 */
  hasActuals: boolean
  actualUnitsSold?: number
  /** 時間帯(0〜23時)ごとの欠品投稿数。 */
  byHour: { hour: number; count: number }[]
  byReason: CountRow<ExperienceReason>[]
  byOutcome: CountRow<ExperienceOutcome>[]
  conversionRate: number
}

export const reasonLabels: Record<ExperienceReason, string> = {
  sold_out: '売り切れランプが点灯',
  not_found: 'ラインナップになかった',
  payment_issue: '決済できなかった',
}

export const outcomeLabels: Record<ExperienceOutcome, string> = {
  another_machine: '別の自販機で買った',
  convenience_store: 'コンビニで買った',
  different_product: '別の商品を買った',
  gave_up: '買うのを諦めた',
}

function withinPeriod(isoDate: string, filters: AnalyticsFilters): boolean {
  const time = new Date(isoDate).getTime()
  if (Number.isNaN(time)) return false
  if (filters.from && time < new Date(filters.from).getTime()) return false
  if (filters.to && time > new Date(filters.to).getTime()) return false
  return true
}

function countBy<T extends string>(
  items: T[],
  labels: Record<T, string>,
): CountRow<T>[] {
  const counts = new Map<T, number>()
  for (const item of items) counts.set(item, (counts.get(item) ?? 0) + 1)

  return (Object.keys(labels) as T[])
    .map((key) => ({ key, label: labels[key], count: counts.get(key) ?? 0 }))
    .sort((a, b) => b.count - a.count)
}

/**
 * 期間・自販機・銘柄で絞り込み、欠品投稿と買えなかった体験を集計する。
 * 推定値(仮係数由来)と実測値(CSV由来)は別のフィールドに分けて返す。
 */
export function buildAnalyticsReport(
  reports: InventoryReport[],
  experiences: PurchaseExperience[],
  machines: VendingMachine[],
  products: Product[],
  actuals: SalesActual[],
  filters: AnalyticsFilters = {},
  conversionRate = DEFAULT_CONVERSION_RATE,
): AnalyticsReport {
  const matchesFilters = (machineId: string, productId: ProductId, observedAt: string) =>
    withinPeriod(observedAt, filters) &&
    (!filters.machineId || filters.machineId === machineId) &&
    (!filters.productId || filters.productId === productId)

  const soldOut = reports.filter(
    (report) =>
      report.type === 'sold_out' &&
      matchesFilters(report.machineId, report.productId, report.observedAt),
  )

  const matchedExperiences = experiences.filter((experience) =>
    matchesFilters(experience.machineId, experience.wantedProductId, experience.observedAt),
  )

  const matchedActuals = actuals.filter(
    (actual) =>
      // 実測は日付単位なので、その日の終わりを期間判定に使う。
      withinPeriod(`${actual.observedOn}T23:59:59.000Z`, filters) &&
      (!filters.machineId || filters.machineId === actual.machineId) &&
      (!filters.productId || filters.productId === actual.productId),
  )

  const actualByPair = new Map<string, { unitsSold: number; restockUnits: number }>()
  for (const actual of matchedActuals) {
    const key = `${actual.machineId}:${actual.productId}`
    const current = actualByPair.get(key) ?? { unitsSold: 0, restockUnits: 0 }
    actualByPair.set(key, {
      unitsSold: current.unitsSold + actual.unitsSold,
      restockUnits: current.restockUnits + actual.restockUnits,
    })
  }

  const counts = new Map<string, number>()
  for (const report of soldOut) {
    const key = `${report.machineId}:${report.productId}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }

  const rows: DemandRow[] = []
  for (const [key, count] of counts) {
    const [machineId, productId] = key.split(':') as [string, ProductId]
    const machine = machines.find((item) => item.id === machineId)
    const product = products.find((item) => item.id === productId)
    if (!machine || !product) continue

    const estimatedMissedSales = Math.ceil(count * conversionRate)
    const actual = actualByPair.get(key)

    rows.push({
      machineId,
      machineName: machine.name,
      productId,
      productName: product.shortName,
      soldOutReports: count,
      estimatedMissedSales,
      estimatedRevenue: estimatedMissedSales * product.price,
      actualUnitsSold: actual?.unitsSold,
      actualRestockUnits: actual?.restockUnits,
      priority: count >= 3 ? 'high' : count >= 2 ? 'medium' : 'low',
    })
  }

  rows.sort((a, b) => b.soldOutReports - a.soldOutReports || b.estimatedRevenue - a.estimatedRevenue)

  const byHour = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    count: soldOut.filter((report) => new Date(report.observedAt).getHours() === hour).length,
  }))

  return {
    rows,
    soldOutReportCount: soldOut.length,
    experienceCount: matchedExperiences.length,
    estimatedMissedSales: rows.reduce((total, row) => total + row.estimatedMissedSales, 0),
    estimatedRevenue: rows.reduce((total, row) => total + row.estimatedRevenue, 0),
    hasActuals: matchedActuals.length > 0,
    actualUnitsSold: matchedActuals.length
      ? matchedActuals.reduce((total, actual) => total + actual.unitsSold, 0)
      : undefined,
    byHour,
    byReason: countBy(
      matchedExperiences.map((experience) => experience.reason),
      reasonLabels,
    ),
    byOutcome: countBy(
      matchedExperiences.map((experience) => experience.outcome),
      outcomeLabels,
    ),
    conversionRate,
  }
}

/** 集計結果をCSVにする。Excelで開けるようBOM付きUTF-8にする。 */
export function toCsv(report: AnalyticsReport): string {
  const escape = (value: string | number | undefined) => {
    const text = value === undefined ? '' : String(value)
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
  }

  const header = [
    '自販機ID',
    '自販機名',
    '商品ID',
    '商品名',
    '欠品投稿数',
    `推定取りこぼし本数(係数${report.conversionRate})`,
    '推定取りこぼし売上',
    '実測販売本数',
    '実測補充本数',
    '優先度',
  ]

  const lines = [header.join(',')]
  for (const row of report.rows) {
    lines.push(
      [
        row.machineId,
        row.machineName,
        row.productId,
        row.productName,
        row.soldOutReports,
        row.estimatedMissedSales,
        row.estimatedRevenue,
        row.actualUnitsSold,
        row.actualRestockUnits,
        row.priority,
      ]
        .map(escape)
        .join(','),
    )
  }

  return `\uFEFF${lines.join('\r\n')}\r\n`
}
