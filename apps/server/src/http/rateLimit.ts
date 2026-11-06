import type { Request, RequestHandler } from "express";
import { ServiceError } from "../errors";

export interface RateLimitSettings {
  windowMs: number;
  max: number;
}

export interface RateLimiter {
  check(key: string): boolean;
  reset(): void;
  size(): number;
}

/**
 * Fixed-window in-memory limiter. Used for register/login/refresh; a single
 * process is our Phase-2 deployment. Entries are pruned opportunistically so a
 * spray of unique IPs cannot grow the map without bound.
 */
export function createRateLimiter(
  settings: RateLimitSettings,
  now: () => number = Date.now,
): RateLimiter {
  const hits = new Map<string, { count: number; resetAt: number }>();

  function prune(current: number): void {
    if (hits.size <= 1000) {
      return;
    }
    for (const [key, entry] of hits) {
      if (entry.resetAt <= current) {
        hits.delete(key);
      }
    }
  }

  return {
    check(key: string): boolean {
      const current = now();
      prune(current);
      const entry = hits.get(key);
      if (!entry || entry.resetAt <= current) {
        hits.set(key, { count: 1, resetAt: current + settings.windowMs });
        return true;
      }
      if (entry.count >= settings.max) {
        return false;
      }
      entry.count += 1;
      return true;
    },
    reset(): void {
      hits.clear();
    },
    size(): number {
      return hits.size;
    },
  };
}

function defaultKey(req: Request): string {
  return req.ip ?? req.socket.remoteAddress ?? "unknown";
}

/** Express middleware applying a limiter per client IP (or a custom key). */
export function rateLimit(
  limiter: RateLimiter,
  keyOf: (req: Request) => string = defaultKey,
): RequestHandler {
  return (req, _res, next) => {
    if (!limiter.check(keyOf(req))) {
      next(new ServiceError("rate_limited", "Too many attempts. Try again later."));
      return;
    }
    next();
  };
}

export const DEFAULT_RATE_LIMITS = {
  register: { windowMs: 15 * 60_000, max: 5 },
  login: { windowMs: 15 * 60_000, max: 10 },
  refresh: { windowMs: 15 * 60_000, max: 30 },
} as const;
