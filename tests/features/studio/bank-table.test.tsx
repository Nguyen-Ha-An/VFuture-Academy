// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it } from 'vitest';

import en from '@/messages/en.json';
import { staffUiTestMessages } from '@/messages/staff-ui';
import { BankTable } from '@/features/studio/ui/BankTable';

const messages = staffUiTestMessages(en, 'en');

const questions = [
  { id: 'ai-choice', type: 'single_choice', tags: ['ai', 'basics'], difficulty: 'easy', status: 'published', usages: [
    { versionId: 'version-1', courseId: 'course-a', itemId: 'lesson-1' },
    { versionId: 'version-2', courseId: 'course-b', itemId: 'exam-1' },
  ] },
  { id: 'research-essay', type: 'essay', tags: ['research'], difficulty: 'hard', status: 'draft', usages: [] },
] as const;

describe('BankTable', () => {
  afterEach(cleanup);

  it('submits labelled filters to the server and preserves them in pagination links', () => {
    const page = Array.from({ length: 50 }, (_, index) => ({
      id: `ai-choice-${index + 1}`,
      type: 'single_choice',
      tags: ['ai'],
      difficulty: 'easy',
      status: 'published',
      usages: [],
    }));
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <BankTable
          questions={page}
          filters={{ types: ['single_choice'], tags: ['ai'], difficulties: ['easy'], status: 'published', page: 1 }}
        />
      </NextIntlClientProvider>,
    );

    expect(screen.getByLabelText('Question type')).toHaveValue('single_choice');
    expect(screen.getByLabelText('Filter by tag')).toHaveValue('ai');
    expect(screen.getByLabelText('Difficulty')).toHaveValue('easy');
    expect(screen.getByLabelText('Status')).toHaveValue('published');
    expect(screen.getByRole('button', { name: 'Apply filters' })).toHaveAttribute('type', 'submit');
    expect(screen.getByRole('link', { name: 'Next page' })).toHaveAttribute(
      'href',
      '/studio/bank?type=single_choice&tags=ai&difficulty=easy&status=published&page=2',
    );
  });

  it('renders only the rows supplied by the server', () => {
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <BankTable questions={questions.map((question) => ({ ...question, tags: [...question.tags] }))} filters={{}} />
      </NextIntlClientProvider>,
    );

    expect(screen.getByRole('link', { name: 'ai-choice' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'research-essay' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /course-a.*lesson-1/i })).toHaveAttribute(
      'href',
      '/studio/courses/course-a#workspace-editor',
    );
    expect(screen.queryByRole('link', { name: 'Next page' })).not.toBeInTheDocument();
  });
});
