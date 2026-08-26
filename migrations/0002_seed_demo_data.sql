-- src/data/demo.ts と揃えた初期サンプルデータ。
-- 観測時刻は投入時刻からの相対値とし、鮮度判定(30分)のデモ挙動を再現する。

INSERT INTO products (id, name, short_name, brand, price, emoji, color) VALUES
  ('water', 'サントリー天然水 550ml', 'サントリー天然水', 'SUNTORY', 120, '💧', '#2f80ed'),
  ('tea', '伊右衛門 600ml', '伊右衛門', 'SUNTORY', 140, '🍵', '#2d9d78'),
  ('cola', 'ペプシ BIG 600ml', 'ペプシ', 'Pepsi', 160, '🥤', '#e84c3d'),
  ('sports', 'GREEN DA・KA・RA 600ml', 'GREEN DA・KA・RA', 'SUNTORY', 170, '⚡', '#ef9f28'),
  ('coffee', 'BOSS ブラック 390ml', 'BOSS', 'SUNTORY BOSS', 150, '☕', '#7a5544');

INSERT INTO vending_machines (id, name, area, lat, lng, distance_meters, landmark, photo_url) VALUES
  ('east-entrance', '東展示棟エントランス', '東京ビッグサイト周辺（デモ）', 35.63008, 139.79576, 80, '入口を入って右手', '/images/vending-machine-suntory.jpg'),
  ('conference-tower', '会議棟 2Fロビー', '東京ビッグサイト周辺（デモ）', 35.63072, 139.79382, 210, 'エスカレーター横', '/images/vending-machine-blue.jpg'),
  ('station-gate', '駅前プロムナード', '東京ビッグサイト周辺（デモ）', 35.62964, 139.79171, 360, '駅改札から会場方面へ50m', '/images/vending-machine-suntory.jpg'),
  ('south-hall', '南展示棟 1F', '東京ビッグサイト周辺（デモ）', 35.62871, 139.79481, 430, '休憩スペース付近', '/images/vending-machine-blue.jpg');

INSERT INTO machine_products (machine_id, product_id, base_status) VALUES
  ('east-entrance', 'water', 'sold_out'),
  ('east-entrance', 'tea', 'low'),
  ('east-entrance', 'cola', 'available'),
  ('east-entrance', 'sports', 'sold_out'),
  ('east-entrance', 'coffee', 'available'),
  ('conference-tower', 'water', 'available'),
  ('conference-tower', 'tea', 'available'),
  ('conference-tower', 'cola', 'low'),
  ('conference-tower', 'sports', 'available'),
  ('conference-tower', 'coffee', 'available'),
  ('station-gate', 'water', 'available'),
  ('station-gate', 'tea', 'unknown'),
  ('station-gate', 'cola', 'available'),
  ('station-gate', 'sports', 'available'),
  ('station-gate', 'coffee', 'sold_out'),
  ('south-hall', 'water', 'low'),
  ('south-hall', 'tea', 'available'),
  ('south-hall', 'cola', 'available'),
  ('south-hall', 'sports', 'low'),
  ('south-hall', 'coffee', 'available');

INSERT INTO inventory_reports (id, machine_id, product_id, status, source, observed_at) VALUES
  ('r-1', 'east-entrance', 'water', 'sold_out', 'demo', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-6 minutes')),
  ('r-2', 'east-entrance', 'sports', 'sold_out', 'demo', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-9 minutes')),
  ('r-3', 'east-entrance', 'water', 'sold_out', 'demo', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-18 minutes')),
  ('r-4', 'conference-tower', 'water', 'available', 'demo', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-4 minutes')),
  ('r-5', 'station-gate', 'coffee', 'sold_out', 'demo', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-35 minutes')),
  ('r-6', 'south-hall', 'sports', 'sold_out', 'demo', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-52 minutes'));
