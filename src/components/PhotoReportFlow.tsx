import { useEffect, useMemo, useState } from 'react'
import {
  AlertCircle,
  Camera,
  Check,
  CheckCircle2,
  ImageUp,
  ScanLine,
  Sparkles,
  X,
} from 'lucide-react'
import type {
  ExperienceOutcome,
  ExperienceReason,
  Product,
  ProductId,
  PurchaseExperience,
  StockStatus,
  VendingMachine,
} from '../types'

interface PhotoReportFlowProps {
  machine: VendingMachine
  products: Product[]
  initialProductId: ProductId
  onClose: () => void
  onPublish: (
    statuses: Partial<Record<ProductId, StockStatus>>,
    experience?: Omit<PurchaseExperience, 'id' | 'machineId' | 'observedAt'>,
  ) => Promise<void>
}

type Step = 'upload' | 'analyzing' | 'review'

const statusOptions: { value: StockStatus; label: string }[] = [
  { value: 'available', label: '在庫あり' },
  { value: 'low', label: '残りわずか' },
  { value: 'sold_out', label: '売り切れ' },
  { value: 'unknown', label: '判定できない' },
]

export default function PhotoReportFlow({
  machine,
  products,
  initialProductId,
  onClose,
  onPublish,
}: PhotoReportFlowProps) {
  const [step, setStep] = useState<Step>('upload')
  const [isPublishing, setIsPublishing] = useState(false)
  const [uploadedImage, setUploadedImage] = useState<string>()
  const [hasExperience, setHasExperience] = useState(false)
  const [wantedProductId, setWantedProductId] = useState(initialProductId)
  const [reason, setReason] = useState<ExperienceReason>('sold_out')
  const [outcome, setOutcome] = useState<ExperienceOutcome>('another_machine')
  const [statuses, setStatuses] = useState<
    Partial<Record<ProductId, StockStatus>>
  >(() => ({ ...machine.stock }))

  const previewImage = uploadedImage ?? machine.photoUrl
  const detectedCount = useMemo(
    () => Object.values(statuses).filter((status) => status !== 'unknown').length,
    [statuses],
  )
  const soldOutCount = useMemo(
    () => Object.values(statuses).filter((status) => status === 'sold_out').length,
    [statuses],
  )

  useEffect(
    () => () => {
      if (uploadedImage?.startsWith('blob:')) URL.revokeObjectURL(uploadedImage)
    },
    [uploadedImage],
  )

  const handleFile = (file?: File) => {
    if (!file) return
    if (uploadedImage?.startsWith('blob:')) URL.revokeObjectURL(uploadedImage)
    setUploadedImage(URL.createObjectURL(file))
  }

  const startAnalysis = () => {
    setStep('analyzing')
    window.setTimeout(() => setStep('review'), 1800)
  }

  const publish = async () => {
    setIsPublishing(true)
    try {
      await onPublish(
        statuses,
        hasExperience
          ? { wantedProductId, reason, outcome }
          : undefined,
      )
    } finally {
      setIsPublishing(false)
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="photo-flow"
        role="dialog"
        aria-modal="true"
        aria-labelledby="photo-flow-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="photo-flow-header">
          <div>
            <span className="eyebrow"><Camera size={14} /> PHOTO UPDATE</span>
            <h2 id="photo-flow-title">自販機の「今」を投稿</h2>
            <p>{machine.name}</p>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="閉じる">
            <X size={20} />
          </button>
        </header>

        <ol className="flow-steps" aria-label="投稿の進捗">
          <li className={step === 'upload' ? 'current' : 'done'}>
            <span>{step === 'upload' ? '1' : <Check size={13} />}</span> 写真
          </li>
          <li className={step === 'analyzing' ? 'current' : step === 'review' ? 'done' : ''}>
            <span>{step === 'review' ? <Check size={13} /> : '2'}</span> AI解析
          </li>
          <li className={step === 'review' ? 'current' : ''}>
            <span>3</span> 確認・公開
          </li>
        </ol>

        {step === 'upload' && (
          <div className="flow-body upload-step">
            <div className="photo-preview-card">
              <img src={previewImage} alt={`${machine.name}の投稿プレビュー`} />
              <span className="sample-ribbon">
                {uploadedImage ? '選択した写真' : 'サンプル写真'}
              </span>
            </div>
            <div className="upload-copy">
              <h3>商品棚全体が入るように、<br />正面から1枚</h3>
              <p>売り切れランプと商品ラベルが見える明るさで撮影すると、判定しやすくなります。</p>
            </div>
            <div className="upload-actions">
              <label className="secondary-action file-action">
                <ImageUp size={18} /> 写真を選ぶ
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(event) => handleFile(event.target.files?.[0])}
                />
              </label>
              <button className="primary-action" onClick={startAnalysis}>
                <Sparkles size={18} /> この写真を解析する
              </button>
            </div>
            <p className="mock-notice"><AlertCircle size={14} /> モックではサンプルの解析結果を表示します。写真は外部へ送信されません。</p>
          </div>
        )}

        {step === 'analyzing' && (
          <div className="flow-body analyzing-step">
            <div className="scanning-photo">
              <img src={previewImage} alt="解析対象の自販機" />
              <span className="scan-line" />
              <span className="scan-corners" />
            </div>
            <div className="analysis-copy">
              <span className="analysis-icon"><ScanLine size={25} /></span>
              <h3>商品と在庫表示を解析中…</h3>
              <p>商品ラベルを照合しています</p>
              <div className="analysis-progress"><span /></div>
            </div>
          </div>
        )}

        {step === 'review' && (
          <div className="flow-body review-step">
            <div className="analysis-summary">
              <img src={previewImage} alt="解析した自販機" />
              <span className="summary-check"><CheckCircle2 size={20} /></span>
              <div>
                <span className="eyebrow">AI ANALYSIS MOCK</span>
                <strong>{detectedCount}銘柄を検出</strong>
                <small>売り切れ候補 {soldOutCount}件</small>
              </div>
            </div>

            <div className="review-heading">
              <div>
                <h3>解析候補を確認</h3>
                <p>間違いがあれば公開前に修正できます。</p>
              </div>
              <span>編集可能</span>
            </div>

            <div className="detected-products">
              {products.map((product) => {
                const status = statuses[product.id] ?? 'unknown'
                return (
                  <label className="detected-row" key={product.id}>
                    <span className="detected-emoji">{product.emoji}</span>
                    <span className="detected-name">
                      <strong>{product.shortName}</strong>
                      <small>{product.name}</small>
                    </span>
                    <select
                      className={`status-select select-${status}`}
                      value={status}
                      onChange={(event) =>
                        setStatuses((current) => ({
                          ...current,
                          [product.id]: event.target.value as StockStatus,
                        }))
                      }
                      aria-label={`${product.shortName}の状態`}
                    >
                      {statusOptions.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                )
              })}
            </div>

            <label className="experience-toggle">
              <input
                type="checkbox"
                checked={hasExperience}
                onChange={(event) => setHasExperience(event.target.checked)}
              />
              <span className="toggle-box"><Check size={14} /></span>
              <span>
                <strong>買えなかった体験も追加する</strong>
                <small>選択式・約10秒</small>
              </span>
            </label>

            {hasExperience && (
              <div className="experience-fields">
                <label>
                  <span>欲しかった銘柄</span>
                  <select
                    value={wantedProductId}
                    onChange={(event) => setWantedProductId(event.target.value as ProductId)}
                  >
                    {products.map((product) => (
                      <option key={product.id} value={product.id}>{product.shortName}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>買えなかった理由</span>
                  <select value={reason} onChange={(event) => setReason(event.target.value as ExperienceReason)}>
                    <option value="sold_out">売り切れランプが点灯</option>
                    <option value="not_found">商品がラインナップになかった</option>
                    <option value="payment_issue">決済できなかった</option>
                  </select>
                </label>
                <label>
                  <span>その後どうした？</span>
                  <select value={outcome} onChange={(event) => setOutcome(event.target.value as ExperienceOutcome)}>
                    <option value="another_machine">別の自販機で買った</option>
                    <option value="convenience_store">コンビニで買った</option>
                    <option value="different_product">別の商品を買った</option>
                    <option value="gave_up">買うのを諦めた</option>
                  </select>
                </label>
              </div>
            )}

            <div className="publish-bar">
              <div>
                <strong>投稿で +10 pt</strong>
                <small>最終確認時刻を「たった今」に更新</small>
              </div>
              <button className="primary-action" onClick={publish} disabled={isPublishing}>
                <CheckCircle2 size={18} /> {isPublishing ? '公開中…' : 'この内容で公開'}
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
