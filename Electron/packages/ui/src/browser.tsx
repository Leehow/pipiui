import React from 'react'
import ReactDOM from 'react-dom/client'
import { createMockHost } from './App'
import { RemoteBrowserApp } from './RemoteBrowserApp'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RemoteBrowserApp demoHost={createMockHost} />
  </React.StrictMode>
)
