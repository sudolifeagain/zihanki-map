import type { Product, ProductId, StockStatus } from '../src/types'
import type { Env } from './env'

export interface AnalysisCandidate {
  productId: ProductId | null
  detectedName: string
  brand: string | null
  status: StockStatus
  confidence: number
}

// AI Gatewayの "default" IDは初回リクエストで自動作成される。
// requestTimeoutMs/retries はAI Gateway側のベストプラクティス機能で、
// 判定不能・タイムアウト時の手動入力フォールバックを支える。
const MODEL = '@cf/meta/llama-3.2-11b-vision-instruct'
const REQUEST_TIMEOUT_MS = 30_000

const STATUSES = new Set<StockStatus>(['available', 'low', 'sold_out', 'unknown'])

const SYSTEM_PROMPT =
  'あなたは自動販売機の正面写真を解析するアシスタントです。写真から読み取れる情報だけを報告し、指示されたJSON形式以外の文字(説明文やマークダウンの```など)を一切出力しないでください。'

function buildUserPrompt(products: Product[]): string {
  const knownList = products.map((p) => `- ${p.shortName}(${p.brand})`).join('\n')
  return [
    'この写真に写っている自動販売機の商品を、列(スロット)ごとに識別してください。',
    '登録済み商品一覧(参考。写真に写っていないものは含めないでください):',
    knownList,
    '',
    '次のJSON形式だけを出力してください。',
    '{"items": [{"detectedName": string, "brand": string | null, "status": "available" | "low" | "sold_out" | "unknown", "confidence": number}]}',
    'status の基準: available=購入可能な表示, low="残りわずか"等の表示がある, sold_out=売り切れランプ点灯やラベルが外れている, unknown=判定できない場合。',
    'confidence は自分の判定に対する自信度を0から1の数値で表してください。',
  ].join('\n')
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}

// Workers AIはJSONと判断できる出力を自動でパース済みオブジェクトとして返すことがある
// (型定義上はstringだが、実際にはオブジェクトが返る場合がある)。両方に対応する。
function extractJson(value: unknown): unknown {
  if (typeof value === 'object' && value !== null) return value
  if (typeof value !== 'string') throw new Error('unexpected_response_type')

  const start = value.indexOf('{')
  const end = value.lastIndexOf('}')
  if (start === -1 || end === -1 || end < start) {
    throw new Error('no_json_found')
  }
  return JSON.parse(value.slice(start, end + 1))
}

interface RawCandidate {
  detectedName: string
  brand: string | null
  status: StockStatus
  confidence: number
}

function normalizeCandidates(raw: unknown): RawCandidate[] {
  if (typeof raw !== 'object' || raw === null || !('items' in raw)) {
    throw new Error('invalid_shape')
  }
  const items = (raw as { items: unknown }).items
  if (!Array.isArray(items)) throw new Error('invalid_shape')

  return items.map((item): RawCandidate => {
    if (typeof item !== 'object' || item === null) throw new Error('invalid_item')
    const record = item as Record<string, unknown>
    const detectedName = typeof record.detectedName === 'string' ? record.detectedName.trim() : ''
    if (!detectedName) throw new Error('invalid_item')
    const brand = typeof record.brand === 'string' && record.brand.trim() ? record.brand.trim() : null
    const status = STATUSES.has(record.status as StockStatus) ? (record.status as StockStatus) : 'unknown'
    const confidenceRaw = typeof record.confidence === 'number' ? record.confidence : 0
    const confidence = Math.min(1, Math.max(0, confidenceRaw))
    return { detectedName, brand, status, confidence }
  })
}

// ブランド名(例: SUNTORY)は複数の登録商品で共通するため、誤マッチを避けて
// 商品名/短縮名だけで照合する。ブランドは判定材料に使わない。
function matchProduct(candidate: RawCandidate, products: Product[]): ProductId | null {
  const detectedLower = candidate.detectedName.toLowerCase()

  for (const product of products) {
    const needles = [product.shortName, product.name].map((s) => s.toLowerCase())
    if (needles.some((needle) => needle.includes(detectedLower) || detectedLower.includes(needle))) {
      return product.id
    }
  }
  return null
}

export async function analyzePhoto(
  env: Env,
  imageBytes: ArrayBuffer,
  contentType: string,
  machineId: string,
  products: Product[],
): Promise<AnalysisCandidate[]> {
  const base64 = bytesToBase64(new Uint8Array(imageBytes))

  const result = await env.AI.run(
    MODEL,
    {
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'text', text: buildUserPrompt(products) },
            { type: 'image_url', image_url: { url: `data:${contentType};base64,${base64}` } },
          ],
        },
      ],
      max_tokens: 1024,
      temperature: 0.2,
    },
    {
      gateway: {
        id: 'default',
        collectLog: true,
        metadata: { feature: 'photo-analysis', machineId },
        requestTimeoutMs: REQUEST_TIMEOUT_MS,
        // 画像解析は数十秒かかることがあるため、待ち時間を伸ばすリトライはせず
        // 1回で見切りをつけて手動入力へフォールバックさせる。
        retries: { maxAttempts: 1 },
      },
    },
  )

  if (result.response === undefined || result.response === null) {
    throw new Error('empty_response')
  }

  const candidates = normalizeCandidates(extractJson(result.response))
  return candidates.map((candidate) => ({
    ...candidate,
    productId: matchProduct(candidate, products),
  }))
}
