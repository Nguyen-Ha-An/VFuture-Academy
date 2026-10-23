import type { Grader, PartStatus } from '../types';
import { fromRatio, incomplete, isEmptyAnswer } from '../types';

const setEq = (a: Set<string>, b: Set<string>) => a.size === b.size && [...a].every((v) => b.has(v));

export const gradeMatching: Grader = (gq, answer) => {
  if (isEmptyAnswer(answer) || !Array.isArray(answer) || !answer.every((e) => e && typeof e === 'object' && typeof (e as { left?: unknown }).left === 'string' && typeof (e as { right?: unknown }).right === 'string')) return incomplete(gq);
  const key = gq.correctAnswer as { left: string; right: string }[];
  const keyByLeft = new Map<string, Set<string>>();
  for (const e of key) { if (!keyByLeft.has(e.left)) keyByLeft.set(e.left, new Set()); keyByLeft.get(e.left)!.add(e.right); }
  const givenByLeft = new Map<string, Set<string>>();
  for (const e of answer as { left: string; right: string }[]) { if (!givenByLeft.has(e.left)) givenByLeft.set(e.left, new Set()); givenByLeft.get(e.left)!.add(e.right); }
  // A left is `correct` iff the learner's rights for it exactly match the key's rights for it (set equality);
  // `incorrect` if they connected anything else; `missing` if they connected nothing. Edges whose left isn't
  // in the key are ignored here (no parts entry, no effect on any real left's correctness).
  const parts: Record<string, PartStatus> = {};
  const correctLefts = new Set<string>();
  for (const [left, rights] of keyByLeft) {
    const given = givenByLeft.get(left);
    if (!given || given.size === 0) parts[left] = 'missing';
    else if (setEq(given, rights)) { parts[left] = 'correct'; correctLefts.add(left); }
    else parts[left] = 'incorrect';
  }
  const correct = key.filter((e) => correctLefts.has(e.left)).length;
  return fromRatio(gq, correct / key.length, parts);
};

export const gradeOrdering: Grader = (gq, answer) => {
  if (isEmptyAnswer(answer) || !Array.isArray(answer) || !answer.every((a) => typeof a === 'string')) return incomplete(gq);
  const key = gq.correctAnswer as string[];
  const parts: Record<string, PartStatus> = {};
  let matched = 0;
  key.forEach((id, i) => { if ((answer as string[])[i] === id) { matched++; parts[id] = 'correct'; } else parts[id] = (answer as string[]).includes(id) ? 'incorrect' : 'missing'; });
  return fromRatio(gq, matched / key.length, parts);
};

export const gradeClassification: Grader = (gq, answer) => {
  if (isEmptyAnswer(answer) || typeof answer !== 'object' || Array.isArray(answer)) return incomplete(gq);
  const key = gq.correctAnswer as Record<string, string>;
  const given = answer as Record<string, unknown>;
  const parts: Record<string, PartStatus> = {};
  let correct = 0;
  for (const [item, cat] of Object.entries(key)) { const g = given[item]; if (typeof g !== 'string') parts[item] = 'missing'; else if (g === cat) { correct++; parts[item] = 'correct'; } else parts[item] = 'incorrect'; }
  return fromRatio(gq, correct / Object.keys(key).length, parts);
};
