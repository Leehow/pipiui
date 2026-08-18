// Boot-time polyfills so the remote browser UI parses and boots on older
// mobile WebViews (WeChat X5, iOS < 15.4). Zero dependencies; first import
// in src/browser.tsx so every later module can rely on these APIs.
(function () {
  var g: any = globalThis as any
  if (!g.crypto || typeof g.crypto.randomUUID !== 'function') {
    var c = g.crypto || (g.crypto = {})
    c.randomUUID = function (): string {
      var b = new Uint8Array(16)
      c.getRandomValues(b)
      b[6] = (b[6] & 0x0f) | 0x40
      b[8] = (b[8] & 0x3f) | 0x80
      var h: string[] = []
      for (var i = 0; i < 16; i++) h.push((b[i] + 0x100).toString(16).slice(1))
      return h.slice(0, 4).join('') + '-' + h.slice(4, 6).join('') + '-' + h.slice(6, 8).join('') + '-' + h.slice(8, 10).join('') + '-' + h.slice(10).join('')
    }
  }
  function at(this: any, n: number): any {
    var len = this.length
    var k = Math.trunc(n) || 0
    if (k < 0) k += len
    if (k < 0 || k >= len) return undefined
    return this[k]
  }
  if (typeof (Array.prototype as any).at !== 'function') (Array.prototype as any).at = at
  if (typeof (String.prototype as any).at !== 'function') (String.prototype as any).at = at
  if (typeof (String.prototype as any).replaceAll !== 'function') {
    ;(String.prototype as any).replaceAll = function (search: any, replacement: any): string {
      if (search instanceof RegExp) {
        if (!search.global) throw new TypeError('replaceAll must be called with a global RegExp')
        return this.replace(search, replacement)
      }
      return this.split(search).join(replacement)
    }
  }
  if (typeof (Object as any).hasOwn !== 'function') {
    ;(Object as any).hasOwn = function (o: any, k: PropertyKey): boolean {
      return Object.prototype.hasOwnProperty.call(o, k)
    }
  }
  function findLastImpl(this: any[], pred: (v: any, i: number, a: any[]) => boolean, thisArg?: any): any {
    for (var i = this.length - 1; i >= 0; i--) if (pred.call(thisArg, this[i], i, this)) return this[i]
    return undefined
  }
  function findLastIndexImpl(this: any[], pred: (v: any, i: number, a: any[]) => boolean, thisArg?: any): number {
    for (var i = this.length - 1; i >= 0; i--) if (pred.call(thisArg, this[i], i, this)) return i
    return -1
  }
  if (typeof (Array.prototype as any).findLast !== 'function') (Array.prototype as any).findLast = findLastImpl
  if (typeof (Array.prototype as any).findLastIndex !== 'function') (Array.prototype as any).findLastIndex = findLastIndexImpl
})()
