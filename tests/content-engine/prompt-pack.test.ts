import { describe, it, expect } from 'vitest';
import { buildPromptPack, BLOCK_CHEATSHEET, QUESTION_CHEATSHEET } from '@/content-engine/prompt-pack';
import { LESSON_BLOCK_TYPES } from '@/content-engine/schema/lesson';
import { QUESTION_TYPES, QuestionSchema } from '@/content-engine/schema/questions';
import { LessonBlockSchema } from '@/content-engine/schema/lesson';
import { RENDERABLE_BLOCK_TYPES } from '@/content-engine/manifest/blocks';

describe('cheat sheets', () => {
  it('has a valid example for every renderable block type and every question type', () => {
    for (const t of RENDERABLE_BLOCK_TYPES) { const r = LessonBlockSchema.safeParse(JSON.parse(BLOCK_CHEATSHEET[t])); expect(r.success, `${t}: ${JSON.stringify(r.error?.issues)}`).toBe(true); }
    for (const t of QUESTION_TYPES) { const r = QuestionSchema.safeParse(JSON.parse(QUESTION_CHEATSHEET[t])); expect(r.success, `${t}: ${JSON.stringify(r.error?.issues)}`).toBe(true); }
    expect(Object.keys(BLOCK_CHEATSHEET).sort()).toEqual([...LESSON_BLOCK_TYPES].filter((t) => t !== 'math' && t !== 'diagram').sort());
  });
});

describe('buildPromptPack', () => {
  const course = { id: 'ai-foundations', title: 'AI Foundations', languages: ['vi', 'en'] as ('vi' | 'en')[], defaultLanguage: 'vi' as const };
  it('lesson prompt names the stub, lists allowed blocks and question types, and demands a single JSON document', () => {
    const p = buildPromptPack({ kind: 'lesson', locale: 'en', course, stub: { id: 'what-is-ai', title: 'What is AI?', objectives: ['Define AI'], estimatedMinutes: 20 }, availableResources: ['prompting-cheat-sheet'], availableOpportunities: ['ai-build-sprint-01'] });
    expect(p).toContain('"kind": "lesson"');
    expect(p).toContain('"id": "what-is-ai"');
    for (const t of RENDERABLE_BLOCK_TYPES) expect(p).toContain(`\`${t}\``);
    for (const t of QUESTION_TYPES) expect(p).toContain(`\`${t}\``);
    expect(p).toMatch(/Output only the JSON/);
    expect(p).toContain('prompting-cheat-sheet');
    expect(p).toContain('{ "vi": "...", "en": "..." }');
  });
  it('outline prompt asks for stubs only; exam prompt includes pools and settings; translate embeds the document', () => {
    expect(buildPromptPack({ kind: 'course_outline', locale: 'vi', brief: { title: 'Nền tảng AI', audience: 'THPT', languages: ['vi', 'en'], defaultLanguage: 'vi', pathway: 'ai-emerging-technology', level: 'foundation', durationHours: 4, outcomes: ['Giải thích AI'] } })).toMatch(/không viết "blocks"|stubs/i);
    const exam = buildPromptPack({ kind: 'exam', locale: 'en', course, stub: { id: 'exam-m1', title: 'Module 1 exam' }, coverage: ['AI vs ML'], questionCount: 10, timeLimitMinutes: 30, bankTags: ['ai-basics'] });
    expect(exam).toContain('"$pool"');
    expect(exam).toContain('"timeLimitMinutes": 30');
    const tr = buildPromptPack({ kind: 'translate', locale: 'en', targetLocale: 'en', document: { kind: 'lesson', id: 'x', title: { vi: 'Xin chào' } } });
    expect(tr).toContain('"vi": "Xin chào"');
    expect(tr).toMatch(/do not change ids|IDs must stay/i);
  });
  it('keeps the vi translate prompt entirely in Vietnamese', () => {
    const tr = buildPromptPack({ kind: 'translate', locale: 'vi', targetLocale: 'en', document: { kind: 'lesson', id: 'x', title: { vi: 'Xin chào' } } });
    expect(tr).toContain('ID phải giữ nguyên');
    expect(tr).not.toContain('IDs must stay');
  });
  it('outline skeleton echoes the brief level, languages and default language', () => {
    const outline = buildPromptPack({ kind: 'course_outline', locale: 'en', brief: { title: 'Advanced AI', audience: 'THPT', languages: ['en'], defaultLanguage: 'en', pathway: 'ai-emerging-technology', level: 'specialization', durationHours: 8, outcomes: ['Ship an agent'] } });
    expect(outline).toContain('"level": "specialization"');
    expect(outline).toContain('"languages": ["en"]');
    expect(outline).toContain('"defaultLanguage": "en"');
  });
  it('exam pool example uses the "from" form when no bank tags are given', () => {
    const exam = buildPromptPack({ kind: 'exam', locale: 'en', course, stub: { id: 'exam-m1', title: 'Module 1 exam' }, coverage: ['AI vs ML'], questionCount: 10, timeLimitMinutes: 30 });
    expect(exam).not.toContain('"tags": []');
    expect(exam).toContain('"from": ["bank:<question-id>", "bank:<question-id>"]');
  });
  it('quiz and bundle prompts', () => {
    expect(buildPromptPack({ kind: 'quiz', locale: 'en', lessonSummary: 'Intro to prompts', count: 5, types: ['single_choice', 'fill_blank'] })).toContain('"type": "quiz"');
    expect(buildPromptPack({ kind: 'question_bundle', locale: 'en', topic: 'Prompting', count: 20, tags: ['prompting'], difficultyMix: { easy: 8, medium: 8, hard: 4 } })).toContain('"kind": "question_bundle"');
  });
});
