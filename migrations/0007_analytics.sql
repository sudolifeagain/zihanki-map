-- ベンダー分析でイベント別集計と実測突合を行うためのテーブル。

CREATE TABLE events (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  -- 会期。ISO 8601(UTC)で保持する。
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- 販売・補充の実測値。空でも動き、その場合は画面上すべて「推定」と表示する。
CREATE TABLE sales_actuals (
  machine_id TEXT NOT NULL REFERENCES vending_machines(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  observed_on TEXT NOT NULL,
  units_sold INTEGER NOT NULL DEFAULT 0 CHECK (units_sold >= 0),
  restock_units INTEGER NOT NULL DEFAULT 0 CHECK (restock_units >= 0),
  PRIMARY KEY (machine_id, product_id, observed_on)
);

CREATE INDEX sales_actuals_date_idx ON sales_actuals (observed_on);
