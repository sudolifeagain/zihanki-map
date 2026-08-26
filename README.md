# ノミタイ — 自販機の「今」がわかるマップ

> 欲しい飲み物が売り切れていた。その「買えなかった」を、次の人の案内と次の補充に変える。

ハッカソン向けのモバイルファーストなMVPです。ユーザー投稿をもとに、自販機ごとの商品の状況、近くの代替候補、売上にならなかった需要を可視化します。

**公開デモ:** [https://zihanki-map.nagahama-91b.workers.dev](https://zihanki-map.nagahama-91b.workers.dev)

## できること

- 欲しい商品を選び、自販機ごとの「在庫あり／残りわずか／売り切れ／未確認」を地図で比較
- 登録済み自販機の正面写真を投稿すると、Workers AI(AI Gateway経由)が商品ラインナップと状態候補を解析(写真を選ばない場合はサンプル解析のモック)
- AI候補を投稿者が確認・修正してから公開。判定不能・タイムアウト時は手動入力にフォールバック
- 任意で「欲しかった銘柄」「買えなかった理由」「その後の行動」を選択式で追加
- 売り切れ時に、同じ商品が買えそうな近隣自販機を案内
- ベンダー画面で欠品投稿、推定取りこぼし売上、補充優先度を確認
- 投稿内容は Cloudflare Worker 経由で D1 に保存し、別端末からも同じ状態を確認可能

現在は**デモデータ**です。実在ブランドと再利用可能な実写写真を使っていますが、地図上の自販機・設置場所・在庫とは対応しておらず、各ブランドや施設との提携を示すものではありません。在庫APIを持たない状態でも、体験と需要データの価値を検証できる構成です。

## 起動

```bash
npm install
npm run dev
```

`npm run dev` は [`@cloudflare/vite-plugin`](https://developers.cloudflare.com/workers/vite-plugin/) 経由で Worker と D1 をローカルで再現します。初回のみ、ローカル D1 にスキーマとサンプルデータを投入してください。

```bash
npm run db:migrate:local
```

品質確認:

```bash
npm test
npm run build
```

## MVPの判断

最小の1機能は「欲しい商品が買えなかった投稿を、近くの代替案内と補充優先度に変える」です。

| 今回作る | 今回は作らない |
| --- | --- |
| 地図、場所・銘柄検索、写真投稿 | リアルタイム在庫の保証 |
| Workers AI(AI Gateway経由)による画像解析→候補確認→公開 | 商品マスターへの自動追加(未登録候補の表示まで) |
| 最終確認時刻の表示 | 写真の自動削除(ポリシーの明記まで。運用時にR2ライフサイクルで設定) |
| 近隣の代替候補 | 金銭に交換できるポイント |
| 欠品需要の集計 | 高度なAI需要予測 |
| ベンダー向け補充提案のデモ | 自販機会社との本番API連携 |

最初に共有されたビジネス検討と現在の仕様の対応は [要件定義・ビジネス検討記録](docs/REQUIREMENTS.md)、判断理由は [プロダクト計画](docs/PRODUCT_PLAN.md)、技術上の前提は [技術検討](docs/TECHNICAL_PLAN.md)、発表の流れは [デモ台本](docs/DEMO_SCRIPT.md) を参照してください。

## 構成

```text
src/
  components/       地図・写真解析モック・ベンダー画面
  data/demo.ts      実在庫ではないデモデータ
  domain.ts         鮮度判定・代替検索・需要集計
supabase/
  migrations/      本番バックエンドへ移すためのスキーマ案
docs/               MVP、技術、デモの設計資料
```

フロントエンドは React + TypeScript + Vite、地図表示は React Leaflet、公開先は Cloudflare Workers Static Assets です。現在の投稿はブラウザ内にだけ保存します。将来は Cloudflare D1/R2/Workers AI、または既存のSupabase/PostGIS案へ移行できます。OpenStreetMap標準タイルはハッカソンの低トラフィックなデモ用途に限り、見える位置に帰属表示を置いています。本番公開時は利用量に合ったタイルプロバイダーへ切り替えてください。

## 投稿写真の取り扱い

- 選んだ写真は Cloudflare Worker 経由で R2 に保存し、JPEG/PNG/WebP・10MB以下のみ許可します(非対応形式・過大ファイルは理由つきで拒否)
- 投稿から**30日**で削除します(自動削除は R2 のオブジェクトライフサイクルルールで運用時に設定します)
- 顔や周辺の人物が写り込む可能性があるため、人物が写らない撮影を案内しています
- 写真は投稿者の確認・修正を経てから公開されます。写真を選ばない場合はサンプル画像による解析モックのままです
- R2バケットは非公開で、Worker が発行する内部IDを介してのみ配信します。バケット一覧やオブジェクトの直接列挙はできません

## AI解析

- Worker は Workers AI(`@cf/meta/llama-3.2-11b-vision-instruct`)を [AI Gateway](https://developers.cloudflare.com/ai-gateway/) 経由で呼び出し、写真から商品名・ブランド・在庫状態・信頼度をJSONで抽出します
- AI Gateway 側でリクエストタイムアウトを設定し、判定不能・失敗時は自動的に手動入力へフォールバックします(投稿自体は継続できます)
- 抽出結果は登録済み商品マスターと名称照合し、一致しないものは「未登録の候補」として参考表示のみ行います(自動登録はしません)
- モデル利用には Meta の Llama 3.2 Community License への同意が必要です(Cloudflareアカウント単位で一度だけ)
- APIキーやモデルbindingはWorker内でのみ使用し、ブラウザには一切露出しません

## データの読み方

- 「在庫あり」は在庫保証ではなく、直近の投稿または連携データによる**観測結果**です。
- 投稿は30分を鮮度の目安とし、それを超えた場合は初期データへフォールバックします。
- ベンダー画面の推定売上は `欠品投稿 × 65% × 商品価格` という検証用仮説です。
- 本番ではソース種別、複数ユーザーの一致、経過時間を使った信頼度表示が必要です。

## 参考にした公式資料

- [Vite Getting Started](https://vite.dev/guide/)
- [React Leaflet Installation](https://react-leaflet.js.org/docs/start-installation/)
- [Supabase PostGIS](https://supabase.com/docs/guides/database/extensions/postgis)
- [OpenStreetMap Tile Usage Policy](https://operations.osmfoundation.org/policies/tiles/)
- [Cloudflare React + Vite](https://developers.cloudflare.com/workers/framework-guides/web-apps/react/)

実写写真の出典とライセンスは [Third-party notices](THIRD_PARTY_NOTICES.md) に記載しています。

## License

[MIT](LICENSE)
