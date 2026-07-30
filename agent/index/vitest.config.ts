import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['agent/index/**/*.test.ts'],
    environment: 'node'
  }
})
