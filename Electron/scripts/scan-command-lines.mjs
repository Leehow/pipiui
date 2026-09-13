import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'

const STDERR_CAP = 8192

/**
 * Run a command and hand each stdout line to `onLine`, never holding the whole
 * output in memory.
 *
 * execFileSync/spawnSync cap stdout at `maxBuffer` (1 MB by default) and die
 * with ENOBUFS. That is how the deb listing check silently stopped running:
 * `dpkg-deb -c` on a real package prints ~31,500 lines (~3 MB), so the check
 * crashed before a single assertion ran. Package listings and symbol dumps grow
 * with the artifact, so these checks stream instead of picking a bigger cap.
 *
 * Resolves with the exit `code` (negative or null when the process never
 * started or was signalled), the captured `stderr` (truncated to a few KB — it is only ever
 * used for error messages) and any spawn `error`.
 */
export function scanCommandLines(command, args, onLine) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stderr = ''
    let spawnError
    let failure
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', chunk => {
      if (stderr.length < STDERR_CAP) stderr += chunk.slice(0, STDERR_CAP - stderr.length)
    })
    const lines = createInterface({ input: child.stdout, crlfDelay: Infinity })
    lines.on('line', line => {
      if (failure) return
      try {
        onLine(line)
      } catch (error) {
        failure = error
        child.kill()
      }
    })
    child.on('error', error => { spawnError = error })
    child.on('close', code => {
      lines.close()
      if (failure) rejectPromise(failure)
      else resolvePromise({ code, stderr, error: spawnError })
    })
  })
}

export function describeFailure(command, result) {
  return result.error?.message || result.stderr.trim() || `${command} exited with ${result.code}`
}
