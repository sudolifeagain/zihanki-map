export interface Env {
  DB: D1Database
  ASSETS: Fetcher
  PHOTOS: R2Bucket
  AI: Ai
  WRITES_PAUSED?: string
}
