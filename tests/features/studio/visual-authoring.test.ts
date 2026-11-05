import { describe, expect, it } from 'vitest';
import { itemRef } from '@/content-engine/diagnostics';
import { LESSON_BLOCK_TYPES } from '@/content-engine/schema/lesson';
import { QUESTION_TYPES } from '@/content-engine/schema/questions';
import lessonSchema from '../../../public/schemas/v1/lesson.json';
import examSchema from '../../../public/schemas/v1/exam.json';
import { createAuthoringValue, matchingSchema, resolveAuthoringSchema, schemaVariants, visualDocument, visualSourceChange, type AuthoringSchema } from '@/features/studio/visual-authoring';

const lesson = lessonSchema as unknown as AuthoringSchema;
const exam = examSchema as unknown as AuthoringSchema;
const ref = itemRef('intro');
const source = JSON.stringify({ schemaVersion: 1, kind: 'lesson', id: 'intro', title: { vi: 'Xin chào', en: 'Welcome' }, blocks: [{ type: 'resource_link', id: 'resource-1', resourceId: 'guide' }] });

describe('visual authoring source contract', () => {
  it.each(['{', '{"id":"intro","id":"other"}', '{"value":1e999}', '[1,2]'])('refuses to overwrite invalid raw JSON: %s', raw => {
    expect(visualDocument(raw, ref)).toBeNull();
    expect(visualSourceChange(raw, raw, ref, JSON.parse(source))).toBeNull();
  });
  it('rejects stale visual events and identity edits', () => {
    expect(visualSourceChange(source + ' ', source, ref, JSON.parse(source))).toBeNull();
    expect(visualSourceChange(source, source, ref, { ...JSON.parse(source), id: 'other' })).toBeNull();
  });
  it('keeps bilingual values, ids, references and unknown future fields on a targeted change', () => {
    const document = { ...JSON.parse(source), futureField: { retained: true } };
    const raw = JSON.stringify(document);
    const next = visualSourceChange(raw, raw, ref, { ...document, estimatedMinutes: 10 });
    expect(JSON.parse(next!)).toEqual({ ...document, estimatedMinutes: 10 });
  });
});

describe('current schema coverage', () => {
  it('provides every lesson block in the palette, including nested video alternatives', () => {
    const items = resolveAuthoringSchema(lesson.properties!.blocks!, lesson).items!;
    const variants = schemaVariants(items, lesson);
    expect(new Set(variants.map(option => option.properties?.type?.const))).toEqual(new Set(LESSON_BLOCK_TYPES));
    for (const variant of variants) {
      const created = createAuthoringValue(variant, lesson, () => 'new-entry');
      expect(created).toMatchObject({ type: variant.properties!.type!.const });
      expect(matchingSchema(items, lesson, created).properties?.type?.const).toBe(variant.properties!.type!.const);
    }
  });
  it('provides every question type and preserves bank/pool entries', () => {
    const section = resolveAuthoringSchema(resolveAuthoringSchema(exam.properties!.sections!, exam).items!, exam);
    const questions = resolveAuthoringSchema(section.properties!.questions!, exam).items!;
    const variants = schemaVariants(questions, exam);
    expect(new Set(variants.flatMap(option => option.properties?.type?.const ? [option.properties.type.const] : []))).toEqual(new Set(QUESTION_TYPES));
    expect(matchingSchema(questions, exam, { $ref: 'bank:q1' }).properties).toHaveProperty('$ref');
    expect(matchingSchema(questions, exam, { $pool: { id: 'pool', count: 1, from: ['bank:q1'] } }).properties).toHaveProperty('$pool');
  });
});
