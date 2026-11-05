'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

import { PlusIcon } from 'lucide-react';

import { CanvasButton as Button, CanvasTextInput, CanvasSelect, CanvasCheckbox, CanvasFormFieldGroup } from '@/features/canvas/ui';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { IdSchema } from '@/content-engine/schema/common';
import { CourseCreationInputSchema } from '@/features/studio/course-creation';

const PATHWAYS = [
  'ai-emerging-technology',
  'research-innovation',
  'entrepreneurship-product',
  'fintech-economics',
  'core-future-skills',
] as const;

type Locale = 'vi' | 'en';

async function responseError(response: Response, fallback: string): Promise<string> {
  try {
    const body = await response.json() as { error?: { message?: string } };
    return body.error?.message ?? fallback;
  } catch {
    return fallback;
  }
}

export function NewCourseDialog() {
  const t = useTranslations('studio.courses');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const sheetContentRef = useRef<HTMLDivElement>(null);
  const [id, setId] = useState('');
  const [titleVi, setTitleVi] = useState('');
  const [titleEn, setTitleEn] = useState('');
  const [languages, setLanguages] = useState<Locale[]>(['vi', 'en']);
  const [defaultLanguage, setDefaultLanguage] = useState<Locale>('vi');
  const [pathway, setPathway] = useState<(typeof PATHWAYS)[number]>('core-future-skills');
  const [level, setLevel] = useState<'foundation' | 'specialization'>('foundation');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const title: Partial<Record<Locale, string>> = {};
  if (titleVi.trim()) title.vi = titleVi.trim();
  if (titleEn.trim()) title.en = titleEn.trim();
  const creationInput = { id, title, languages, defaultLanguage, pathway, level };
  const idError = id.length > 0 && !IdSchema.safeParse(id).success ? t('invalidId') : null;
  const titleError = id.length > 0 && !idError && !(defaultLanguage === 'vi' ? titleVi : titleEn).trim()
    ? t('defaultTitleRequired')
    : null;
  const valid = CourseCreationInputSchema.safeParse(creationInput).success;

  function toggleLanguage(locale: Locale, checked: boolean) {
    const next = checked
      ? [...new Set([...languages, locale])]
      : languages.filter((value) => value !== locale);
    setLanguages(next);
    if (!next.includes(defaultLanguage) && next[0]) setDefaultLanguage(next[0]);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!valid || pending) return;

    setPending(true);
    setError(null);
    try {
      const createResponse = await fetch('/api/v1/studio/courses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(creationInput),
      });
      if (!createResponse.ok) throw new Error(await responseError(createResponse, t('createError')));

      setOpen(false);
      router.push(`/studio/courses/${encodeURIComponent(id)}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('createError'));
    } finally {
      setPending(false);
    }
  }

  // Create in a right-hand sheet (staff page anatomy); the confirm step lives in the sheet footer.
  return (
    <Sheet open={open} onOpenChange={(next) => { if (!pending) setOpen(next); }}>
      <SheetTrigger asChild><Button><PlusIcon aria-hidden="true" />{t('newCourse')}</Button></SheetTrigger>
      <SheetContent ref={sheetContentRef} side="right" showCloseButton={false} className="w-full gap-0 sm:max-w-xl">
        <SheetHeader className="pb-4">
          <SheetTitle className="text-lg leading-snug">{t('dialogTitle')}</SheetTitle>
          <SheetDescription>{t('dialogDescription')}</SheetDescription>
        </SheetHeader>
        <form className="flex min-h-0 flex-1 flex-col" onSubmit={submit}>
          <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-6 pb-6">
            <CanvasTextInput id="new-course-id" label={t('id')} value={id} onChange={setId} disabled={pending} autoComplete="off" messages={[idError ? { type: 'error', text: idError } : { type: 'hint', text: t('idHint') }]} />
            <div className="grid gap-4 sm:grid-cols-2">
              <CanvasTextInput id="new-course-title-vi" label={t('titleVi')} value={titleVi} onChange={setTitleVi} disabled={pending} messages={defaultLanguage === 'vi' && titleError ? [{ type: 'error', text: titleError }] : undefined} />
              <CanvasTextInput id="new-course-title-en" label={t('titleEn')} value={titleEn} onChange={setTitleEn} disabled={pending} messages={defaultLanguage === 'en' && titleError ? [{ type: 'error', text: titleError }] : undefined} />
            </div>
            <CanvasFormFieldGroup description={t('languages')} layout="inline" messages={languages.length === 0 ? [{ type: 'error', text: t('languageRequired') }] : undefined}>
              {(['vi', 'en'] as const).map(locale => <CanvasCheckbox key={locale} label={t(`language.${locale}`)} checked={languages.includes(locale)} disabled={pending} onChange={checked => toggleLanguage(locale, checked)} />)}
            </CanvasFormFieldGroup>
            <CanvasSelect mountNode={() => sheetContentRef.current} id="new-course-default-language" label={t('defaultLanguage')} value={defaultLanguage} disabled={pending || !languages.length} options={(['vi', 'en'] as const).map(locale => ({ value: locale, label: t(`language.${locale}`), disabled: !languages.includes(locale) }))} onChange={value => setDefaultLanguage(value as Locale)} />
            <CanvasSelect mountNode={() => sheetContentRef.current} id="new-course-pathway" label={t('pathway')} value={pathway} disabled={pending} options={PATHWAYS.map(value => ({ value, label: t(`pathwayOptions.${value}`) }))} onChange={value => setPathway(value as (typeof PATHWAYS)[number])} />
            <CanvasSelect mountNode={() => sheetContentRef.current} id="new-course-level" label={t('level')} value={level} disabled={pending} options={(['foundation', 'specialization'] as const).map(value => ({ value, label: t(`levelOptions.${value}`) }))} onChange={value => setLevel(value as typeof level)} />
          </div>
          <SheetFooter>
            <p aria-live="polite" className="min-h-5 text-sm text-destructive">{error}</p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" disabled={pending} onClick={() => setOpen(false)}>{t('cancel')}</Button>
              <Button type="submit" disabled={!valid || pending}>{pending ? t('creating') : t('create')}</Button>
            </div>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
