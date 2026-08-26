import {
  AlertTriangle,
  ArrowUpRight,
  Banknote,
  BarChart3,
  Clock3,
  Sparkles,
  Users,
} from 'lucide-react'
import { buildDemandInsights } from '../domain'
import type {
  InventoryReport,
  Product,
  PurchaseExperience,
  VendingMachine,
} from '../types'

interface InsightsViewProps {
  reports: InventoryReport[]
  experiences: PurchaseExperience[]
  machines: VendingMachine[]
  products: Product[]
}

export default function InsightsView({
  reports,
  experiences,
  machines,
  products,
}: InsightsViewProps) {
  const insights = buildDemandInsights(reports, machines, products)
  const totalMissed =
    reports.filter((report) => report.type === 'sold_out').length +
    experiences.filter((item) => item.reason !== 'payment_issue').length
  const potentialRevenue = insights.reduce(
    (total, item) => total + item.potentialRevenue,
    0,
  )
  const uniqueUsers = Math.max(
    4,
    Math.ceil((reports.length + experiences.length) * 0.75),
  )

  return (
    <main className="insights-page">
      <section className="insights-hero">
        <div>
          <span className="eyebrow"><BarChart3 size={15} /> VENDOR INSIGHTS</span>
          <h1>売上にならなかった需要を、<br />次の補充へ。</h1>
          <p>購入実績だけでは見えない「欲しかった」をデモ投稿から集計しています。</p>
        </div>
        <div className="live-pill"><span /> イベント開催中</div>
      </section>

      <div className="metric-grid">
        <article className="metric-card accent-card">
          <span className="metric-icon"><AlertTriangle size={21} /></span>
          <small>買えなかった投稿</small>
          <strong>{totalMissed}<em>件</em></strong>
          <p>直近のデモセッション</p>
        </article>
        <article className="metric-card">
          <span className="metric-icon"><Banknote size={21} /></span>
          <small>推定・取りこぼし売上</small>
          <strong>¥{potentialRevenue.toLocaleString()}</strong>
          <p>投稿 × 購買転換率65%の仮説</p>
        </article>
        <article className="metric-card">
          <span className="metric-icon"><Users size={21} /></span>
          <small>需要シグナル</small>
          <strong>{uniqueUsers}<em>人相当</em></strong>
          <p>匿名・集計値のみを表示</p>
        </article>
      </div>

      <div className="dashboard-grid">
        <section className="dashboard-panel demand-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">PRIORITY</span>
              <h2>補充候補ランキング</h2>
            </div>
            <Clock3 size={19} />
          </div>
          <div className="insight-list">
            {insights.slice(0, 5).map((insight, index) => {
              const product = products.find((item) => item.id === insight.productId)!
              const machine = machines.find((item) => item.id === insight.machineId)!
              return (
                <article className="insight-row" key={`${insight.machineId}-${insight.productId}`}>
                  <span className={`rank rank-${index + 1}`}>{index + 1}</span>
                  <span className="insight-emoji">{product.emoji}</span>
                  <div className="insight-copy">
                    <strong>{product.shortName}</strong>
                    <small>{machine.name}</small>
                  </div>
                  <div className="insight-value">
                    <strong>{insight.reports}件</strong>
                    <small>推定 ¥{insight.potentialRevenue}</small>
                  </div>
                </article>
              )
            })}
          </div>
        </section>

        <section className="dashboard-panel recommendation-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow"><Sparkles size={14} /> NEXT ACTION</span>
              <h2>今日の補充提案</h2>
            </div>
          </div>
          <div className="recommendation-main">
            <span className="recommendation-label">最優先</span>
            <h3>東展示棟へ<br /><b>水を +10本</b></h3>
            <p>水の欠品報告が集中しています。近隣機への移動も発生している想定です。</p>
          </div>
          <button className="outline-action">
            詳細を見る <ArrowUpRight size={17} />
          </button>
          <p className="demo-disclaimer">
            ※ 数値と提案はハッカソン用デモデータです。実運用では販売・補充データと結合して検証します。
          </p>
        </section>
      </div>
    </main>
  )
}
