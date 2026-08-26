import { useMemo, useState } from 'react'
import {
  AlertTriangle,
  Banknote,
  BarChart3,
  Download,
  Info,
  Sparkles,
  Users,
} from 'lucide-react'
import {
  buildAnalyticsReport,
  DEFAULT_CONVERSION_RATE,
  toCsv,
} from '../analytics'
import type { AnalyticsEvent, SalesActual } from '../analytics'
import type {
  InventoryReport,
  Product,
  ProductId,
  PurchaseExperience,
  VendingMachine,
} from '../types'

interface InsightsViewProps {
  reports: InventoryReport[]
  experiences: PurchaseExperience[]
  machines: VendingMachine[]
  products: Product[]
  events: AnalyticsEvent[]
  actuals: SalesActual[]
}

type PeriodPreset = 'all' | '24h' | '7d' | string

function resolvePeriod(
  preset: PeriodPreset,
  events: AnalyticsEvent[],
): { from?: string; to?: string; label: string } {
  if (preset === '24h') {
    return {
      from: new Date(Date.now() - 24 * 3_600_000).toISOString(),
      label: '直近24時間',
    }
  }
  if (preset === '7d') {
    return {
      from: new Date(Date.now() - 7 * 24 * 3_600_000).toISOString(),
      label: '直近7日',
    }
  }
  if (preset.startsWith('event:')) {
    const event = events.find((item) => item.id === preset.slice('event:'.length))
    if (event) {
      return { from: event.startsAt, to: event.endsAt, label: event.name }
    }
  }
  return { label: '全期間' }
}

export default function InsightsView({
  reports,
  experiences,
  machines,
  products,
  events,
  actuals,
}: InsightsViewProps) {
  const [period, setPeriod] = useState<PeriodPreset>('all')
  const [machineId, setMachineId] = useState('')
  const [productId, setProductId] = useState('')
  const [conversionRate, setConversionRate] = useState(DEFAULT_CONVERSION_RATE)

  const resolved = resolvePeriod(period, events)
  const report = useMemo(
    () =>
      buildAnalyticsReport(
        reports,
        experiences,
        machines,
        products,
        actuals,
        {
          from: resolved.from,
          to: resolved.to,
          machineId: machineId || undefined,
          productId: (productId as ProductId) || undefined,
        },
        conversionRate,
      ),
    [
      reports,
      experiences,
      machines,
      products,
      actuals,
      resolved.from,
      resolved.to,
      machineId,
      productId,
      conversionRate,
    ],
  )

  const busiestHours = [...report.byHour]
    .filter((bucket) => bucket.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 3)

  const downloadCsv = () => {
    const blob = new Blob([toCsv(report)], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `nomitai-insights-${new Date().toISOString().slice(0, 10)}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <main className="insights-page">
      <section className="insights-hero">
        <div>
          <span className="eyebrow"><BarChart3 size={15} /> VENDOR INSIGHTS</span>
          <h1>売上にならなかった需要を、<br />次の補充へ。</h1>
          <p>購入実績だけでは見えない「欲しかった」を投稿から集計しています。</p>
        </div>
        <button className="outline-action" onClick={downloadCsv}>
          <Download size={16} /> CSVで書き出す
        </button>
      </section>

      <section className="insights-filters" aria-label="集計条件">
        <label>
          <span>期間・イベント</span>
          <select value={period} onChange={(event) => setPeriod(event.target.value)}>
            <option value="all">全期間</option>
            <option value="24h">直近24時間</option>
            <option value="7d">直近7日</option>
            {events.map((item) => (
              <option key={item.id} value={`event:${item.id}`}>{item.name}</option>
            ))}
          </select>
        </label>
        <label>
          <span>自販機</span>
          <select value={machineId} onChange={(event) => setMachineId(event.target.value)}>
            <option value="">すべて</option>
            {machines.map((machine) => (
              <option key={machine.id} value={machine.id}>{machine.name}</option>
            ))}
          </select>
        </label>
        <label>
          <span>銘柄</span>
          <select value={productId} onChange={(event) => setProductId(event.target.value)}>
            <option value="">すべて</option>
            {products.map((product) => (
              <option key={product.id} value={product.id}>{product.shortName}</option>
            ))}
          </select>
        </label>
        <label>
          <span>購買転換率(仮係数)</span>
          <input
            type="number"
            min={0}
            max={1}
            step={0.05}
            value={conversionRate}
            onChange={(event) => {
              const next = Number(event.target.value)
              if (Number.isFinite(next)) setConversionRate(Math.min(1, Math.max(0, next)))
            }}
          />
        </label>
      </section>

      <div className="metric-grid">
        <article className="metric-card accent-card">
          <span className="metric-icon"><AlertTriangle size={21} /></span>
          <small>欠品投稿</small>
          <strong>{report.soldOutReportCount}<em>件</em></strong>
          <p>{resolved.label}・実測</p>
        </article>
        <article className="metric-card">
          <span className="metric-icon"><Banknote size={21} /></span>
          <small>取りこぼし売上</small>
          <strong>¥{report.estimatedRevenue.toLocaleString()}</strong>
          <p className="estimate-note">
            推定 — 欠品投稿 {report.soldOutReportCount}件 × 係数{report.conversionRate} × 商品単価
          </p>
        </article>
        <article className="metric-card">
          <span className="metric-icon"><Users size={21} /></span>
          <small>買えなかった体験</small>
          <strong>{report.experienceCount}<em>件</em></strong>
          <p>匿名・集計値のみ・実測</p>
        </article>
        <article className="metric-card">
          <span className="metric-icon"><BarChart3 size={21} /></span>
          <small>実測販売本数</small>
          <strong>
            {report.hasActuals ? report.actualUnitsSold?.toLocaleString() : '—'}
          </strong>
          <p>{report.hasActuals ? '販売・補充CSVより' : 'data/sales_actuals.csv が未登録'}</p>
        </article>
      </div>

      {!report.hasActuals && (
        <p className="estimate-banner" role="note">
          <Info size={15} /> 実測の販売・補充データが未登録のため、売上に関わる数値はすべて<strong>推定</strong>です。
          data/sales_actuals.csv を登録すると実測値と並べて比較できます。
        </p>
      )}

      <div className="dashboard-grid">
        <section className="dashboard-panel demand-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">PRIORITY</span>
              <h2>補充候補ランキング</h2>
            </div>
          </div>
          {report.rows.length === 0 ? (
            <p className="ranked-empty">この条件では欠品投稿がありません。期間や絞り込みを広げてください。</p>
          ) : (
            <div className="insight-table-wrap">
              <table className="insight-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>場所・銘柄</th>
                    <th>欠品投稿<small>実測</small></th>
                    <th>取りこぼし<small>推定</small></th>
                    <th>販売<small>実測</small></th>
                    <th>補充<small>実測</small></th>
                  </tr>
                </thead>
                <tbody>
                  {report.rows.map((row, index) => (
                    <tr key={`${row.machineId}-${row.productId}`}>
                      <td><span className={`rank rank-${index + 1}`}>{index + 1}</span></td>
                      <td>
                        <strong>{row.productName}</strong>
                        <small>{row.machineName}</small>
                      </td>
                      <td>{row.soldOutReports}件</td>
                      <td>
                        {row.estimatedMissedSales}本
                        <small>¥{row.estimatedRevenue.toLocaleString()}</small>
                      </td>
                      <td>{row.actualUnitsSold ?? '—'}</td>
                      <td>{row.actualRestockUnits ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="dashboard-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow"><Sparkles size={14} /> BEHAVIOUR</span>
              <h2>買えなかった後の行動</h2>
            </div>
          </div>
          {report.experienceCount === 0 ? (
            <p className="ranked-empty">この条件では買えなかった体験の投稿がありません。</p>
          ) : (
            <>
              <ul className="breakdown-list">
                {report.byOutcome.map((row) => (
                  <li key={row.key}>
                    <span>{row.label}</span>
                    <span className="breakdown-bar">
                      <span style={{ width: `${(row.count / report.experienceCount) * 100}%` }} />
                    </span>
                    <b>{row.count}</b>
                  </li>
                ))}
              </ul>
              <h3 className="breakdown-subhead">買えなかった理由</h3>
              <ul className="breakdown-list">
                {report.byReason.map((row) => (
                  <li key={row.key}>
                    <span>{row.label}</span>
                    <span className="breakdown-bar">
                      <span style={{ width: `${(row.count / report.experienceCount) * 100}%` }} />
                    </span>
                    <b>{row.count}</b>
                  </li>
                ))}
              </ul>
            </>
          )}

          <h3 className="breakdown-subhead">欠品が集中する時間帯</h3>
          {busiestHours.length === 0 ? (
            <p className="ranked-empty">この条件では欠品投稿がありません。</p>
          ) : (
            <ul className="breakdown-list">
              {busiestHours.map((bucket) => (
                <li key={bucket.hour}>
                  <span>{String(bucket.hour).padStart(2, '0')}時台</span>
                  <span className="breakdown-bar">
                    <span style={{ width: `${(bucket.count / report.soldOutReportCount) * 100}%` }} />
                  </span>
                  <b>{bucket.count}</b>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  )
}
