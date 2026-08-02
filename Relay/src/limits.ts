export class FixedWindowRateLimiter {
  private readonly buckets = new Map<string, { start: number; count: number }>();

  constructor(
    private readonly windowMS: number,
    private readonly maximum: number,
    private readonly maximumKeys: number,
    private readonly now: () => number,
  ) {}

  take(key: string): boolean {
    const now = this.now();
    let bucket = this.buckets.get(key);
    if (!bucket || now - bucket.start >= this.windowMS) {
      if (!bucket && this.buckets.size >= this.maximumKeys) this.prune(now);
      if (!bucket && this.buckets.size >= this.maximumKeys) return false;
      bucket = { start: now, count: 0 };
      this.buckets.set(key, bucket);
    }
    if (bucket.count >= this.maximum) return false;
    bucket.count += 1;
    return true;
  }

  private prune(now: number): void {
    for (const [key, bucket] of this.buckets) {
      if (now - bucket.start >= this.windowMS) this.buckets.delete(key);
    }
  }
}

export class ConcurrentConnectionLimiter {
  private total = 0;
  private readonly perKey = new Map<string, number>();

  constructor(
    private readonly maximumTotal: number,
    private readonly maximumPerKey: number,
    private readonly maximumKeys: number,
  ) {}

  open(key: string): boolean {
    const current = this.perKey.get(key) ?? 0;
    if (this.total >= this.maximumTotal
      || current >= this.maximumPerKey
      || (!this.perKey.has(key) && this.perKey.size >= this.maximumKeys)) {
      return false;
    }
    this.total += 1;
    this.perKey.set(key, current + 1);
    return true;
  }

  close(key: string): void {
    const current = this.perKey.get(key);
    if (!current) return;
    this.total = Math.max(0, this.total - 1);
    if (current === 1) this.perKey.delete(key);
    else this.perKey.set(key, current - 1);
  }

  count(): number {
    return this.total;
  }
}
