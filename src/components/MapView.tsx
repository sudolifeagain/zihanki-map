import { useEffect } from 'react'
import L from 'leaflet'
import { MapContainer, Marker, TileLayer, ZoomControl, useMap } from 'react-leaflet'
import { assessStock, displayStatus } from '../domain'
import type { LatLng } from '../domain'
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
  /** 検索や現在地でここへ移動する。 */
  center?: LatLng
  /** 現在地が取れているときだけ現在地マーカーを出す。 */
  currentLocation?: LatLng
}

/** center が変わったら地図を寄せる。Leafletは宣言的に中心を変えられないため命令的に動かす。 */
function RecenterOnChange({ center }: { center?: LatLng }) {
  const map = useMap()

  useEffect(() => {
    if (center) map.flyTo([center.lat, center.lng], Math.max(map.getZoom(), 16))
  }, [center, map])

  return null
}

const currentLocationIcon = L.divIcon({
  className: 'current-location-shell',
  html: '<div class="current-location-dot" role="img" aria-label="現在地"></div>',
  iconAnchor: [9, 9],
  iconSize: [18, 18],
})

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
  center,
  currentLocation,
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
      <RecenterOnChange center={center} />
      {currentLocation && (
        <Marker
          position={[currentLocation.lat, currentLocation.lng]}
          icon={currentLocationIcon}
          title="現在地"
        />
      )}
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
