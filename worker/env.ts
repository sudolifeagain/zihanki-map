export interface Env {
  DB: D1Database
  ASSETS: Fetcher
  PHOTOS: R2Bucket
  AI: Ai
  WRITES_PAUSED?: string
  /** IPハッシュ用の秘密ソルト。未設定ならIPハッシュを保存しない。 */
  IP_HASH_SALT?: string
}
