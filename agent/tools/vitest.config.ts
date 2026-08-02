import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: [
      'agent/tools/**/*.test.ts',
      'agent/mcp/**/*.test.ts',
      'agent/health/**/*.test.ts',
      'agent/repo_map/**/*.test.ts'
    ],
    environment: 'node'
  }
})
