import { createWsHost, type PipiHostAPI, type WebSocketLike } from '@pipi/host-api'

export type BrowserSocket = WebSocketLike & {
  close(): void
  addEventListener(type: string, listener: (event?: any) => void, options?: { once?: boolean }): void
}

export type BrowserHostOptions = {
  demo?: boolean
  demoHost?: () => PipiHostAPI
  location?: Pick<Location, 'protocol' | 'host'>
  open?: (url: string, target: string, features: string) => Window | null
  socket?: (url: string) => BrowserSocket
}

export function safeExternalURL(raw: string): string {
  const url = new URL(raw)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('只允许打开 HTTP(S) 登录地址')
  }
  return url.href
}

/** Connect the browser build to the same Host API backend used by Electron. */
export function createBrowserHost(options: BrowserHostOptions = {}): Promise<PipiHostAPI> {
  if (options.demo) {
    if (!options.demoHost) throw new Error('Demo 模式需要显式提供 mock host')
    return Promise.resolve(options.demoHost())
  }
  const location = options.location ?? window.location
  const socketFactory = options.socket ?? (url => new WebSocket(url) as BrowserSocket)
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
  const socket = socketFactory(`${protocol}//${location.host}/ws`)

  return new Promise((resolve, reject) => {
    let settled = false
    const fail = () => {
      if (settled) return
      settled = true
      socket.close()
      reject(new Error('无法连接本机 Pi Host；请用 npm run dev:browser 启动网页开发服务。'))
    }
    socket.addEventListener('error', fail, { once: true })
    socket.addEventListener('close', fail, { once: true })
    socket.addEventListener('open', () => {
      if (settled) return
      settled = true
      const host = createWsHost(socket)
      const open = options.open ?? window.open.bind(window)
      host.openExternal = async raw => {
        const popup = open(safeExternalURL(raw), '_blank', 'noopener,noreferrer')
        if (!popup) throw new Error('浏览器阻止了登录窗口；请允许弹窗或手动打开登录地址。')
      }
      resolve(host)
    }, { once: true })
  })
}
