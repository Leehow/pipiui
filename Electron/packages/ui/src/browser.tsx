import React, { useEffect, useState } from 'react'
import ReactDOM from 'react-dom/client'
import type { PipiHostAPI } from '@pipi/host-api'
import { App, createMockHost } from './App'
import { createBrowserHost } from './browser-host'

function BrowserApp() {
  const [attempt, setAttempt] = useState(0)
  const [host, setHost] = useState<PipiHostAPI | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [detailVisible, setDetailVisible] = useState(true)

  useEffect(() => {
    let active = true
    setHost(null)
    setError(null)
    setDetailVisible(true)
    const demo = (import.meta as ImportMeta & { env?: Record<string, string> }).env?.VITE_PIPIUI_DEMO === 'true'
    void createBrowserHost({ demo, demoHost: createMockHost }).then(
      value => { if (active) setHost(value) },
      reason => { if (active) setError(reason instanceof Error ? reason.message : String(reason)) }
    )
    return () => { active = false }
  }, [attempt])

  if (host) return <App host={host} />
  if (!error) return <main className="browser-host-state" role="status">正在连接本机 Pi Host…</main>
  return (
    <main className="browser-host-state" role="alert">
      <section className="browser-host-error">
        <button type="button" aria-label="关闭错误" onClick={() => setDetailVisible(false)}>×</button>
        <h1>网页未连接到 Pi</h1>
        {detailVisible && <p>{error}</p>}
        <button type="button" onClick={() => setAttempt(value => value + 1)}>重试连接</button>
      </section>
    </main>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserApp />
  </React.StrictMode>
)
