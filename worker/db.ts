import type {
  ExperienceOutcome,
  ExperienceReason,
  InventoryReport,
  Product,
  ProductId,
  PurchaseExperience,
  ReportType,
  StockStatus,
  VendingMachine,
} from '../src/types'

interface ProductRow {
  id: string
  name: string
  short_name: string
  brand: string
  price: number
  emoji: string
  color: string
}

interface MachineRow {
  id: string
  name: string
  area: string
  lat: number
  lng: number
  distance_meters: number
  landmark: string
  photo_url: string
}

interface MachineProductRow {
  machine_id: string
  product_id: string
  base_status: string
}

interface ReportRow {
  id: string
  machine_id: string
  product_id: string
  status: string
  source: string
  observed_at: string
}

interface ExperienceRow {
  id: string
  machine_id: string
  wanted_product_id: string
  reason: string
  outcome: string
  observed_at: string
}

export async function listProducts(db: D1Database): Promise<Product[]> {
  const { results } = await db
    .prepare(
      'SELECT id, name, short_name, brand, price, emoji, color FROM products ORDER BY rowid',
    )
    .all<ProductRow>()

  return results.map((row) => ({
    id: row.id as ProductId,
    name: row.name,
    shortName: row.short_name,
    brand: row.brand,
    price: row.price,
    emoji: row.emoji,
    color: row.color,
  }))
}

export async function listProductIds(db: D1Database): Promise<Set<string>> {
  const { results } = await db.prepare('SELECT id FROM products').all<{ id: string }>()
  return new Set(results.map((row) => row.id))
}

export async function listMachines(db: D1Database): Promise<VendingMachine[]> {
  const [{ results: machineRows }, { results: stockRows }] = await Promise.all([
    db
      .prepare(
        'SELECT id, name, area, lat, lng, distance_meters, landmark, photo_url FROM vending_machines ORDER BY distance_meters',
      )
      .all<MachineRow>(),
    db
      .prepare('SELECT machine_id, product_id, base_status FROM machine_products')
      .all<MachineProductRow>(),
  ])

  const stockByMachine = new Map<string, Partial<Record<ProductId, StockStatus>>>()
  for (const row of stockRows) {
    const stock = stockByMachine.get(row.machine_id) ?? {}
    stock[row.product_id as ProductId] = row.base_status as StockStatus
    stockByMachine.set(row.machine_id, stock)
  }

  return machineRows.map((row) => ({
    id: row.id,
    name: row.name,
    area: row.area,
    lat: row.lat,
    lng: row.lng,
    distanceMeters: row.distance_meters,
    landmark: row.landmark,
    photoUrl: row.photo_url,
    stock: stockByMachine.get(row.id) ?? {},
  }))
}

export async function machineExists(db: D1Database, machineId: string): Promise<boolean> {
  const row = await db
    .prepare('SELECT 1 FROM vending_machines WHERE id = ?')
    .bind(machineId)
    .first()
  return row !== null
}

export async function listReports(
  db: D1Database,
  limit: number,
): Promise<InventoryReport[]> {
  const { results } = await db
    .prepare(
      'SELECT id, machine_id, product_id, status, source, observed_at FROM inventory_reports ORDER BY observed_at DESC LIMIT ?',
    )
    .bind(limit)
    .all<ReportRow>()

  return results.map((row) => ({
    id: row.id,
    machineId: row.machine_id,
    productId: row.product_id as ProductId,
    type: row.status as ReportType,
    observedAt: row.observed_at,
    source: row.source as InventoryReport['source'],
  }))
}

export async function insertReports(
  db: D1Database,
  machineId: string,
  entries: { productId: ProductId; status: Exclude<StockStatus, 'unknown'> }[],
  sessionId: string,
): Promise<InventoryReport[]> {
  const observedAt = new Date().toISOString()
  const rows = entries.map((entry) => ({ id: crypto.randomUUID(), ...entry }))

  await db.batch(
    rows.map((row) =>
      db
        .prepare(
          'INSERT INTO inventory_reports (id, machine_id, product_id, status, source, reporter_session_id, observed_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .bind(row.id, machineId, row.productId, row.status, 'user', sessionId, observedAt),
    ),
  )

  return rows.map((row) => ({
    id: row.id,
    machineId,
    productId: row.productId,
    type: row.status,
    observedAt,
    source: 'user' as const,
  }))
}

export async function listExperiences(
  db: D1Database,
  limit: number,
): Promise<PurchaseExperience[]> {
  const { results } = await db
    .prepare(
      'SELECT id, machine_id, wanted_product_id, reason, outcome, observed_at FROM purchase_experiences ORDER BY observed_at DESC LIMIT ?',
    )
    .bind(limit)
    .all<ExperienceRow>()

  return results.map((row) => ({
    id: row.id,
    machineId: row.machine_id,
    wantedProductId: row.wanted_product_id as ProductId,
    reason: row.reason as ExperienceReason,
    outcome: row.outcome as ExperienceOutcome,
    observedAt: row.observed_at,
  }))
}

export async function insertExperience(
  db: D1Database,
  input: {
    machineId: string
    wantedProductId: ProductId
    reason: ExperienceReason
    outcome: ExperienceOutcome
  },
  sessionId: string,
): Promise<PurchaseExperience> {
  const id = crypto.randomUUID()
  const observedAt = new Date().toISOString()

  await db
    .prepare(
      'INSERT INTO purchase_experiences (id, machine_id, wanted_product_id, reason, outcome, reporter_session_id, observed_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .bind(
      id,
      input.machineId,
      input.wantedProductId,
      input.reason,
      input.outcome,
      sessionId,
      observedAt,
    )
    .run()

  return {
    id,
    machineId: input.machineId,
    wantedProductId: input.wantedProductId,
    reason: input.reason,
    outcome: input.outcome,
    observedAt,
  }
}
