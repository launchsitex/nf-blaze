import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['providers/**/*.test.ts'],
    environment: 'node'
  }
})
