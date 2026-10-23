import { describe, expect, it } from 'vitest';
import * as engine from '@/content-engine';

describe('content-engine public API', () => {
  it('exposes the documented entry points', () => {
    for (const name of [
      'validateWorkspace',
      'validateStandaloneDocument',
      'compileCourse',
      'compileBankQuestion',
      'migrateDocument',
      'gradeQuestion',
      'gradeAll',
      'applyScoringPolicy',
      'evaluateCompletion',
      'evaluateLessonCompletion',
      'buildPromptPack',
      'exportJsonSchemas',
      'splitInlineCourse',
      'inlineWorkspace',
      'workspaceFromDocuments',
      'parseJsonDocument',
      'InMemoryResolver',
      'BLOCK_MANIFEST',
      'PLAYER_MANIFEST',
      'resolvePlayer',
      'QUESTION_TYPES',
      'CURRENT_SCHEMA_VERSION',
      'CONTENT_ENGINE_VERSION',
    ]) {
      expect(engine, name).toHaveProperty(name);
    }
  });
});
