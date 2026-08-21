/// <reference types="vite/client" />

declare global {
  interface Window {
    pipiPathForFile?: (file: File) => string
    pipiHost?: unknown
  }
}

export {}
