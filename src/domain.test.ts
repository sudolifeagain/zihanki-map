import { describe, expect, it } from 'vitest'
import {
  assessStock,
  buildDemandInsights,
  deriveStockStatus,
  findAlternatives,
  formatFreshness,
} from './domain'
import type { InventoryReport, Product, VendingMachine } from './types'

const now = new Date('2026-08-26T03:00:00.000Z')

// マスターはD1(data/*.csv)が正なので、ここはドメイン判定を確かめるための最小構成。
const machine = (
  id: string,
  distanceMeters: number,
  water: VendingMachine['stock']['water'],
): VendingMachine => ({
  id,
  name: id,
  area: 'テスト',
  lat: 35.63,
  lng: 139.79,
  distanceMeters,
  landmark: 'テスト',
  photoUrl: '/images/vending-machine-blue.jpg',
  photoLocationMatches: false,
  stock: { water },
})

const machines: VendingMachine[] = [
  machine('east-entrance', 80, 'sold_out'),
  machine('conference-tower', 210, 'available'),
  machine('station-gate', 360, 'available'),
  machine('south-hall', 430, 'low'),
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

const reports: InventoryReport[] = [
  {
    id: 'test-1',
    machineId: 'east-entrance',
    productId: 'water',
    type: 'available',
    observedAt: '2026-08-26T02:55:00.000Z',
    source: 'user',
  },
  {
    id: 'test-2',
    machineId: 'conference-tower',
    productId: 'water',
    type: 'sold_out',
    observedAt: '2026-08-26T02:58:00.000Z',
    source: 'user',
  },
]

describe('inventory domain', () => {
  it('新しい投稿を機械の初期状態より優先する', () => {
    expect(deriveStockStatus(machines[0], 'water', reports, now)).toBe(
      'available',
    )
  })

  it('観測で在庫ありと確認された近い候補だけを返す', () => {
    const observed: InventoryReport[] = [
      ...reports,
      {
        id: 'test-3',
        machineId: 'station-gate',
        productId: 'water',
        type: 'available',
        observedAt: '2026-08-26T02:56:00.000Z',
        source: 'user',
      },
    ]
    const alternatives = findAlternatives(
      machines,
      observed,
      'water',
      'east-entrance',
      now,
    )
    // conference-tower は売り切れ観測、south-hall は登録情報のみなので案内しない。
    expect(alternatives.map((item) => item.id)).toEqual(['station-gate'])
  })

  it('登録情報しかない自販機は代替候補にしない', () => {
    const alternatives = findAlternatives(
      machines,
      reports,
      'water',
      'east-entrance',
      now,
    )
    expect(alternatives).toEqual([])
  })

  it('買えなかった投稿を潜在売上へ変換する', () => {
    const soldOutReports = Array.from({ length: 3 }, (_, index) => ({
      id: `sold-out-${index}`,
      machineId: 'east-entrance',
      productId: 'water' as const,
      type: 'sold_out' as const,
      observedAt: now.toISOString(),
      source: 'user' as const,
    }))
    const insights = buildDemandInsights(soldOutReports, machines, products)
    expect(insights[0]).toMatchObject({
      estimatedMissedSales: 2,
      potentialRevenue: 240,
      priority: 'high',
    })
  })

  it('確認時刻を読みやすく表示する', () => {
    expect(formatFreshness('2026-08-26T02:48:00.000Z', now)).toBe(
      '12分前に確認',
    )
  })
})

describe('観測の信頼度', () => {
  const target = machine('east-entrance', 80, 'sold_out')
  const report = (
    id: string,
    type: InventoryReport['type'],
    minutesAgo: number,
    source: InventoryReport['source'] = 'user',
  ): InventoryReport => ({
    id,
    machineId: 'east-entrance',
    productId: 'water',
    type,
    observedAt: new Date(now.getTime() - minutesAgo * 60_000).toISOString(),
    source,
  })

  it('複数ユーザーの一致が単一投稿より高い信頼度になる', () => {
    const single = assessStock(target, 'water', [report('a', 'available', 5)], now)
    const agreeing = assessStock(
      target,
      'water',
      [report('a', 'available', 5), report('b', 'available', 5)],
      now,
    )

    expect(single.status).toBe('available')
    expect(agreeing.status).toBe('available')
    expect(agreeing.confidence).toBeGreaterThan(single.confidence)
    expect(agreeing.agreeingReports).toBe(2)
  })

  it('ベンダー在庫を単一ユーザー投稿より優先する', () => {
    const assessment = assessStock(
      target,
      'water',
      [report('user', 'sold_out', 5), report('vendor', 'available', 5, 'vendor')],
      now,
    )
    expect(assessment.status).toBe('available')
    expect(assessment.conflictingReports).toBe(1)
  })

  it('相反する投稿は信頼度を下げる', () => {
    const clean = assessStock(target, 'water', [report('a', 'available', 5)], now)
    const conflicted = assessStock(
      target,
      'water',
      [report('a', 'available', 5), report('b', 'sold_out', 5)],
      now,
    )
    expect(conflicted.confidence).toBeLessThan(clean.confidence)
    expect(conflicted.conflictingReports).toBe(1)
  })

  it('古い観測は登録情報へ減衰し、在庫を保証しない', () => {
    const assessment = assessStock(
      target,
      'water',
      [report('old', 'available', 150)],
      now,
    )
    expect(assessment.basis).toBe('registered')
    expect(assessment.confidence).toBe(0)
    expect(assessment.status).toBe('sold_out')
    expect(assessment.observedAt).toBeUndefined()
  })

  it('観測がなければ登録情報を根拠として返す', () => {
    const assessment = assessStock(target, 'water', [], now)
    expect(assessment).toMatchObject({ basis: 'registered', confidence: 0 })
  })
})
