import { useEffect, useState } from 'react'

/** 工作台左上角自定义 logo。localStorage 里存图片 data URL，null 即默认 wordmark。 */
const LOGO_STORAGE_KEY = 'pipiui.logo'
export const LOGO_CHANGED_EVENT = 'pipiui:logo-changed'
const MAX_LOGO_HEIGHT = 96

export function readCustomLogo(): string | null {
  try { return localStorage.getItem(LOGO_STORAGE_KEY) } catch { /* storage unavailable: fall back to the default wordmark */ }
  return null
}

/** null = 恢复默认。同窗口监听 'pipiui:logo-changed' 即时刷新。 */
export function writeCustomLogo(dataUrl: string | null): void {
  try {
    if (dataUrl === null) localStorage.removeItem(LOGO_STORAGE_KEY)
    else localStorage.setItem(LOGO_STORAGE_KEY, dataUrl)
  } catch { /* storage unavailable: keep the in-memory choice */ }
  window.dispatchEvent(new CustomEvent(LOGO_CHANGED_EVENT, { detail: dataUrl }))
}

export function useCustomLogo(): string | null {
  const [logo, setLogo] = useState<string | null>(() => readCustomLogo())
  useEffect(() => {
    // Trust the event payload (not a storage re-read) so a broken store cannot
    // clobber the in-memory logo the writer just broadcast.
    const onChange = (event: Event) => setLogo((event as CustomEvent<string | null>).detail ?? null)
    window.addEventListener(LOGO_CHANGED_EVENT, onChange)
    return () => window.removeEventListener(LOGO_CHANGED_EVENT, onChange)
  }, [])
  return logo
}

/** 选中的图片缩放到高度 ≤96px 后输出 image/png data URL；非图片类型抛错。 */
export function fileToLogoDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error('仅支持图片文件'))
      return
    }
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('读取图片失败'))
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error('解析图片失败'))
      img.onload = () => {
        const scale = img.naturalHeight > MAX_LOGO_HEIGHT ? MAX_LOGO_HEIGHT / img.naturalHeight : 1
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(img.naturalWidth * scale))
        canvas.height = Math.max(1, Math.round(img.naturalHeight * scale))
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          reject(new Error('无法创建画布'))
          return
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL('image/png'))
      }
      img.src = reader.result as string
    }
    reader.readAsDataURL(file)
  })
}
