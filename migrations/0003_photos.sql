-- 投稿写真をR2に保存し、そのオブジェクトキーをD1で管理する。

CREATE TABLE photos (
  id TEXT PRIMARY KEY,
  machine_id TEXT NOT NULL REFERENCES vending_machines(id) ON DELETE CASCADE,
  object_key TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  reporter_session_id TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX photos_machine_idx ON photos (machine_id, created_at DESC);

ALTER TABLE inventory_reports ADD COLUMN photo_id TEXT REFERENCES photos(id) ON DELETE SET NULL;
