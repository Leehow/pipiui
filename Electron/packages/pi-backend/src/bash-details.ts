import { Buffer } from 'node:buffer';

/** UI-only snapshots. Never changes the result sent back to the model. */
export interface BashDetailSnapshot {
  input: string;
  output: string;
  revision: number;
  state: 'running' | 'completed' | 'failed' | 'interrupted';
  inputTruncated: boolean;
  outputTruncated: boolean;
}

export const BASH_DETAIL_BYTES = 64 * 1024;
export const BASH_DETAIL_TOTAL_BYTES = 8 * 1024 * 1024;

/** Bound before encoding: an arbitrarily large input must not allocate a second full buffer. */
export function boundedText(text: string, tail = false, bytes = BASH_DETAIL_BYTES): string {
  const candidate = tail ? text.slice(-bytes) : text.slice(0, bytes);
  const encoded = Buffer.from(candidate);
  if (encoded.length <= bytes) return candidate;
  let start = tail ? encoded.length - bytes : 0;
  let end = tail ? encoded.length : bytes;
  if (tail) while (start < end && (encoded[start]! & 0xc0) === 0x80) start++;
  else while (end > 0 && (encoded[end]! & 0xc0) === 0x80) end--;
  return encoded.subarray(start, end).toString('utf8');
}

export function bashInputSummary(input: unknown): string {
  if (typeof input === 'object' && input !== null && 'command' in input) {
    return JSON.stringify({ command: boundedText(String(input.command ?? ''), false, 120) });
  }
  if (typeof input !== 'string') return '';
  try { return bashInputSummary(JSON.parse(input)); } catch { return ''; }
}

/** Remove secret fragments at explicitly clipped window edges before ordinary redaction.
 * The worker cannot send an entire unbounded value just to redact across a page edge.
 */
export function maskBashWindowEdges(text: string, secrets: readonly { value: string; envName: string }[], left: boolean, right: boolean): string {
  for (const secret of secrets) {
    if (left) {
      for (let length = Math.min(text.length, secret.value.length - 1); length > 0; length--) {
        if (text.startsWith(secret.value.slice(-length))) { text = `{{secret:${secret.envName}}}` + text.slice(length); break; }
      }
    }
    if (right) {
      for (let length = Math.min(text.length, secret.value.length - 1); length > 0; length--) {
        if (text.endsWith(secret.value.slice(0, length))) { text = text.slice(0, -length) + `{{secret:${secret.envName}}}`; break; }
      }
    }
  }
  return text;
}

/** Keep the cursor in raw-source bytes when a redaction expands the returned page. */
export function transformBashPage(raw: string, transform: (text: string, clipped: boolean) => string, maxBytes = 32768): { text: string; consumedBytes: number } {
  const full = transform(raw, false);
  if (Buffer.byteLength(full) <= maxBytes) return { text: full, consumedBytes: Buffer.byteLength(raw) };
  let low = 1;
  let high = raw.length;
  let best = { text: '', consumedBytes: 0 };
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    let prefix = raw.slice(0, middle);
    if (/[\uD800-\uDBFF]/.test(prefix.at(-1) ?? '')) prefix = prefix.slice(0, -1);
    const text = transform(prefix, true);
    if (Buffer.byteLength(text) <= maxBytes) {
      best = { text, consumedBytes: Buffer.byteLength(prefix) };
      low = middle + 1;
    } else high = middle - 1;
  }
  if (!best.consumedBytes) throw new Error('无法在日志页预算内安全显示内容');
  return best;
}

/** Per-host byte budget, LRU eviction, no timers and no growing preview queues. */
export class BashDetailsStore {
  private entries = new Map<string, BashDetailSnapshot>();
  private bytes = 0;
  private revision = 0;
  constructor(private readonly budget = BASH_DETAIL_TOTAL_BYTES) {}
  private key(sessionId: string, toolCallId: string) { return JSON.stringify([sessionId, toolCallId]); }
  private size(value: BashDetailSnapshot) { return Buffer.byteLength(value.input) + Buffer.byteLength(value.output); }
  get(sessionId: string, toolCallId: string): BashDetailSnapshot | undefined {
    const key = this.key(sessionId, toolCallId);
    const value = this.entries.get(key);
    if (value) { this.entries.delete(key); this.entries.set(key, value); }
    return value;
  }
  set(sessionId: string, toolCallId: string, patch: { input?: string; output?: string; state?: BashDetailSnapshot['state'] }): void {
    const key = this.key(sessionId, toolCallId);
    const old = this.entries.get(key);
    // Each response (input + output) is bounded by one page, not two.
    const input = patch.input === undefined ? old?.input ?? '' : boundedText(patch.input, false, BASH_DETAIL_BYTES / 2);
    const output = patch.output === undefined ? old?.output ?? '' : boundedText(patch.output, true, BASH_DETAIL_BYTES / 2);
    if (old && old.state !== 'running' && patch.state === 'running') return;
    const value: BashDetailSnapshot = {
      input, output, revision: ++this.revision, state: patch.state ?? old?.state ?? 'running',
      inputTruncated: patch.input === undefined ? old?.inputTruncated ?? false : input !== patch.input,
      outputTruncated: patch.output === undefined ? old?.outputTruncated ?? false : output !== patch.output,
    };
    if (old) this.bytes -= this.size(old);
    this.entries.delete(key);
    this.entries.set(key, value);
    this.bytes += this.size(value);
    // Also bound empty snapshots and identities, not just body bytes.
    while (this.bytes > this.budget || this.entries.size > 512) {
      const first = this.entries.keys().next().value;
      if (first === undefined) break;
      this.bytes -= this.size(this.entries.get(first)!);
      this.entries.delete(first);
    }
  }
  interrupt(sessionId: string): void {
    for (const [key, value] of this.entries) {
      if (JSON.parse(key)[0] === sessionId && value.state === 'running') {
        this.entries.set(key, { ...value, state: 'interrupted', revision: ++this.revision });
      }
    }
  }
  clear(): void { this.entries.clear(); this.bytes = 0; }
  get retainedBytes(): number { return this.bytes; }
  get count(): number { return this.entries.size; }
}
