import { describe, expect, it } from 'vitest';

import {
  registerNavigationGuard,
  requestNavigation,
} from '@/lib/navigation-guard';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}

describe('navigation guard registry', () => {
  it('permits navigation when the registry is empty', async () => {
    await expect(requestNavigation()).resolves.toBe(true);
  });

  it('runs guards serially and stops when one cancels', async () => {
    const calls: string[] = [];
    const unregisterFirst = registerNavigationGuard(async () => {
      calls.push('first');
      return true;
    });
    const unregisterSecond = registerNavigationGuard(async () => {
      calls.push('second');
      return false;
    });
    const unregisterThird = registerNavigationGuard(async () => {
      calls.push('third');
      return true;
    });

    await expect(requestNavigation()).resolves.toBe(false);
    expect(calls).toEqual(['first', 'second']);

    unregisterFirst();
    unregisterSecond();
    unregisterThird();
  });

  it('cancels navigation when a guard rejects', async () => {
    const unregister = registerNavigationGuard(async () => {
      throw new Error('unsaved changes check failed');
    });

    await expect(requestNavigation()).resolves.toBe(false);
    unregister();
  });

  it('removes an unregistered guard', async () => {
    let calls = 0;
    const unregister = registerNavigationGuard(async () => {
      calls += 1;
      return false;
    });

    unregister();

    await expect(requestNavigation()).resolves.toBe(true);
    expect(calls).toBe(0);
  });

  it('coalesces concurrent requests into one guard evaluation promise', async () => {
    const check = deferred<boolean>();
    let calls = 0;
    const unregister = registerNavigationGuard(async () => {
      calls += 1;
      return check.promise;
    });

    const firstRequest = requestNavigation();
    const secondRequest = requestNavigation();

    expect(secondRequest).toBe(firstRequest);
    expect(calls).toBe(1);

    check.resolve(true);
    await expect(firstRequest).resolves.toBe(true);
    unregister();
  });

  it('snapshots guards at request start', async () => {
    const firstCheck = deferred<boolean>();
    const calls: string[] = [];
    const unregisterFirst = registerNavigationGuard(async () => {
      calls.push('first');
      return firstCheck.promise;
    });

    const activeRequest = requestNavigation();
    const unregisterSecond = registerNavigationGuard(async () => {
      calls.push('second');
      return true;
    });

    firstCheck.resolve(true);
    await expect(activeRequest).resolves.toBe(true);
    expect(calls).toEqual(['first']);

    await expect(requestNavigation()).resolves.toBe(true);
    expect(calls).toEqual(['first', 'first', 'second']);

    unregisterFirst();
    unregisterSecond();
  });
});
