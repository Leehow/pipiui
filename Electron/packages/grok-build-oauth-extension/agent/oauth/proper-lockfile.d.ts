declare module "proper-lockfile" {
  export function lock(path: string, opts?: unknown): Promise<() => Promise<void>>;
  export function unlock(path: string, opts?: unknown): Promise<void>;
  const _default: { lock: typeof lock; unlock: typeof unlock };
  export default _default;
}
