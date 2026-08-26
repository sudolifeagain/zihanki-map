import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { cloudflare } from '@cloudflare/vite-plugin'

// vitest はワーカーランタイムを必要としないため、テスト実行時は外す。
export default defineConfig({
  plugins: [react(), ...(process.env.VITEST ? [] : [cloudflare()])],
  test: {
    environment: 'node',
  },
})
