const DEFAULT_NO_PROXY = '127.0.0.1,localhost,::1,.local'
const PROXY_PROBE_URL = 'https://chatgpt.com'

type ProxyEnvironmentInput = {
  resolution: string
  env: NodeJS.ProcessEnv
}

function firstHttpProxy(resolution: string): string | undefined {
  for (const directive of resolution.split(';')) {
    const match = /^PROXY\s+([^\s]+)$/i.exec(directive.trim())
    if (!match) continue
    try {
      const url = new URL(`http://${match[1]}`)
      if (url.hostname) return url.origin
    } catch {
      // Ignore malformed system directives and try the next fallback.
    }
  }
  return undefined
}

/** Bridge Electron's system proxy into the standalone Node process running Pi. */
export function systemProxyEnvironment(input: ProxyEnvironmentInput): NodeJS.ProcessEnv {
  const env = { ...input.env }
  const configuredHttp = env.HTTP_PROXY ?? env.http_proxy
  const configuredHttps = env.HTTPS_PROXY ?? env.https_proxy
  const resolved = firstHttpProxy(input.resolution)
  const httpProxy = configuredHttp ?? resolved
  const httpsProxy = configuredHttps ?? resolved
  if (!httpProxy && !httpsProxy) return env

  if (!configuredHttp && httpProxy) env.HTTP_PROXY = httpProxy
  if (!configuredHttps && httpsProxy) env.HTTPS_PROXY = httpsProxy
  if (!env.NO_PROXY && !env.no_proxy) env.NO_PROXY = DEFAULT_NO_PROXY
  env.NODE_USE_ENV_PROXY = '1'
  return env
}

export async function resolveSystemProxyEnvironment(
  resolveProxy: (url: string) => Promise<string>,
  env: NodeJS.ProcessEnv,
): Promise<NodeJS.ProcessEnv> {
  try {
    return systemProxyEnvironment({ resolution: await resolveProxy(PROXY_PROBE_URL), env })
  } catch {
    return { ...env }
  }
}
