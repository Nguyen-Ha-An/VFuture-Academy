import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const learnerCss = readFileSync(path.join(process.cwd(), 'src/features/workspace-ui/learner/learner.css'), 'utf8');

describe('learner detail and profile CSS', () => {
  it('lets profile links inherit colour at zero specificity so the head meta hover signal wins', () => {
    expect(learnerCss).toContain(':where(.vf-profile, .vf-lb) a { color: inherit; }');
    expect(learnerCss).not.toMatch(/\.vf-profile a:not\(/);
    expect(learnerCss).toMatch(/\.vf-l-head-meta a:hover \{ color: var\(--vf-signal\); \}/);
  });

  it('puts proposal fields on --surface like every learner input', () => {
    expect(learnerCss).toMatch(/\.vf-proposal :is\(input:not\(\[type="file"\]\), textarea\), \.vf-mcb-trigger \{[^}]*background: var\(--vf-surface\)/);
  });

  it('gives head meta links the learner 44px target', () => {
    expect(learnerCss).toMatch(/\.vf-l-head-meta a \{[^}]*min-height: 44px/);
  });

  it('keeps the profile settings cards on the 760/1100 breakpoints with a 44px upload control', () => {
    const settings = learnerCss.slice(learnerCss.indexOf('/* Profile settings:'));
    expect(settings.length).toBeGreaterThan(20);
    for (const [, width] of settings.matchAll(/@media \((?:min|max)-width: (\d+)px\)/g)) expect(['759', '760', '1099', '1100']).toContain(width);
    expect(settings).toMatch(/\.vf-l-upload \{[^}]*min-height: 44px/);
  });

  it('drops the old project detail rules for the DetailPage layout', () => {
    expect(learnerCss).not.toMatch(/\.vf-project-(action|cover|detail|aside|link|people|skill-list)\b/);
  });
});
