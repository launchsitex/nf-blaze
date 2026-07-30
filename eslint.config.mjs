import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import eslintConfigPrettier from 'eslint-config-prettier'
import globals from 'globals'

export default tseslint.config(
  {
    ignores: [
      'node_modules',
      'out',
      'dist',
      'release',
      'templates/**',
      'sandbox/**',
      'resources/**',
      'agent/workers/**',
      'src/renderer/out/**',
      '**/*.js'
    ]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  eslintConfigPrettier,

  // Renderer (React, DOM)
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser }
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn'
    }
  },

  // Main / preload / agent / providers / shared (Node)
  {
    files: [
      'src/main/**/*.ts',
      'src/preload/**/*.ts',
      'src/shared/**/*.ts',
      'agent/**/*.ts',
      'providers/**/*.ts',
      'tests/**/*.ts',
      '*.config.ts'
    ],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node }
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn'
    }
  },

  // Plain Node scripts (CommonJS)
  {
    files: ['scripts/**/*.cjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: { ...globals.node }
    }
  },

  {
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
      // Fetch-on-mount is a deliberate, common pattern in this codebase (initial
      // data load); the newer strict rule flags it even though it's not a bug here.
      'react-hooks/set-state-in-effect': 'off'
    }
  }
)
