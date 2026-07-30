import type { NfBlazeApi } from './index'

declare global {
  interface Window {
    nfblaze: NfBlazeApi
  }
}

export {}
