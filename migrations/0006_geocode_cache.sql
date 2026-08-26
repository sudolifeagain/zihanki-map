-- ジオコーディング結果のキャッシュ。
-- Nominatim の利用規約は「結果をキャッシュすること」「毎秒1リクエストまで」を求めるため、
-- Worker側でキャッシュと送信間隔の記録を持つ。

CREATE TABLE geocode_cache (
  query TEXT PRIMARY KEY,
  lat REAL,
  lng REAL,
  display_name TEXT,
  -- 見つからなかった問い合わせも記録し、同じ検索で上流を叩き直さない。
  found INTEGER NOT NULL DEFAULT 1 CHECK (found IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX geocode_cache_created_idx ON geocode_cache (created_at);

-- 上流へ最後に問い合わせた時刻を1行だけ保持する。
CREATE TABLE geocode_throttle (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  last_request_at TEXT NOT NULL
);
