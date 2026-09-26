import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  withRetry,
  withTimeout,
  ReviewError,
  ErrorCodes,
  isReviewError,
  formatError
} from '../src/utils/error-handler';
import { RateLimiter } from '../src/utils/rate-limiter';

describe('withRetry', () => {
  beforeEach(() => {
    // Backoff sleeps are real timers; keep the suite fast by stubbing them out.
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void) => {
      fn();
      return 0 as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the result when the operation succeeds first try', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    await expect(withRetry(fn)).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries a transient failure and returns the eventual success', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValue('recovered');

    await expect(withRetry(fn, 3, 10)).resolves.toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('stops after maxRetries attempts', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('always down'));
    await expect(withRetry(fn, 3, 10)).rejects.toThrow(ReviewError);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('throws RETRY_EXHAUSTED carrying the last error message', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('upstream 503'));
    await expect(withRetry(fn, 2, 10)).rejects.toMatchObject({
      code: ErrorCodes.RETRY_EXHAUSTED
    });
    await expect(withRetry(fn, 2, 10)).rejects.toThrow(/upstream 503/);
  });
});

describe('withTimeout', () => {
  it('returns the result when the operation finishes in time', async () => {
    const fast = () => new Promise<string>(resolve => setTimeout(() => resolve('done'), 5));
    await expect(withTimeout(fast, 500)).resolves.toBe('done');
  });

  it('rejects with AGENT_TIMEOUT when the operation is too slow', async () => {
    const slow = () => new Promise<string>(resolve => setTimeout(() => resolve('late'), 200));
    await expect(withTimeout(slow, 20, 'agent stalled')).rejects.toMatchObject({
      code: ErrorCodes.AGENT_TIMEOUT
    });
  });

  it('includes the timeout budget in the error metadata', async () => {
    const slow = () => new Promise<string>(resolve => setTimeout(() => resolve('late'), 200));
    try {
      await withTimeout(slow, 25);
      expect.unreachable('should have timed out');
    } catch (error) {
      expect(isReviewError(error)).toBe(true);
      if (isReviewError(error)) expect(error.metadata).toMatchObject({ timeoutMs: 25 });
    }
  });

  it('propagates the original error when the operation fails before the timeout', async () => {
    const failing = () => Promise.reject(new Error('boom'));
    await expect(withTimeout(failing, 500)).rejects.toThrow('boom');
  });
});

describe('error helpers', () => {
  it('identifies ReviewError instances', () => {
    expect(isReviewError(new ReviewError('x', ErrorCodes.UNKNOWN_ERROR))).toBe(true);
    expect(isReviewError(new Error('x'))).toBe(false);
  });

  it('formats a ReviewError with its code', () => {
    const err = new ReviewError('PR missing', ErrorCodes.PR_NOT_FOUND);
    expect(formatError(err)).toBe('[PR_NOT_FOUND] PR missing');
  });

  it('formats plain errors and non-error values', () => {
    expect(formatError(new Error('plain'))).toBe('plain');
    expect(formatError('just a string')).toBe('just a string');
  });
});

describe('RateLimiter', () => {
  it('permits a request when the window is empty', () => {
    const limiter = new RateLimiter();
    expect(limiter.canProceed(1000)).toBe(true);
  });

  it('reports an empty starting window', () => {
    const status = new RateLimiter().getStatus();
    expect(status.activeRequests).toBe(0);
    expect(status.requestsInWindow).toBe(0);
    expect(status.tokensInWindow).toBe(0);
  });

  it('records a request and decrements availability after acquire', async () => {
    const limiter = new RateLimiter({ maxRequestsPerMinute: 10, maxTokensPerMinute: 10_000 });
    await limiter.acquire(2_500);

    const status = limiter.getStatus();
    expect(status.activeRequests).toBe(1);
    expect(status.requestsInWindow).toBe(1);
    expect(status.tokensInWindow).toBe(2_500);
    expect(status.availableRequests).toBe(9);
    expect(status.availableTokens).toBe(7_500);
  });

  it('frees the concurrency slot on release', async () => {
    const limiter = new RateLimiter({ maxConcurrent: 2 });
    await limiter.acquire(100);
    expect(limiter.getStatus().activeRequests).toBe(1);

    limiter.release();
    expect(limiter.getStatus().activeRequests).toBe(0);
  });

  it('updates the recorded token count when release reports actuals', async () => {
    const limiter = new RateLimiter();
    await limiter.acquire(1_000);
    limiter.release(4_242);
    expect(limiter.getStatus().tokensInWindow).toBe(4_242);
  });

  it('refuses a request that would exceed the token budget', async () => {
    const limiter = new RateLimiter({ maxTokensPerMinute: 5_000, maxConcurrent: 10 });
    await limiter.acquire(4_000);
    limiter.release();

    expect(limiter.canProceed(2_000)).toBe(false); // 4000 + 2000 > 5000
    expect(limiter.canProceed(500)).toBe(true);
  });

  it('refuses a request once the per-minute request cap is reached', async () => {
    const limiter = new RateLimiter({ maxRequestsPerMinute: 2, maxConcurrent: 10 });
    await limiter.acquire(10);
    limiter.release();
    await limiter.acquire(10);
    limiter.release();

    expect(limiter.canProceed(10)).toBe(false);
  });

  it('refuses a request once maxConcurrent is saturated', async () => {
    const limiter = new RateLimiter({ maxConcurrent: 1 });
    await limiter.acquire(10);
    expect(limiter.canProceed(10)).toBe(false);
  });

  it('drops records older than the 60-second window', async () => {
    const limiter = new RateLimiter({ maxRequestsPerMinute: 2, maxConcurrent: 5 });
    await limiter.acquire(1_000);
    limiter.release();
    expect(limiter.getStatus().requestsInWindow).toBe(1);

    // Advance wall-clock past the window; pruning is time-based.
    const realNow = Date.now;
    vi.spyOn(Date, 'now').mockImplementation(() => realNow() + 61_000);
    try {
      expect(limiter.getStatus().requestsInWindow).toBe(0);
      expect(limiter.canProceed(1_000)).toBe(true);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('queues a waiter when saturated and wakes it on release', async () => {
    const limiter = new RateLimiter({ maxConcurrent: 1 });
    await limiter.acquire(10);

    let acquired = false;
    const pending = limiter.acquire(10).then(() => {
      acquired = true;
    });

    // The second acquire must not resolve while the only slot is held.
    await Promise.resolve();
    expect(acquired).toBe(false);

    limiter.release();
    await pending;
    expect(acquired).toBe(true);
  });
});
