// PipiUI terminal tool visibility: default-hidden, revealed only by an explicit
// user ask for the built-in terminal / command line / SSH / TUI work.
// Dependency-free so it stays unit-testable from any harness.

const LATIN = /\b(?:terminal|tui|ssh|command[-\s]?line|cmdline)\b/i
const CJK = /终端|命令行/

/** True only when the user's message explicitly asks for terminal-style work.
 *  Ordinary work asks (跑个命令 / 运行测试 / build it) must NOT reveal. */
export function shouldRevealTerminal(text: string | undefined | null): boolean {
  if (typeof text !== 'string' || text.length === 0) return false
  return CJK.test(text) || LATIN.test(text)
}

/** Per-session sticky visibility for the `terminal` tool. */
export class TerminalVisibility {
  revealed = false

  hide(active: readonly string[]): string[] {
    return active.filter(name => name !== 'terminal')
  }

  /** Next active tool list given the latest user text. Sticky once revealed. */
  nextActiveTools(text: string | undefined | null, active: readonly string[]): string[] {
    if (this.revealed || shouldRevealTerminal(text)) {
      this.revealed = true
      return active.includes('terminal') ? [...active] : [...active, 'terminal']
    }
    return this.hide(active)
  }

  /** Idempotence guard: only call setActiveTools when the list actually changes. */
  shouldCallSetActiveTools(current: readonly string[], next: readonly string[]): boolean {
    if (current.length !== next.length) return true
    return current.some((name, index) => name !== next[index])
  }
}
