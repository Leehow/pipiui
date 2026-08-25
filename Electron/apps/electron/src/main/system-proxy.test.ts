import { describe, expect, it } from 'vitest'
import { systemProxyEnvironment } from './system-proxy.js'

describe('systemProxyEnvironment', () => {
  it('turns Electron system PROXY resolution into a Pi Node environment', () => {
    expect(systemProxyEnvironment({
      resolution: 'PROXY 127.0.0.1:6152; DIRECT',
      env: { PATH: '/usr/bin:/bin' }
    })).toMatchObject({
      HTTP_PROXY: 'http://127.0.0.1:6152',
      HTTPS_PROXY: 'http://127.0.0.1:6152',
      NO_PROXY: '127.0.0.1,localhost,::1,.local',
      NODE_USE_ENV_PROXY: '1'
    })
  })

  it('leaves Pi direct when Electron resolves DIRECT', () => {
    expect(systemProxyEnvironment({
      resolution: 'DIRECT',
      env: { PATH: '/usr/bin:/bin' }
    })).toEqual({ PATH: '/usr/bin:/bin' })
  })

  it('preserves an explicitly configured proxy', () => {
    expect(systemProxyEnvironment({
      resolution: 'PROXY 127.0.0.1:6152; DIRECT',
      env: {
        HTTP_PROXY: 'http://explicit-proxy.test:8080',
        HTTPS_PROXY: 'http://explicit-proxy.test:8080'
      }
    })).toMatchObject({
      HTTP_PROXY: 'http://explicit-proxy.test:8080',
      HTTPS_PROXY: 'http://explicit-proxy.test:8080',
      NODE_USE_ENV_PROXY: '1'
    })
  })
})
