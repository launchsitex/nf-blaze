import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'
import { nfSourcePlugin } from './plugins/nf-blaze-source/src/index.js'

export default defineConfig({
  plugins: [nfSourcePlugin(), react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  }
})
