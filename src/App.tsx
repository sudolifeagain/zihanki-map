import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
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
  RefreshCw,
  Search,
  Sparkles,
} from 'lucide-react'
import InsightsView from './components/InsightsView'
import MapView from './components/MapView'
import PhotoReportFlow from './components/PhotoReportFlow'
import {
  ApiError,
  fetchExperiences,
  fetchMachines,
  fetchReports,
  postExperience,
  postReports,
} from './api'
import {
  assessStock,
  displayStatus,
  findAlternatives,
  formatConfidence,
  formatFreshness,
} from './domain'
import type {
  InventoryReport,
  Product,
  ProductId,
  PurchaseExperience,
  StockStatus,
  VendingMachine,
} from './types'

type View = 'map' | 'insights'
type DataStatus = 'loading' | 'ready' | 'error'

function publishErrorMessage(error: unknown): string {
  const reason = error instanceof ApiError ? error.message : ''
  if (reason === 'machine_cooldown') {
    return 'この自販機へは直前に投稿があります。数分おいてからお試しください'
  }
  if (reason === 'hourly_limit') {
    return '短時間の投稿が多いため受け付けを制限しました。しばらくお待ちください'
  }
  if (reason === 'writes_paused') {
    return '現在、投稿の受け付けを一時停止しています'
  }
  return '投稿を送信できませんでした。もう一度お試しください'
}

const statusCopy: Record<StockStatus, { label: string; detail: string }> = {
  available: { label: '在庫あり', detail: '買える可能性が高い' },
  low: { label: '残りわずか', detail: '早めがおすすめ' },
  sold_out: { label: '売り切れ', detail: '近くの候補を案内します' },
  unknown: { label: '未確認', detail: '最近の投稿がありません' },
}

function App() {
  const [view, setView] = useState<View>('map')
  const [dataStatus, setDataStatus] = useState<DataStatus>('loading')
  const [machines, setMachines] = useState<VendingMachine[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [reports, setReports] = useState<InventoryReport[]>([])
  const [experiences, setExperiences] = useState<PurchaseExperience[]>([])
  const [selectedProductId, setSelectedProductId] = useState<ProductId>('water')
  const [selectedMachineId, setSelectedMachineId] = useState('east-entrance')
  const [brandQuery, setBrandQuery] = useState('')
  const [locationQuery, setLocationQuery] = useState('東京ビッグサイト')
  const [isPhotoFlowOpen, setIsPhotoFlowOpen] = useState(false)
  const [points, setPoints] = useState(120)
  const [toast, setToast] = useState('')

  const loadAll = useCallback(async () => {
    setDataStatus('loading')
    try {
      const [machinesRes, reportsRes, experiencesRes] = await Promise.all([
        fetchMachines(),
        fetchReports(),
        fetchExperiences(),
      ])
      setMachines(machinesRes.machines)
      setProducts(machinesRes.products)
      setReports(reportsRes.reports)
      setExperiences(experiencesRes.experiences)
      setDataStatus('ready')
    } catch {
      setDataStatus('error')
    }
  }, [])

  useEffect(() => {
    loadAll()
  }, [loadAll])

  const filteredProducts = useMemo(() => {
    const normalized = brandQuery.trim().toLowerCase()
    if (!normalized) return products
    return products.filter((product) =>
      `${product.name} ${product.shortName} ${product.brand}`
        .toLowerCase()
        .includes(normalized),
    )
  }, [products, brandQuery])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(''), 2800)
    return () => window.clearTimeout(timer)
  }, [toast])

  if (dataStatus !== 'ready') {
    return (
      <div className="app-shell status-shell">
        <div className="status-card">
          {dataStatus === 'loading' ? (
            <>
              <span className="status-spinner" aria-hidden="true" />
              <strong>自販機データを読み込んでいます…</strong>
            </>
          ) : (
            <>
              <span className="status-icon"><AlertTriangle size={22} /></span>
              <strong>データを読み込めませんでした</strong>
              <p>通信状況を確認して、もう一度お試しください。</p>
              <button className="primary-action" onClick={loadAll}>
                <RefreshCw size={16} /> 再読み込み
              </button>
            </>
          )}
        </div>
      </div>
    )
  }

  const selectedProduct = products.find(
    (product) => product.id === selectedProductId,
  )!
  const selectedMachine = machines.find(
    (machine) => machine.id === selectedMachineId,
  )!
  const assessment = assessStock(selectedMachine, selectedProductId, reports)
  const selectedStatus = displayStatus(assessment)
  const registeredStatus = selectedMachine.stock[selectedProductId] ?? 'unknown'
  const alternatives = findAlternatives(
    machines,
    reports,
    selectedProductId,
    selectedMachineId,
  )

  const searchLocation = () => {
    const normalized = locationQuery.trim()
    if (!normalized) setLocationQuery('東京ビッグサイト')
    setToast('東京ビッグサイト周辺の登録済み自販機を表示しました')
  }

  const publishPhotoReport = async (
    statuses: Partial<Record<ProductId, StockStatus>>,
    experience?: Omit<PurchaseExperience, 'id' | 'machineId' | 'observedAt'>,
    photoId?: string,
  ) => {
    try {
      const { reports: newReports } = await postReports(
        selectedMachineId,
        statuses,
        photoId,
      )
      setReports((current) => [...newReports, ...current])

      if (experience) {
        const { experience: newExperience } = await postExperience({
          machineId: selectedMachineId,
          ...experience,
        })
        setExperiences((current) => [newExperience, ...current])
      }

      setPoints((current) => current + 10)
      setIsPhotoFlowOpen(false)
      setToast('写真から商品ラインナップを更新しました +10pt')
    } catch (error) {
      setToast(publishErrorMessage(error))
    }
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
                <small>確認済み在庫あり {machines.filter((machine) => displayStatus(assessStock(machine, selectedProductId, reports)) === 'available').length}台 / 登録 {machines.length}台</small>
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
                <span className="machine-photo">
                  <img src={selectedMachine.photoUrl} alt={`${selectedMachine.name}の自販機`} />
                  {!selectedMachine.photoLocationMatches && (
                    <span className="photo-location-warning" title="この写真の撮影地は地図上の位置と一致しません">
                      撮影地×
                    </span>
                  )}
                </span>
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
                    {assessment.basis === 'registered'
                      ? `登録は「${statusCopy[registeredStatus].label}」・直近の確認なし`
                      : statusCopy[selectedStatus].detail}
                  </span>
                </div>
                <div className="freshness">
                  <Clock3 size={14} />
                  {assessment.basis === 'observation' ? (
                    <span className="freshness-detail">
                      <span>{formatFreshness(assessment.observedAt)}</span>
                      <span className="freshness-confidence">
                        信頼度 {formatConfidence(assessment.confidence)}
                        {assessment.agreeingReports > 1 && `・${assessment.agreeingReports}件一致`}
                        {assessment.conflictingReports > 0 && `・相反${assessment.conflictingReports}件`}
                      </span>
                    </span>
                  ) : (
                    <span className="freshness-detail">
                      <span className="freshness-unconfirmed">未確認</span>
                      <span>登録時のラインナップ</span>
                    </span>
                  )}
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
