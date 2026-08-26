import { Check, MapPin, X } from 'lucide-react'
import type { Product, ReportType, VendingMachine } from '../types'

interface ReportSheetProps {
  machine: VendingMachine
  product: Product
  onClose: () => void
  onSubmit: (type: ReportType) => void
}

export default function ReportSheet({
  machine,
  product,
  onClose,
  onSubmit,
}: ReportSheetProps) {
  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="report-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="report-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="sheet-handle" />
        <button className="icon-button sheet-close" onClick={onClose} aria-label="閉じる">
          <X size={20} />
        </button>
        <span className="eyebrow">30秒でおわります</span>
        <h2 id="report-title">今の状況を教えてください</h2>
        <p className="sheet-location">
          <MapPin size={16} /> {machine.name}
        </p>

        <div className="report-product">
          <span className="report-product-emoji">{product.emoji}</span>
          <div>
            <strong>{product.name}</strong>
            <small>{product.brand}</small>
          </div>
        </div>

        <div className="report-actions">
          <button className="report-choice sold-out-choice" onClick={() => onSubmit('sold_out')}>
            <span>売り切れていた</span>
            <small>欲しかったのに買えなかった</small>
          </button>
          <button className="report-choice available-choice" onClick={() => onSubmit('available')}>
            <span><Check size={19} /> 買えた・見かけた</span>
            <small>在庫があることを確認した</small>
          </button>
        </div>

        <p className="reward-note">投稿するとデモポイント +10 pt</p>
      </section>
    </div>
  )
}
