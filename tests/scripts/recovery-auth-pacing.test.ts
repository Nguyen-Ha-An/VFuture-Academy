import { expect, it } from 'vitest';
import { createRecoveryAuthPacer, runPacedRecoveryAuthentication } from '../../scripts/lib/recovery-auth-pacing';

function fakeTime() {
  let time = 0;
  const sleeps: number[] = [];
  return {
    now: () => time,
    sleep: async (milliseconds: number) => { sleeps.push(milliseconds); time += milliseconds; },
    sleeps,
  };
}

it('spaces concurrent authentication starts without catch-up bursts', async () => {
  const clock = fakeTime();
  const pacer = createRecoveryAuthPacer({ now: clock.now, sleep: clock.sleep });
  const starts: number[] = [];

  await Promise.all(Array.from({ length: 4 }, async () => {
    await pacer.waitForStart();
    starts.push(clock.now());
  }));

  expect(starts).toEqual([0, 2_100, 4_200, 6_300]);
  expect(clock.sleeps).toEqual([2_100, 2_100, 2_100]);
});

it('paces every retry start shared with other authentication callers', async () => {
  const clock = fakeTime();
  const pacer = createRecoveryAuthPacer({ now: clock.now, sleep: clock.sleep });
  const starts: number[] = [];
  let firstAttempts = 0;

  await Promise.all([
    runPacedRecoveryAuthentication(pacer, async () => {
      starts.push(clock.now());
      firstAttempts += 1;
      if (firstAttempts === 1) throw Object.assign(new Error('rate limited'), { status: 429 });
      return 'retried';
    }, { sleep: clock.sleep }),
    runPacedRecoveryAuthentication(pacer, async () => {
      starts.push(clock.now());
      return 'other';
    }, { sleep: clock.sleep }),
  ]);

  expect(starts).toHaveLength(3);
  expect(starts.slice(1).every((start, index) => start - starts[index]! >= 2_100)).toBe(true);
});
