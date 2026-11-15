import type { RateLimiter } from '../../application/ports/services.js';

/**
 * Fixed-window counter kept in process memory.
 * Suitable for a single instance; replace with a shared store (e.g. Redis) when scaling out.
 */
export class MemoryRateLimiter implements RateLimiter {
  private readonly windows = new Map<string, { start: number; count: number }>();

  constructor(private readonly now: () => number = Date.now) {}

  async hit(key: string, limit: number, windowMs: number): Promise<boolean> {
    const t = this.now();
    const w = this.windows.get(key);
    if (!w || t - w.start >= windowMs) {
      this.windows.set(key, { start: t, count: 1 });
      this.sweep(t, windowMs);
      return true;
    }
    w.count++;
    return w.count <= limit;
  }

  private lastSweep = 0;
  private sweep(t: number, windowMs: number) {
    if (t - this.lastSweep < 60_000) return;
    this.lastSweep = t;
    for (const [k, w] of this.windows) if (t - w.start >= Math.max(windowMs, 3_600_000)) this.windows.delete(k);
  }
}

/** A limiter that never blocks (tests, local development). */
export class NoopRateLimiter implements RateLimiter {
  async hit(): Promise<boolean> {
    return true;
  }
}
