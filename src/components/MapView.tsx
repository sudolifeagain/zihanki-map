import L from 'leaflet'
import { MapContainer, Marker, TileLayer, ZoomControl } from 'react-leaflet'
import { assessStock, displayStatus } from '../domain'
import type {
  InventoryReport,
  Product,
  ProductId,
  StockStatus,
  VendingMachine,
} from '../types'

interface MapViewProps {
  machines: VendingMachine[]
  reports: InventoryReport[]
  selectedProduct: Product
  selectedMachineId: string
  onSelect: (machineId: string) => void
}

const markerLabel: Record<StockStatus, string> = {
  available: '在庫あり',
  low: '残りわずか',
  sold_out: '売り切れ',
  unknown: '未確認',
}

function makeIcon(
  product: Product,
  status: StockStatus,
  selected: boolean,
): L.DivIcon {
  return L.divIcon({
    className: 'machine-marker-shell',
    html: `<div class="machine-marker status-${status} ${selected ? 'is-selected' : ''}">
      <span class="marker-emoji">${product.emoji}</span>
      <span class="marker-label">${markerLabel[status]}</span>
    </div>`,
    iconAnchor: [43, 46],
    iconSize: [86, 48],
  })
}

export default function MapView({
  machines,
  reports,
  selectedProduct,
  selectedMachineId,
  onSelect,
}: MapViewProps) {
  const tileUrl =
    import.meta.env.VITE_MAP_TILE_URL ??
    'https://tile.openstreetmap.org/{z}/{x}/{y}.png'

  return (
    <MapContainer
      center={[35.63005, 139.7942]}
      zoom={16}
      minZoom={13}
      scrollWheelZoom
      zoomControl={false}
      className="map"
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>'
        url={tileUrl}
      />
      <ZoomControl position="bottomright" />
      {machines.map((machine) => {
        const status = displayStatus(
          assessStock(machine, selectedProduct.id as ProductId, reports),
        )
        return (
          <Marker
            key={`${machine.id}-${selectedProduct.id}-${status}`}
            position={[machine.lat, machine.lng]}
            icon={makeIcon(
              selectedProduct,
              status,
              machine.id === selectedMachineId,
            )}
            eventHandlers={{ click: () => onSelect(machine.id) }}
            title={`${machine.name}: ${markerLabel[status]}`}
          />
        )
      })}
    </MapContainer>
  )
}
