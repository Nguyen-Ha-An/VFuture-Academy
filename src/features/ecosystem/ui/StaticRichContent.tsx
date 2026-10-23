'use client';

import { useMemo } from 'react';
import { useLocale } from 'next-intl';

import type { Locale } from '@/content-engine/schema/common';
import type { RichContent } from '@/content-engine/schema/types';
import { registerAll, RichContentView, type LessonRuntime } from '@/content-engine/render';
import { routes } from '@/lib/routes';
import { publicMediaHref } from '@/features/media/urls';
import { publicRichContentHeadings } from './public-rich-content';

registerAll();

export function StaticRichContent({ content, publicContent = false }: { content: RichContent; publicContent?: boolean }) {
  const requestedLocale = useLocale();
  const locale: Locale = requestedLocale === 'en' ? 'en' : 'vi';
  const renderedContent = useMemo(() => publicContent ? publicRichContentHeadings(content) : content, [content, publicContent]);
  const runtime = useMemo<LessonRuntime>(() => ({
    mode: 'preview',
    locale,
    getBlockState: () => undefined,
    setBlockState: () => undefined,
    getAssignmentSession: () => undefined,
    refreshAssignmentSession: async () => { throw new Error('Activities are not available in static content'); },
    submitQuiz: async () => { throw new Error('Activities are not available in static content'); },
    checkQuestion: async () => { throw new Error('Activities are not available in static content'); },
    submitAssignment: async () => { throw new Error('Activities are not available in static content'); },
    uploadAssignmentFile: async () => { throw new Error('Uploads are not available in static content'); },
    uploadFile: async () => { throw new Error('Uploads are not available in static content'); },
    resolveMedia: (reference) => 'url' in reference
      ? reference.url
      : publicContent ? publicMediaHref(reference.assetId) : `/api/v1/media/${encodeURIComponent(reference.assetId)}`,
    hrefFor: (target) => 'url' in target
      ? target.url
      : target.kind === 'resource' || target.kind === 'opportunity'
        ? target.kind === 'resource'
          ? publicContent ? routes.public.resource(target.id) : routes.learner.resource(target.id)
          : publicContent ? routes.public.opportunity(target.id) : routes.learner.opportunity(target.id)
        : target.kind === 'course'
          ? publicContent ? routes.public.course(target.id) : routes.learner.course(target.id)
          : '#',
    markViewed: () => undefined,
    onActivityComplete: () => undefined,
  }), [locale, publicContent]);

  return <RichContentView content={renderedContent} runtime={runtime} path="/content" />;
}
