import { InMemoryResolver } from '../validate/semantic/refs';
import { AI_FOUNDATIONS_BANK_BUNDLE } from './bank';

export const fixtureResolver = new InMemoryResolver({
  bank: AI_FOUNDATIONS_BANK_BUNDLE.questions.map((question) => ({
    id: question.id,
    versionId: `v-${question.id}`,
    type: question.type,
    tags: question.tags,
    difficulty: question.difficulty,
    question,
  })),
  assets: ['asset_ai_map', 'asset_cover_ai', 'asset_handout_pdf', 'asset_intro_audio'],
  resources: ['prompting-cheat-sheet', 'responsible-ai-guide'],
  opportunities: ['ai-build-sprint-01', 'research-cohort-02'],
  branches: ['vinsmc', 'ans', 'dewey'],
});
