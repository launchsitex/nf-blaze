/** Cached project convention index */

export type ExportStyle = 'named' | 'default' | 'mixed' | 'unknown'
export type FileNamingStyle = 'PascalCase' | 'kebab-case' | 'camelCase' | 'mixed' | 'unknown'
export type StateStyle = 'useState' | 'zustand' | 'redux' | 'context'
export type StylingStyle =
  | 'tailwind'
  | 'css-modules'
  | 'styled-components'
  | 'plain-css'
  | 'unknown'

export interface TypescriptConventions {
  used: boolean
  /** From tsconfig `strict` when present */
  strict: boolean | null
  /** false when noImplicitAny/strict and almost no `any` usage */
  anyAllowed: boolean | null
  anyCount: number
  tsconfigPath?: string
}

export interface ProjectConventions {
  exports: ExportStyle
  fileNaming: FileNamingStyle
  stateManagement: StateStyle[]
  styling: StylingStyle[]
  /** Short human summary of how errors are handled in existing code */
  errorHandling: string
  typescript: TypescriptConventions
}

export interface ProjectIndex {
  rootDir: string
  scannedAt: string
  filesSampled: number
  conventions: ProjectConventions
  /** Raw counts kept for debugging / refresh decisions */
  evidence: {
    namedExports: number
    defaultExports: number
    pascalFiles: number
    kebabFiles: number
    camelFiles: number
    useState: number
    zustand: number
    redux: number
    context: number
    tailwind: number
    cssModules: number
    styledComponents: number
    plainCss: number
    tryCatch: number
    errorBoundary: number
    resultPattern: number
  }
}

export const MATCH_EXISTING_CODE_INSTRUCTION = `התאם את עצמך לקוד הקיים. אל תכפה סגנון אחר. אם הפרויקט משתמש בגישה שאתה לא מעדיף — עדיין תשתמש בה.`
