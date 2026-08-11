// Cross-platform replacement for the previous POSIX-shell check
// `! grep -q 'require(.*node:' out/preload/index.js` (grep does not exist on
// Windows CI). The preload bundle must never require node: builtins at
// runtime: the renderer runs sandboxed with contextIsolation, so anything
// reaching for Node primitives would break (or worse, bypass the sandbox).
import { readFileSync } from 'node:fs'

const out = new URL('./out/preload/index.js', import.meta.url)
const source = readFileSync(out, 'utf8')
if (/require\(\s*['"]node:/.test(source)) {
  console.error(`verify:preload FAILED: ${out.pathname} requires a node: builtin`)
  process.exit(1)
}
console.log('verify:preload OK')
