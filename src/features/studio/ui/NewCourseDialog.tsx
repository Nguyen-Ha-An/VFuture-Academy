'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

import { PlusIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
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
      <SheetContent side="right" showCloseButton={false} className="w-full gap-0 sm:max-w-xl">
        <SheetHeader className="pb-4">
          <SheetTitle className="text-lg leading-snug">{t('dialogTitle')}</SheetTitle>
          <SheetDescription>{t('dialogDescription')}</SheetDescription>
        </SheetHeader>
        <form className="flex min-h-0 flex-1 flex-col" onSubmit={submit}>
          <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-6 pb-6">
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium leading-snug" htmlFor="new-course-id">{t('id')}</label>
              <Input id="new-course-id" value={id} onChange={(event) => setId(event.target.value)} aria-invalid={Boolean(idError)} aria-errormessage={idError ? 'new-course-id-error' : undefined} autoComplete="off" />
              {idError ? <p id="new-course-id-error" role="alert" className="text-sm text-destructive">{idError}</p> : <p className="text-xs leading-snug text-muted-foreground">{t('idHint')}</p>}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2"><label className="text-sm font-medium leading-snug" htmlFor="new-course-title-vi">{t('titleVi')}</label><Input id="new-course-title-vi" value={titleVi} onChange={(event) => setTitleVi(event.target.value)} aria-invalid={defaultLanguage === 'vi' && Boolean(titleError)} aria-errormessage={defaultLanguage === 'vi' && titleError ? 'new-course-title-error' : undefined} /></div>
              <div className="flex flex-col gap-2"><label className="text-sm font-medium leading-snug" htmlFor="new-course-title-en">{t('titleEn')}</label><Input id="new-course-title-en" value={titleEn} onChange={(event) => setTitleEn(event.target.value)} aria-invalid={defaultLanguage === 'en' && Boolean(titleError)} aria-errormessage={defaultLanguage === 'en' && titleError ? 'new-course-title-error' : undefined} /></div>
            </div>
            {titleError ? <p id="new-course-title-error" role="alert" className="text-sm text-destructive">{titleError}</p> : null}
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-2 text-sm font-medium leading-snug">{t('languages')}</legend>
              <div className="flex flex-wrap gap-5">
                {(['vi', 'en'] as const).map((locale) => <label key={locale} className="flex min-h-9 items-center gap-2 text-sm"><Checkbox checked={languages.includes(locale)} onChange={(event) => toggleLanguage(locale, event.target.checked)} />{t(`language.${locale}`)}</label>)}
              </div>
              {languages.length === 0 ? <p role="alert" className="text-sm text-destructive">{t('languageRequired')}</p> : null}
            </fieldset>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="flex flex-col gap-2"><label className="text-sm font-medium leading-snug" htmlFor="new-course-default-language">{t('defaultLanguage')}</label><NativeSelect id="new-course-default-language" value={defaultLanguage} onChange={(event) => setDefaultLanguage(event.target.value as Locale)}>{languages.map((locale) => <NativeSelectOption key={locale} value={locale}>{t(`language.${locale}`)}</NativeSelectOption>)}</NativeSelect></div>
              <div className="flex flex-col gap-2"><label className="text-sm font-medium leading-snug" htmlFor="new-course-pathway">{t('pathway')}</label><NativeSelect id="new-course-pathway" value={pathway} onChange={(event) => setPathway(event.target.value as (typeof PATHWAYS)[number])}>{PATHWAYS.map((value) => <NativeSelectOption key={value} value={value}>{t(`pathwayOptions.${value}`)}</NativeSelectOption>)}</NativeSelect></div>
              <div className="flex flex-col gap-2"><label className="text-sm font-medium leading-snug" htmlFor="new-course-level">{t('level')}</label><NativeSelect id="new-course-level" value={level} onChange={(event) => setLevel(event.target.value as typeof level)}><NativeSelectOption value="foundation">{t('levelOptions.foundation')}</NativeSelectOption><NativeSelectOption value="specialization">{t('levelOptions.specialization')}</NativeSelectOption></NativeSelect></div>
            </div>
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
