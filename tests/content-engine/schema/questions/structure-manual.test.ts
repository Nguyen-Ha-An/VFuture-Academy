import { describe, it, expect } from 'vitest';
import { MatchingSchema, OrderingSchema, ClassificationSchema } from '@/content-engine/schema/questions/structure';
import { EssaySchema, UploadAnswerSchema, CodeAnswerSchema } from '@/content-engine/schema/questions/manual';

const rc = (t: string) => ({ blocks: [{ type: 'paragraph', content: [{ text: t }] }] });
const item = (id: string) => ({ id, content: rc(id) });

describe('matching', () => {
  const q = { id: 'm1', type: 'matching', content: rc('Match'), left: [item('l1'), item('l2')], right: [item('r1'), item('r2'), item('r3')], correctAnswer: [{ left: 'l1', right: 'r1' }, { left: 'l2', right: 'r2' }] };
  it('accepts with distractor on the right', () => expect(MatchingSchema.safeParse(q).success).toBe(true));
  it('rejects record-shaped key', () => expect(MatchingSchema.safeParse({ ...q, correctAnswer: { l1: 'r1' } }).success).toBe(false));
});

describe('ordering', () => {
  const q = { id: 'o1', type: 'ordering', content: rc('Order'), items: [item('a'), item('b'), item('c')], correctAnswer: ['c', 'a', 'b'] };
  it('accepts, including timeline slots', () => {
    expect(OrderingSchema.safeParse(q).success).toBe(true);
    expect(OrderingSchema.safeParse({ ...q, display: { interactionType: 'timeline' }, slots: [{ id: 's1', label: '1945' }, { id: 's2', label: '1975' }, { id: 's3', label: '1986' }] }).success).toBe(true);
  });
});

describe('classification', () => {
  const q = { id: 'c1', type: 'classification', content: rc('Sort'), categories: [{ id: 'ml', label: { vi: 'Học máy', en: 'ML' } }, { id: 'rules', label: 'Rules' }], items: [item('i1'), item('i2')], correctAnswer: { i1: 'ml', i2: 'rules' } };
  it('accepts', () => expect(ClassificationSchema.safeParse(q).success).toBe(true));
  it('rejects one category', () => expect(ClassificationSchema.safeParse({ ...q, categories: [q.categories[0]] }).success).toBe(false));
});

describe('manual types', () => {
  const rubric = { criteria: [{ id: 'clarity', name: { vi: 'Rõ ràng', en: 'Clarity' }, maxPoints: 4, levels: [{ points: 0, label: 'Missing' }, { points: 4, label: 'Excellent' }] }] };
  it('essay accepts single and multi prompt', () => {
    expect(EssaySchema.safeParse({ id: 'e1', type: 'essay', content: rc('Discuss'), minWords: 50, maxWords: 300, rubric, sampleAnswer: rc('model') }).success).toBe(true);
    expect(EssaySchema.safeParse({ id: 'e2', type: 'essay', content: rc('Look at the picture'), prompts: ['a. What?', { vi: 'b. Vì sao?', en: 'b. Why?' }], rubric }).success).toBe(true);
  });
  it('upload_answer requires accepts and allows links', () => {
    expect(UploadAnswerSchema.safeParse({ id: 'u1', type: 'upload_answer', content: rc('Submit'), accepts: ['file', 'link'], allowedMimeTypes: ['application/pdf'], maxFiles: 2, linkHosts: ['github.com'], rubric }).success).toBe(true);
    expect(UploadAnswerSchema.safeParse({ id: 'u1', type: 'upload_answer', content: rc('Submit'), accepts: [] }).success).toBe(false);
  });
  it('code_answer requires a known language', () => {
    expect(CodeAnswerSchema.safeParse({ id: 'k1', type: 'code_answer', content: rc('Write a loop'), language: 'python', starterCode: 'for i in range(3):\n    pass', rubric }).success).toBe(true);
    expect(CodeAnswerSchema.safeParse({ id: 'k1', type: 'code_answer', content: rc('x'), language: 'cobol' }).success).toBe(false);
  });
  it('rejects a correctAnswer on a manually graded type instead of tolerating it', () => {
    // It used to parse and merely warn, which let an answer key nothing grades reach
    // storage. The manual schemas are strict, so the field is refused outright.
    const parsed = EssaySchema.safeParse({ id: 'e1', type: 'essay', content: rc('x'), correctAnswer: 'anything' });
    expect(parsed.success).toBe(false);
    expect(JSON.stringify(parsed.error?.issues)).toContain('correctAnswer');
  });
  it('still accepts every legitimate manual field, including selfAssessment', () => {
    expect(EssaySchema.safeParse({ id: 'e1', type: 'essay', content: rc('x'), selfAssessment: true }).success).toBe(true);
  });
});
