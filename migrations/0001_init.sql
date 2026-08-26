-- 自販機・商品・観測・買えなかった体験の永続化スキーマ。
-- supabase/migrations の PostGIS 案を Cloudflare D1 (SQLite) 向けに単純化したもの。

CREATE TABLE products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  short_name TEXT NOT NULL,
  brand TEXT NOT NULL,
  price INTEGER NOT NULL CHECK (price > 0),
  emoji TEXT NOT NULL,
  color TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE vending_machines (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  area TEXT NOT NULL,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  distance_meters INTEGER NOT NULL DEFAULT 0,
  landmark TEXT NOT NULL,
  photo_url TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- 自販機ごとの初期陳列状態。投稿がない場合のフォールバックとして使う。
CREATE TABLE machine_products (
  machine_id TEXT NOT NULL REFERENCES vending_machines(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  base_status TEXT NOT NULL DEFAULT 'unknown'
    CHECK (base_status IN ('available', 'low', 'sold_out', 'unknown')),
  PRIMARY KEY (machine_id, product_id)
);

CREATE TABLE inventory_reports (
  id TEXT PRIMARY KEY,
  machine_id TEXT NOT NULL REFERENCES vending_machines(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('available', 'low', 'sold_out')),
  source TEXT NOT NULL DEFAULT 'user' CHECK (source IN ('demo', 'user', 'vendor')),
  reporter_session_id TEXT,
  observed_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX inventory_reports_lookup_idx
  ON inventory_reports (machine_id, product_id, observed_at DESC);

CREATE TABLE purchase_experiences (
  id TEXT PRIMARY KEY,
  machine_id TEXT NOT NULL REFERENCES vending_machines(id) ON DELETE CASCADE,
  wanted_product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  reason TEXT NOT NULL CHECK (reason IN ('sold_out', 'not_found', 'payment_issue')),
  outcome TEXT NOT NULL
    CHECK (outcome IN ('another_machine', 'convenience_store', 'different_product', 'gave_up')),
  reporter_session_id TEXT,
  observed_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX purchase_experiences_lookup_idx
  ON purchase_experiences (machine_id, observed_at DESC);
