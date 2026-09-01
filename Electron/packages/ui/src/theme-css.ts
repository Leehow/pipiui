import { getAllThemes, subscribeThemes, type ThemeDefinition } from './theme-registry'

/** One `[data-theme="<id>"]` rule per known theme, generated from its token map.
 *  Placed after app.css in the document, these rules override the `.pipiui-shell`
 *  dark baseline for the shell and supply preview cards (any element carrying
 *  data-theme) via normal CSS variable inheritance. */
export function themeCssText(themes: readonly ThemeDefinition[]): string {
  return themes
    .map(theme => `[data-theme="${theme.id}"]{${Object.entries(theme.tokens).map(([key, value]) => `${key}:${value};`).join('')}}`)
    .join('\n')
}

const STYLE_ELEMENT_ID = 'pipiui-themes'
let installed = false

/** Install (once) a <style> element carrying every known theme's token rules,
 *  regenerating whenever extension contributions change the registry. Called
 *  for its side effect at App module load, before the first render. */
export function installThemeCss(): void {
  if (installed || typeof document === 'undefined') return
  installed = true
  let el = document.getElementById(STYLE_ELEMENT_ID) as HTMLStyleElement | null
  if (!el) {
    el = document.createElement('style')
    el.id = STYLE_ELEMENT_ID
    document.head.appendChild(el)
  }
  const render = () => { el.textContent = themeCssText(getAllThemes()) }
  render()
  subscribeThemes(render)
}
