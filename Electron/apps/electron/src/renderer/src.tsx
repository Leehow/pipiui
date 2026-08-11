import React from 'react'
import ReactDOM from 'react-dom/client'
import { App, createMockHost } from '@pipiui/ui'
import type { PipiHostAPI } from '@pipi/host-api'
import '@pipiui/ui/style.css'

// @pipiui/ui (and its style.css subpath) resolve to packages/ui/src via
// electron.vite.config.ts in both dev and build, so all components + CSS
// come from source (HMR-friendly) and never from a prebuilt dist.

const host = (window as Window & { pipiHost?: PipiHostAPI }).pipiHost ?? createMockHost()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App host={host} />
  </React.StrictMode>
)
