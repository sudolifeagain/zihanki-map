import type {
  DemandInsight,
  InventoryReport,
  Product,
  ProductId,
  StockStatus,
  VendingMachine,
} from './types'

/** 重みが半分になるまでの分数。30分で半減し、経過するほど観測を信用しない。 */
export const CONFIDENCE_HALF_LIFE_MINUTES = 30
/** これを下回った観測は「未確認」まで減衰したものとして扱う。 */
export const MIN_CONFIDENCE = 0.2
/** これより古い観測は集計対象から外す。 */
const MAX_OBSERVATION_AGE_MINUTES = 180

// 情報源ごとの重み。連携済みベンダー在庫を最も信頼する。
const SOURCE_WEIGHT: Record<InventoryReport['source'], number> = {
  vendor: 1,
  user: 0.65,
  demo: 0.65,
}

export interface StockAssessment {
  status: StockStatus
  /** 0〜1。表示は formatConfidence を使う。 */
  confidence: number
  /** 採用した観測のうち最新の時刻。登録情報のみの場合は undefined。 */
  observedAt?: string
  /** 採用した状態に一致した観測数。 */
  agreeingReports: number
  /** 採用した状態と食い違う観測数。 */
  conflictingReports: number
  /** observation=投稿・連携データによる観測、registered=登録時のラインナップ。 */
  basis: 'observation' | 'registered'
}

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

export function formatConfidence(confidence: number): string {
  return `${Math.round(confidence * 100)}%`
}

/**
 * 観測を `情報源の重み × 時間減衰` で加重し、状態ごとに合計して最も重い状態を採る。
 * 一致する観測が多いほど、また新しいほど信頼度が上がり、食い違う観測があると下がる。
 */
export function assessStock(
  machine: VendingMachine,
  productId: ProductId,
  reports: InventoryReport[],
  now = new Date(),
): StockAssessment {
  const relevant = reports.filter(
    (report) =>
      report.machineId === machine.id &&
      report.productId === productId &&
      minutesSince(report.observedAt, now) <= MAX_OBSERVATION_AGE_MINUTES,
  )

  const weightByStatus = new Map<StockStatus, number>()
  const countByStatus = new Map<StockStatus, number>()
  const latestByStatus = new Map<StockStatus, string>()
  let totalWeight = 0

  for (const report of relevant) {
    const decay =
      0.5 ** (minutesSince(report.observedAt, now) / CONFIDENCE_HALF_LIFE_MINUTES)
    const weight = SOURCE_WEIGHT[report.source] * decay

    weightByStatus.set(report.type, (weightByStatus.get(report.type) ?? 0) + weight)
    countByStatus.set(report.type, (countByStatus.get(report.type) ?? 0) + 1)
    const previous = latestByStatus.get(report.type)
    if (!previous || new Date(report.observedAt) > new Date(previous)) {
      latestByStatus.set(report.type, report.observedAt)
    }
    totalWeight += weight
  }

  const registered: StockAssessment = {
    status: machine.stock[productId] ?? 'unknown',
    confidence: 0,
    agreeingReports: 0,
    conflictingReports: 0,
    basis: 'registered',
  }

  if (totalWeight === 0) return registered

  const [winnerStatus, winnerWeight] = [...weightByStatus.entries()].sort(
    (a, b) => b[1] - a[1],
  )[0]

  // agreement: 食い違う観測がなければ1。evidence: 観測が新しく多いほど1に近づく。
  const agreement = winnerWeight / totalWeight
  const evidence = 1 - 0.5 ** (winnerWeight / SOURCE_WEIGHT.user)
  const confidence = agreement * evidence

  // 減衰しきった観測は在庫を保証しない。登録情報の表示に戻す。
  if (confidence < MIN_CONFIDENCE) return registered

  const agreeingReports = countByStatus.get(winnerStatus) ?? 0
  return {
    status: winnerStatus,
    confidence,
    observedAt: latestByStatus.get(winnerStatus),
    agreeingReports,
    conflictingReports: relevant.length - agreeingReports,
    basis: 'observation',
  }
}

export function deriveStockStatus(
  machine: VendingMachine,
  productId: ProductId,
  reports: InventoryReport[],
  now = new Date(),
): StockStatus {
  return assessStock(machine, productId, reports, now).status
}

/**
 * 画面に出す状態。登録時のラインナップしか根拠がない場合は「未確認」として扱い、
 * 減衰した観測や未確認の在庫が「買える」と読めないようにする。
 */
export function displayStatus(assessment: StockAssessment): StockStatus {
  return assessment.basis === 'registered' ? 'unknown' : assessment.status
}

export interface LatLng {
  lat: number
  lng: number
}

export function haversineMeters(a: LatLng, b: LatLng): number {
  const earthRadius = 6_371_000
  const toRad = (degrees: number) => (degrees * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return Math.round(2 * earthRadius * Math.asin(Math.sqrt(h)))
}

export interface MachineRanking {
  machine: VendingMachine
  assessment: StockAssessment
  /** 表示用の状態。減衰済みは unknown。 */
  status: StockStatus
  distanceMeters: number
}

// 状態の差(1以上)が、近さと信頼度の差(合計±0.5)より必ず大きくなるようにしている。
// つまり「買えるか」を最優先し、同じ状態のなかで近さと観測の確かさを比べる。
const STATUS_SCORE: Record<StockStatus, number> = {
  available: 3,
  low: 2,
  unknown: 1,
  sold_out: 0,
}
const DISTANCE_SCORE_CAP_METERS = 1_000

/**
 * 指定銘柄を扱う自販機だけを、状態・近さ・観測の信頼度で並べる。
 * origin が無い場合は登録時の距離を使う。
 */
export function rankMachines(
  machines: VendingMachine[],
  reports: InventoryReport[],
  productId: ProductId,
  origin?: LatLng,
  now = new Date(),
): MachineRanking[] {
  return machines
    .filter((machine) => productId in machine.stock)
    .map((machine) => {
      const assessment = assessStock(machine, productId, reports, now)
      return {
        machine,
        assessment,
        status: displayStatus(assessment),
        distanceMeters: origin
          ? haversineMeters(origin, machine)
          : machine.distanceMeters,
      }
    })
    .sort((a, b) => rankingScore(b) - rankingScore(a))
}

function rankingScore(ranking: MachineRanking): number {
  const nearness =
    1 - Math.min(ranking.distanceMeters, DISTANCE_SCORE_CAP_METERS) / DISTANCE_SCORE_CAP_METERS
  return (
    STATUS_SCORE[ranking.status] +
    ranking.assessment.confidence * 0.5 +
    nearness * 0.5
  )
}

export function findAlternatives(
  machines: VendingMachine[],
  reports: InventoryReport[],
  productId: ProductId,
  excludedMachineId: string,
  now = new Date(),
): VendingMachine[] {
  // 登録情報だけの自販機は案内しない。実際に「在庫あり」と観測された機械に限る。
  return machines
    .filter(
      (machine) =>
        machine.id !== excludedMachineId &&
        displayStatus(assessStock(machine, productId, reports, now)) === 'available',
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
