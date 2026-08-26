-- 自販機マスターを運用できる状態にする。
-- status: active=公開, hidden=非公開, removed=撤去済み, duplicate=重複登録
-- photo_location_matches: 掲載写真の撮影地がこの座標と一致するか(デモ写真は0)

ALTER TABLE vending_machines ADD COLUMN status TEXT NOT NULL DEFAULT 'active'
  CHECK (status IN ('active', 'hidden', 'removed', 'duplicate'));

ALTER TABLE vending_machines ADD COLUMN photo_location_matches INTEGER NOT NULL DEFAULT 0
  CHECK (photo_location_matches IN (0, 1));

ALTER TABLE vending_machines ADD COLUMN updated_at TEXT;

CREATE INDEX vending_machines_status_idx ON vending_machines (status);

-- 既存のサンプル4台は再利用可能な実写写真で、撮影地と座標は一致しない。
UPDATE vending_machines SET photo_location_matches = 0;
