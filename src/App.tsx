import { useEffect, useMemo, useState } from 'react'
import {
  BarChart3,
  Camera,
  CheckCircle2,
  ChevronRight,
  CircleUserRound,
  Clock3,
  LocateFixed,
  Map as MapIcon,
  MapPin,
  Navigation,
  Search,
  Sparkles,
} from 'lucide-react'
import InsightsView from './components/InsightsView'
import MapView from './components/MapView'
import PhotoReportFlow from './components/PhotoReportFlow'
import { machines, products, seedReports } from './data/demo'
import {
  deriveStockStatus,
  findAlternatives,
  formatFreshness,
  latestReport,
} from './domain'
import type {
  InventoryReport,
  ProductId,
  PurchaseExperience,
  StockStatus,
} from './types'

type View = 'map' | 'insights'

const statusCopy: Record<StockStatus, { label: string; detail: string }> = {
  available: { label: '在庫あり', detail: '買える可能性が高い' },
  low: { label: '残りわずか', detail: '早めがおすすめ' },
  sold_out: { label: '売り切れ', detail: '近くの候補を案内します' },
  unknown: { label: '未確認', detail: '最近の投稿がありません' },
}

function loadReports(): InventoryReport[] {
  try {
    const saved = localStorage.getItem('nomitai-reports')
    if (saved) return [...(JSON.parse(saved) as InventoryReport[]), ...seedReports]
  } catch {
    // 壊れたデモデータは無視して初期状態に戻す。
  }
  return seedReports
}

function loadExperiences(): PurchaseExperience[] {
  try {
    const saved = localStorage.getItem('nomitai-experiences')
    return saved ? (JSON.parse(saved) as PurchaseExperience[]) : []
  } catch {
    return []
  }
}

function App() {
  const [view, setView] = useState<View>('map')
  const [selectedProductId, setSelectedProductId] = useState<ProductId>('water')
  const [selectedMachineId, setSelectedMachineId] = useState('east-entrance')
  const [reports, setReports] = useState<InventoryReport[]>(loadReports)
  const [experiences, setExperiences] =
    useState<PurchaseExperience[]>(loadExperiences)
  const [brandQuery, setBrandQuery] = useState('')
  const [locationQuery, setLocationQuery] = useState('東京ビッグサイト')
  const [isPhotoFlowOpen, setIsPhotoFlowOpen] = useState(false)
  const [points, setPoints] = useState(120)
  const [toast, setToast] = useState('')

  const selectedProduct = products.find(
    (product) => product.id === selectedProductId,
  )!
  const selectedMachine = machines.find(
    (machine) => machine.id === selectedMachineId,
  )!
  const selectedStatus = deriveStockStatus(
    selectedMachine,
    selectedProductId,
    reports,
  )
  const selectedLatestReport = latestReport(
    reports,
    selectedMachineId,
    selectedProductId,
  )
  const alternatives = findAlternatives(
    machines,
    reports,
    selectedProductId,
    selectedMachineId,
  )

  const filteredProducts = useMemo(() => {
    const normalized = brandQuery.trim().toLowerCase()
    if (!normalized) return products
    return products.filter((product) =>
      `${product.name} ${product.shortName} ${product.brand}`
        .toLowerCase()
        .includes(normalized),
    )
  }, [brandQuery])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(''), 2800)
    return () => window.clearTimeout(timer)
  }, [toast])

  const searchLocation = () => {
    const normalized = locationQuery.trim()
    if (!normalized) setLocationQuery('東京ビッグサイト')
    setToast('東京ビッグサイト周辺の登録済み自販機を表示しました')
  }

  const publishPhotoReport = (
    statuses: Partial<Record<ProductId, StockStatus>>,
    experience?: Omit<PurchaseExperience, 'id' | 'machineId' | 'observedAt'>,
  ) => {
    const observedAt = new Date().toISOString()
    const statusReports = Object.entries(statuses)
      .filter(
        (entry): entry is [ProductId, Exclude<StockStatus, 'unknown'>] =>
          entry[1] !== 'unknown',
      )
      .map(([productId, status], index): InventoryReport => ({
        id: `photo-${Date.now()}-${index}`,
        machineId: selectedMachineId,
        productId,
        type: status,
        observedAt,
        source: 'user',
      }))

    const userReports = [
      ...statusReports,
      ...reports.filter((report) => report.source === 'user'),
    ]
    localStorage.setItem('nomitai-reports', JSON.stringify(userReports))
    setReports([...statusReports, ...reports])

    if (experience) {
      const newExperience: PurchaseExperience = {
        ...experience,
        id: `experience-${Date.now()}`,
        machineId: selectedMachineId,
        observedAt,
      }
      const nextExperiences = [newExperience, ...experiences]
      localStorage.setItem('nomitai-experiences', JSON.stringify(nextExperiences))
      setExperiences(nextExperiences)
    }

    setPoints((current) => current + 10)
    setIsPhotoFlowOpen(false)
    setToast('写真から商品ラインナップを更新しました +10pt')
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <button className="brand" onClick={() => setView('map')} aria-label="ノミタイ ホーム">
          <span className="brand-mark">の</span>
          <span>
            <strong>ノミタイ</strong>
            <small>VENDING FINDER</small>
          </span>
        </button>
        <nav className="main-nav" aria-label="メインナビゲーション">
          <button className={view === 'map' ? 'active' : ''} onClick={() => setView('map')}>
            <MapIcon size={17} /> マップ
          </button>
          <button className={view === 'insights' ? 'active' : ''} onClick={() => setView('insights')}>
            <BarChart3 size={17} /> ベンダー分析
          </button>
        </nav>
        <div className="header-account">
          <button className="quick-post" onClick={() => setIsPhotoFlowOpen(true)}>
            <Camera size={16} /> 写真を投稿
          </button>
          <span className="points"><Sparkles size={14} /> {points} pt</span>
          <CircleUserRound size={24} />
        </div>
      </header>

      {view === 'map' ? (
        <main className="map-page">
          <section className="map-stage" aria-label="自動販売機マップ">
            <MapView
              machines={machines}
              reports={reports}
              selectedProduct={selectedProduct}
              selectedMachineId={selectedMachineId}
              onSelect={setSelectedMachineId}
            />
            <div className="demo-badge"><span /> 東京ビッグサイト周辺・デモデータ</div>
            <div className="map-result-card">
              <span>{selectedProduct.emoji}</span>
              <div>
                <strong>{selectedProduct.shortName}</strong>
                <small>在庫あり {machines.filter((machine) => deriveStockStatus(machine, selectedProductId, reports) === 'available').length}台 / 登録 {machines.length}台</small>
              </div>
            </div>
            <button className="location-button" aria-label="現在地へ移動">
              <LocateFixed size={21} />
            </button>
          </section>

          <aside className="search-panel">
            <div className="search-intro">
              <span className="eyebrow"><MapPin size={14} /> LIVE VENDING MAP</span>
              <h1>飲みたい銘柄を、<br />今買える場所へ。</h1>
              <p>投稿写真から読み取った、商品ラインナップと直近の状況を表示します。</p>
            </div>

            <div className="finder-fields">
              <label className="finder-field">
                <span>場所</span>
                <div>
                  <MapPin size={18} />
                  <input
                    value={locationQuery}
                    onChange={(event) => setLocationQuery(event.target.value)}
                    onKeyDown={(event) => event.key === 'Enter' && searchLocation()}
                    placeholder="駅名・施設名"
                  />
                  <button onClick={searchLocation} aria-label="場所を検索"><Search size={17} /></button>
                </div>
              </label>
              <label className="finder-field">
                <span>飲みたい銘柄</span>
                <div>
                  <Search size={18} />
                  <input
                    value={brandQuery}
                    onChange={(event) => setBrandQuery(event.target.value)}
                    placeholder="例：伊右衛門、ペプシ"
                  />
                </div>
              </label>
            </div>

            <div className="product-chips" aria-label="商品を選択">
              {filteredProducts.map((product) => (
                <button
                  key={product.id}
                  className={selectedProductId === product.id ? 'selected' : ''}
                  onClick={() => setSelectedProductId(product.id)}
                >
                  <span>{product.emoji}</span> {product.shortName}
                </button>
              ))}
              {filteredProducts.length === 0 && <small className="empty-products">該当する銘柄はありません</small>}
            </div>

            <section className="machine-card">
              <div className="machine-photo-row">
                <img src={selectedMachine.photoUrl} alt={`${selectedMachine.name}の自販機`} />
                <div className="machine-heading">
                  <div>
                    <span className="distance"><Navigation size={13} /> 徒歩 約{Math.max(1, Math.round(selectedMachine.distanceMeters / 70))}分</span>
                    <h2>{selectedMachine.name}</h2>
                    <p>{selectedMachine.landmark}</p>
                  </div>
                </div>
                <span className={`status-badge status-${selectedStatus}`}>
                  {statusCopy[selectedStatus].label}
                </span>
              </div>

              <div className="selected-product-card">
                <span className="selected-product-emoji" style={{ background: `${selectedProduct.color}18` }}>
                  {selectedProduct.emoji}
                </span>
                <div className="selected-product-copy">
                  <strong>{selectedProduct.name}</strong>
                  <small>{selectedProduct.brand} ・ ¥{selectedProduct.price}</small>
                  <span className={`stock-copy text-${selectedStatus}`}>
                    {statusCopy[selectedStatus].detail}
                  </span>
                </div>
                <div className="freshness">
                  <Clock3 size={14} />
                  <span>{formatFreshness(selectedLatestReport?.observedAt)}</span>
                </div>
              </div>

              {selectedStatus === 'sold_out' && alternatives[0] && (
                <button
                  className="alternative-card"
                  onClick={() => setSelectedMachineId(alternatives[0].id)}
                >
                  <span className="alternative-icon"><CheckCircle2 size={20} /></span>
                  <span>
                    <small>{selectedProduct.shortName}が買えそうな最寄り</small>
                    <strong>{alternatives[0].name}</strong>
                    <em>{alternatives[0].distanceMeters}m先・在庫あり報告</em>
                  </span>
                  <ChevronRight size={20} />
                </button>
              )}

              <button className="primary-action" onClick={() => setIsPhotoFlowOpen(true)}>
                <Camera size={18} /> 写真でラインナップを更新
              </button>
              <p className="action-hint">AI候補を確認・修正してから公開する解析モックです</p>
            </section>
          </aside>
        </main>
      ) : (
        <InsightsView
          reports={reports}
          experiences={experiences}
          machines={machines}
          products={products}
        />
      )}

      {isPhotoFlowOpen && (
        <PhotoReportFlow
          machine={selectedMachine}
          products={products}
          initialProductId={selectedProductId}
          onClose={() => setIsPhotoFlowOpen(false)}
          onPublish={publishPhotoReport}
        />
      )}
      {toast && <div className="toast"><CheckCircle2 size={19} /> {toast}</div>}
    </div>
  )
}

export default App
