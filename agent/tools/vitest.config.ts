import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['agent/tools/**/*.test.ts', 'agent/mcp/**/*.test.ts'],
    environment: 'node'
  }
})
