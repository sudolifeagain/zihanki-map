import { describe, expect, it } from 'vitest'
import { buildAnalyticsReport, toCsv } from './analytics'
import type { SalesActual } from './analytics'
import type {
  InventoryReport,
  Product,
  PurchaseExperience,
  VendingMachine,
} from './types'

const machines: VendingMachine[] = [
  {
    id: 'east',
    name: '東展示棟',
    area: 'テスト',
    lat: 35.63,
    lng: 139.79,
    distanceMeters: 80,
    landmark: 'テスト',
    photoUrl: '/images/vending-machine-blue.jpg',
    photoLocationMatches: false,
    stock: { water: 'sold_out' },
  },
  {
    id: 'south',
    name: '南展示棟',
    area: 'テスト',
    lat: 35.628,
    lng: 139.794,
    distanceMeters: 430,
    landmark: 'テスト',
    photoUrl: '/images/vending-machine-blue.jpg',
    photoLocationMatches: false,
    stock: { water: 'low' },
  },
]

const products: Product[] = [
  {
    id: 'water',
    name: 'サントリー天然水 550ml',
    shortName: 'サントリー天然水',
    brand: 'SUNTORY',
    price: 120,
    emoji: '💧',
    color: '#2f80ed',
  },
]

const soldOut = (machineId: string, observedAt: string, id: string): InventoryReport => ({
  id,
  machineId,
  productId: 'water',
  type: 'sold_out',
  observedAt,
  source: 'user',
})

const reports: InventoryReport[] = [
  soldOut('east', '2026-08-26T03:00:00.000Z', 'a'),
  soldOut('east', '2026-08-26T03:10:00.000Z', 'b'),
  soldOut('east', '2026-08-26T03:20:00.000Z', 'c'),
  soldOut('south', '2026-08-20T03:00:00.000Z', 'old'),
]

const experiences: PurchaseExperience[] = [
  {
    id: 'x1',
    machineId: 'east',
    wantedProductId: 'water',
    reason: 'sold_out',
    outcome: 'convenience_store',
    observedAt: '2026-08-26T03:05:00.000Z',
  },
  {
    id: 'x2',
    machineId: 'east',
    wantedProductId: 'water',
    reason: 'sold_out',
    outcome: 'gave_up',
    observedAt: '2026-08-26T03:15:00.000Z',
  },
  {
    id: 'x3',
    machineId: 'south',
    wantedProductId: 'water',
    reason: 'not_found',
    outcome: 'convenience_store',
    observedAt: '2026-08-20T03:05:00.000Z',
  },
]

describe('ベンダー分析', () => {
  it('欠品投稿の多い場所・銘柄を上位にする', () => {
    const report = buildAnalyticsReport(reports, experiences, machines, products, [])
    expect(report.rows[0]).toMatchObject({
      machineId: 'east',
      productId: 'water',
      soldOutReports: 3,
      priority: 'high',
    })
    expect(report.soldOutReportCount).toBe(4)
  })

  it('期間で絞り込む', () => {
    const report = buildAnalyticsReport(reports, experiences, machines, products, [], {
      from: '2026-08-26T00:00:00.000Z',
    })
    expect(report.rows.map((row) => row.machineId)).toEqual(['east'])
    expect(report.soldOutReportCount).toBe(3)
    expect(report.experienceCount).toBe(2)
  })

  it('自販機と銘柄で絞り込む', () => {
    const bySouth = buildAnalyticsReport(reports, experiences, machines, products, [], {
      machineId: 'south',
    })
    expect(bySouth.soldOutReportCount).toBe(1)

    const byOtherProduct = buildAnalyticsReport(reports, experiences, machines, products, [], {
      productId: 'coffee',
    })
    expect(byOtherProduct.soldOutReportCount).toBe(0)
  })

  it('その後の行動を比較できる形で集計する', () => {
    const report = buildAnalyticsReport(reports, experiences, machines, products, [])
    const convenience = report.byOutcome.find((row) => row.key === 'convenience_store')
    const gaveUp = report.byOutcome.find((row) => row.key === 'gave_up')
    expect(convenience?.count).toBe(2)
    expect(gaveUp?.count).toBe(1)
    // 選択肢が0件でも比較できるよう、すべての選択肢を返す。
    expect(report.byOutcome).toHaveLength(4)
    expect(report.byReason.find((row) => row.key === 'payment_issue')?.count).toBe(0)
  })

  it('時間帯別の欠品投稿数を返す', () => {
    const report = buildAnalyticsReport(reports, experiences, machines, products, [], {
      from: '2026-08-26T00:00:00.000Z',
    })
    const busiest = [...report.byHour].sort((a, b) => b.count - a.count)[0]
    expect(busiest.count).toBe(3)
    expect(report.byHour).toHaveLength(24)
  })

  it('仮係数を変えると推定値だけが変わる', () => {
    const base = buildAnalyticsReport(reports, experiences, machines, products, [], {}, 0.65)
    const doubled = buildAnalyticsReport(reports, experiences, machines, products, [], {}, 1)

    expect(base.rows[0].estimatedMissedSales).toBe(2)
    expect(doubled.rows[0].estimatedMissedSales).toBe(3)
    // 投稿数そのものは係数に左右されない。
    expect(doubled.rows[0].soldOutReports).toBe(base.rows[0].soldOutReports)
    expect(doubled.conversionRate).toBe(1)
  })

  it('実測データが無ければ推定のみと分かる', () => {
    const report = buildAnalyticsReport(reports, experiences, machines, products, [])
    expect(report.hasActuals).toBe(false)
    expect(report.actualUnitsSold).toBeUndefined()
    expect(report.rows[0].actualUnitsSold).toBeUndefined()
  })

  it('実測データがあれば推定と並べて返す', () => {
    const actuals: SalesActual[] = [
      { machineId: 'east', productId: 'water', observedOn: '2026-08-26', unitsSold: 40, restockUnits: 24 },
    ]
    const report = buildAnalyticsReport(reports, experiences, machines, products, actuals)

    expect(report.hasActuals).toBe(true)
    expect(report.actualUnitsSold).toBe(40)
    expect(report.rows[0]).toMatchObject({
      estimatedMissedSales: 2,
      actualUnitsSold: 40,
      actualRestockUnits: 24,
    })
  })

  it('集計結果をCSVにできる', () => {
    const report = buildAnalyticsReport(reports, experiences, machines, products, [])
    const csv = toCsv(report)
    const lines = csv.replace('\uFEFF', '').trim().split('\r\n')

    expect(lines[0]).toContain('欠品投稿数')
    expect(lines[0]).toContain('係数0.65')
    expect(lines).toHaveLength(report.rows.length + 1)
    expect(lines[1]).toContain('東展示棟')
  })
})
