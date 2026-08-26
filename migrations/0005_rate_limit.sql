-- 連投防止のための投稿元識別。
-- reporter_ip_hash は「IP + 秘密ソルト」のSHA-256のみを保持し、生のIPは保存しない。
-- ソルト(IP_HASH_SALT)が未設定の環境では NULL のまま(セッション単位の制限のみ動く)。

ALTER TABLE inventory_reports ADD COLUMN reporter_ip_hash TEXT;
ALTER TABLE purchase_experiences ADD COLUMN reporter_ip_hash TEXT;

CREATE INDEX inventory_reports_session_idx
  ON inventory_reports (reporter_session_id, machine_id, created_at DESC);

CREATE INDEX inventory_reports_ip_idx
  ON inventory_reports (reporter_ip_hash, machine_id, created_at DESC);
