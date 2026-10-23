import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// `data-[state=open]:animate-in` carries an attribute selector, so a plain `motion-reduce:animate-none`
// loses on specificity and portalled menus and dialogs (the learner ⌘K palette) still zoom in under
// reduced motion. The override is important in every primitive that animates on a data state.
const primitives = ['dialog', 'dropdown-menu', 'popover', 'sheet', 'tooltip'];

describe('reduced motion in UI primitives', () => {
  for (const name of primitives) it(`${name} stops its data-state animations under reduced motion`, () => {
    const source = readFileSync(path.join(process.cwd(), `src/components/ui/${name}.tsx`), 'utf8');
    const classLists = source.match(/"[^"]*data-\[state=(?:open|closed)\]:animate-(?:in|out)[^"]*"/g) ?? [];
    expect(classLists.length).toBeGreaterThan(0);
    for (const list of classLists) expect(list, list).toMatch(/(?:^|\s|")motion-reduce:animate-none!(?:\s|")/);
  });
});
