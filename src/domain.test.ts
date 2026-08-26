import { describe, expect, it } from 'vitest'
import {
  assessStock,
  buildDemandInsights,
  deriveStockStatus,
  findAlternatives,
  formatFreshness,
  haversineMeters,
  rankMachines,
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

describe('検索結果の並び', () => {
  it('2点間の距離をメートルで求める', () => {
    // 緯度0.001度 ≒ 111m
    expect(
      haversineMeters({ lat: 35.63, lng: 139.79 }, { lat: 35.631, lng: 139.79 }),
    ).toBe(111)
  })

  it('指定銘柄を扱わない自販機を除外する', () => {
    const coffeeOnly: VendingMachine = {
      ...machine('coffee-only', 50, 'available'),
      stock: { coffee: 'available' },
    }
    const ranked = rankMachines([...machines, coffeeOnly], reports, 'water', undefined, now)
    expect(ranked.map((item) => item.machine.id)).not.toContain('coffee-only')
  })

  it('在庫ありを未確認や売り切れより上位にする', () => {
    const observed: InventoryReport[] = [
      {
        id: 'obs-1',
        machineId: 'south-hall',
        productId: 'water',
        type: 'available',
        observedAt: new Date(now.getTime() - 3 * 60_000).toISOString(),
        source: 'user',
      },
      {
        id: 'obs-2',
        machineId: 'east-entrance',
        productId: 'water',
        type: 'sold_out',
        observedAt: new Date(now.getTime() - 3 * 60_000).toISOString(),
        source: 'user',
      },
    ]
    const ranked = rankMachines(machines, observed, 'water', undefined, now)

    // south-hall は最も遠いが、唯一「在庫あり」と観測されているので先頭に来る。
    expect(ranked[0].machine.id).toBe('south-hall')
    expect(ranked[0].status).toBe('available')
    // east-entrance は最も近いが、売り切れと観測されているので最後になる。
    expect(ranked[ranked.length - 1].machine.id).toBe('east-entrance')
    expect(ranked[ranked.length - 1].status).toBe('sold_out')
  })

  it('現在地を渡すと実距離で近い順に並べ替える', () => {
    const nearSouthHall = { lat: 35.6295, lng: 139.7905 }
    const spread: VendingMachine[] = [
      { ...machine('far', 10, 'available'), lat: 35.64, lng: 139.8 },
      { ...machine('near', 900, 'available'), lat: 35.6296, lng: 139.7906 },
    ]
    const ranked = rankMachines(spread, [], 'water', nearSouthHall, now)

    // 登録距離では far が近いが、現在地からの実距離では near が近い。
    expect(ranked[0].machine.id).toBe('near')
    expect(ranked[0].distanceMeters).toBeLessThan(ranked[1].distanceMeters)
  })
})
