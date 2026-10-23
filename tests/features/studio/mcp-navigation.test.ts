import { describe, expect, it } from 'vitest';

import { workspaceNavigationFor } from '@/lib/workspace-navigation';

describe('Studio MCP navigation', () => {
  it('places Add MCP after Review queue for course readers', () => {
    const items = workspaceNavigationFor('studio', ['course.read', 'content.review']);
    expect(items.at(-1)).toMatchObject({ key: 'mcp', href: '/studio/mcp' });
    expect(items.at(-2)?.key).toBe('reviews');
  });

  it('allows content readers but hides setup from roles without course read access', () => {
    expect(workspaceNavigationFor('studio', ['content.read']).some((item) => item.key === 'mcp')).toBe(true);
    expect(workspaceNavigationFor('studio', ['content.review']).some((item) => item.key === 'mcp')).toBe(false);
  });
});
