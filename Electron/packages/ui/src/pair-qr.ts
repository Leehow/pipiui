import qrcode from 'qrcode-generator'

export function qrModules(text: string): boolean[][] {
  const qr = qrcode(0, 'L')
  qr.addData(text, 'Byte')
  qr.make()
  const n = qr.getModuleCount()
  return Array.from({ length: n }, (_, r) =>
    Array.from({ length: n }, (_, c) => qr.isDark(r, c))
  )
}

export function qrSvg(text: string, size = 168): string {
  const modules = qrModules(text)
  const n = modules.length
  const quiet = 2
  const dim = n + quiet * 2
  let body = ''
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (modules[r][c]) body += `<rect x="${c + quiet}" y="${r + quiet}" width="1" height="1"/>`
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dim} ${dim}" width="${size}" height="${size}" shape-rendering="crispEdges"><rect width="${dim}" height="${dim}" fill="#fff"/>${body}</svg>`
}
