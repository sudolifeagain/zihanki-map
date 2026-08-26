import { describe, expect, it } from 'vitest'
import { machines, products } from './data/demo'
import {
  buildDemandInsights,
  deriveStockStatus,
  findAlternatives,
  formatFreshness,
} from './domain'
import type { InventoryReport } from './types'

const now = new Date('2026-08-26T03:00:00.000Z')

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

  it('在庫ありの近い代替候補だけを返す', () => {
    const alternatives = findAlternatives(
      machines,
      reports,
      'water',
      'east-entrance',
      now,
    )
    expect(alternatives.map((machine) => machine.id)).toEqual(['station-gate'])
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
