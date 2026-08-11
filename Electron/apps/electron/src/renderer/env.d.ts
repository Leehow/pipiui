import type { PipiHostAPI } from '@pipi/host-api'

declare global {
  interface Window {
    pipiHost: PipiHostAPI
  }
}

export {}
