/**
 * Runs catastrophic-backtracking patterns through the safe regex adapter and reports how long
 * matching took. Executed as a child process by safe-regex-pathological.test.ts so the parent
 * can enforce a hard kill: a backtracking engine would spin synchronously here, which an
 * in-process test timeout cannot interrupt.
 */
import { SAFE_REGEX_LIMITS, compileSafeRegex } from '@/content-engine/grading/safe-regex';

// Patterns whose group can match empty at end of input still match, because `$` then holds
// there: that covers `([a-zA-Z]+)*$`, `(\p{L}+)*$` and `(a|a?)+$` (its `a?` branch matches
// empty). The rest cannot match input ending in "!".
const CASES: [pattern: string, matches: boolean][] = [
  ['(a+)+$', false],
  ['(x+x+)+y', false],
  ['(a|aa)+$', false],
  ['([a-zA-Z]+)*$', true],
  ['(a*)*b', false],
  ['(a|a?)+$', true],
  ['(\\p{L}+)*$', true],
];

const input = 'a'.repeat(SAFE_REGEX_LIMITS.inputChars - 1) + '!';
const started = process.hrtime.bigint();
const results = CASES.map(([pattern, expected]) => {
  const compiled = compileSafeRegex(pattern);
  return { pattern, expected, compiled: compiled.ok, matched: compiled.ok ? compiled.program.test(input) : null };
});
const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;

process.stdout.write(JSON.stringify({ elapsedMs, inputLength: input.length, results }));
