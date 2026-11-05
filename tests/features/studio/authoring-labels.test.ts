import { describe, expect, it } from 'vitest';
import { AUTHORING_LABELS, authoringFieldLabel, authoringValueLabel, authoringVariantLabel } from '@/features/studio/authoring-labels';
import course from '../../../public/schemas/v1/course.json';
import lesson from '../../../public/schemas/v1/lesson.json';
import exam from '../../../public/schemas/v1/exam.json';
import assignment from '../../../public/schemas/v1/assignment.json';
import bank from '../../../public/schemas/v1/question_bundle.json';
import resource from '../../../public/schemas/v1/resource.json';

function schemaVocabulary() {
  const fields = new Set<string>();
  const values = new Set<string>();
  function visit(value: unknown) {
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (!value || typeof value !== 'object') return;
    const node = value as Record<string, unknown>;
    if (node.properties && typeof node.properties === 'object') Object.keys(node.properties).forEach(key => fields.add(key));
    if (Array.isArray(node.enum)) node.enum.forEach(entry => { if (typeof entry === 'string') values.add(entry); });
    if (typeof node.const === 'string') values.add(node.const);
    Object.values(node).forEach(visit);
  }
  [course, lesson, exam, assignment, bank, resource].forEach(visit);
  return { fields, values };
}

describe('visual authoring translations', () => {
  it('provides explicit English and Vietnamese labels for every field in all six document schemas', () => {
    const { fields } = schemaVocabulary();
    expect([...fields].filter(key => !AUTHORING_LABELS[key])).toEqual([]);
    for (const field of fields) for (const locale of ['en', 'vi'] as const) expect(authoringFieldLabel(field, locale).trim()).not.toBe('');
  });
  it('localizes schema choices while retaining established technical names and aspect ratios', () => {
    const technical = new Set(['bash', 'c', 'cpp', 'csharp', 'css', 'go', 'html', 'java', 'javascript', 'json', 'jsx', 'jupyterlite', 'kotlin', 'markdown', 'python', 'r', 'rust', 'sql', 'swift', 'tsx', 'typescript', 'vimeo', 'yaml', 'youtube', '1', '16:9', '1:1', '4:3', 'video', 'pdf', 'code', 'url']);
    const { values } = schemaVocabulary();
    const untranslated = [...values].filter(value => !technical.has(value) && authoringValueLabel(value, 'vi') === value);
    expect(untranslated).toEqual([]);
    expect(authoringValueLabel('javascript', 'vi')).toBe('JavaScript');
    expect(authoringValueLabel('on_release', 'vi')).toBe('Khi công bố kết quả');
  });
  it('localizes both block palettes and structural format choices', () => {
    expect(authoringVariantLabel({ properties: { type: { const: 'question_group' } } }, 'vi')).toBe('Nhóm câu hỏi');
    expect(authoringVariantLabel({ type: 'object', properties: { assetId: {} } }, 'vi')).toBe('Mã tệp đa phương tiện');
    expect(authoringVariantLabel({ type: 'array' }, 'vi')).toBe('Danh sách');
  });
});
