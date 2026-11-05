export type TeachingLocale = 'vi' | 'en';

export function teachingTitle(value: unknown, locale: TeachingLocale, fallback: string): string {
  if (typeof value === 'string' && value.trim()) return value;
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const labels = value as Record<string, unknown>;
    for (const language of [locale, locale === 'vi' ? 'en' : 'vi']) {
      const label = labels[language];
      if (typeof label === 'string' && label.trim()) return label;
    }
  }
  return fallback;
}

/** Lesson containers nest blocks under blocks, items, or steps. */
export function assignmentTitle(source: unknown, blockId: string | null, locale: TeachingLocale, fallback: string): string {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return fallback;
  const root = source as Record<string, unknown>;
  if (!blockId) return teachingTitle(root.title, locale, fallback);
  const queue: unknown[] = Array.isArray(root.blocks) ? [...root.blocks] : [];
  while (queue.length) {
    const value = queue.shift();
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const node = value as Record<string, unknown>;
    if (node.type === 'assignment' && node.id === blockId) return teachingTitle(node.title, locale, fallback);
    for (const field of ['blocks', 'items', 'steps']) {
      if (Array.isArray(node[field])) queue.push(...node[field]);
    }
  }
  return fallback;
}
