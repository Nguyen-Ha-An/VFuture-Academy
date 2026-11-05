'use client';

import { useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

import { HttpsUrlSchema, ID_PATTERN, type Locale } from '@/content-engine/schema/common';
import { CanvasButton, CanvasTextInput, CanvasTextArea } from '@/features/canvas/ui';
import '@/features/workspace-ui/support/support.css';
import { useSupportUnsaved } from '@/features/workspace-ui/support/useSupportUnsaved';
import { MultiCombobox } from '@/components/ui/multi-combobox';
import { RESERVED_PROJECT_IDS, slugifyProjectId } from '@/features/projects/ids';
import { routes } from '@/lib/routes';
import { CoverUploadError, PROJECT_COVER_TYPES, uploadProjectCover, type UploadedCover } from './cover-upload';
import { urlHostname } from './form-utils';
import { readableProjectId, type ProjectFilterOption } from './project-bench-model';

export const MAX_PROPOSAL_LINKS = 20;

type LinkRow = { key: number; label: string; url: string; error: boolean };

type CoverState =
  | { status: 'idle' }
  | { status: 'uploading'; file: File; percent: number; controller: AbortController }
  | { status: 'failed'; file: File; message: string }
  | { status: 'done'; asset: UploadedCover; preview: string };

const TITLE_MAX = 200;
const SUMMARY_MAX = 2_000;
const LABEL_MAX = 200;

function validUrl(url: string): boolean {
  return HttpsUrlSchema.safeParse(url).success;
}

/** Suggests the next free-looking link without breaking the 64-character id limit. */
function nextSlug(slug: string): string {
  return `${slug.slice(0, 62).replace(/-+$/, '')}-2`;
}

async function errorOf(response: Response): Promise<{ code?: string; message?: string }> {
  try {
    const body = await response.json() as { error?: { code?: string; message?: string } };
    return body.error ?? {};
  } catch {
    return {};
  }
}

/**
 * Learner project proposal (DESIGN D11): title and summary in the current
 * language only, an optional other-language version, a link derived from the
 * title, skill/course pickers, a real cover upload and labelled link rows.
 */
export function ProjectProposalForm({ locale, courseOptions, skillOptions }: {
  locale: Locale;
  courseOptions: readonly ProjectFilterOption[];
  skillOptions: readonly ProjectFilterOption[];
}) {
  const t = useTranslations('build.proposal');
  const router = useRouter();
  const other: Locale = locale === 'vi' ? 'en' : 'vi';
  const id = useId();
  const ids = {
    writtenIn: `${id}-written-in`,
    title: `${id}-title`,
    summary: `${id}-summary`,
    titleError: `${id}-title-error`,
    summaryError: `${id}-summary-error`,
    otherTitle: `${id}-other-title`,
    otherSummary: `${id}-other-summary`,
    link: `${id}-link`,
    linkHint: `${id}-link-hint`,
    linkError: `${id}-link-error`,
    linkEditor: `${id}-link-editor`,
    cover: `${id}-cover`,
    coverCancel: `${id}-cover-cancel`,
    coverHelp: `${id}-cover-help`,
    coverHeading: `${id}-cover-heading`,
    links: `${id}-links`,
    linksHint: `${id}-links-hint`,
    addLink: `${id}-add-link`,
  };

  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [otherTitle, setOtherTitle] = useState('');
  const [otherSummary, setOtherSummary] = useState('');
  const [customSlug, setCustomSlug] = useState<string | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [skills, setSkills] = useState<string[]>([]);
  const [courses, setCourses] = useState<string[]>([]);
  const [cover, setCover] = useState<CoverState>({ status: 'idle' });
  const [coverProblem, setCoverProblem] = useState<string | null>(null);
  const [links, setLinks] = useState<LinkRow[]>([]);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  // Whitespace-only input passes the native `required` check, so the form checks the trimmed value.
  const [fieldErrors, setFieldErrors] = useState<{ title?: boolean; summary?: boolean }>({});
  const linkKey = useRef(0);
  const previewRef = useRef<string | null>(null);
  const coverGroup = useRef<HTMLDivElement>(null);
  // Element to focus once the render that reveals it has committed.
  const focusTarget = useRef<string | null>(null);

  const slug = customSlug ?? slugifyProjectId(title);

  useEffect(() => () => {
    if (previewRef.current) URL.revokeObjectURL?.(previewRef.current);
  }, []);

  useEffect(() => {
    if (!focusTarget.current) return;
    document.getElementById(focusTarget.current)?.focus();
    focusTarget.current = null;
  });

  const setPreview = (next: string | null) => {
    if (previewRef.current && previewRef.current !== next) URL.revokeObjectURL?.(previewRef.current);
    previewRef.current = next;
  };

  // The cover controls swap as the upload runs; keep keyboard focus inside the group
  // unless the learner has already moved on.
  const focusStaysInCover = () => {
    const active = document.activeElement;
    return !active || active === document.body || Boolean(coverGroup.current?.contains(active));
  };

  const startUpload = (file: File) => {
    setCoverProblem(null);
    if (!(PROJECT_COVER_TYPES as readonly string[]).includes(file.type)) {
      setCoverProblem(t('coverType'));
      return;
    }
    const controller = new AbortController();
    if (focusStaysInCover()) focusTarget.current = ids.coverCancel;
    setCover({ status: 'uploading', file, percent: 0, controller });
    uploadProjectCover(file, {
      signal: controller.signal,
      onProgress: (percent) => setCover((current) => current.status === 'uploading' && current.controller === controller
        ? { ...current, percent }
        : current),
    }).then((asset) => {
      if (focusStaysInCover()) focusTarget.current = ids.cover;
      const preview = typeof URL.createObjectURL === 'function' ? URL.createObjectURL(file) : asset.url;
      setPreview(preview.startsWith('blob:') ? preview : null);
      setCover({ status: 'done', asset, preview });
    }).catch((error: unknown) => {
      if (focusStaysInCover()) focusTarget.current = ids.cover;
      if (error instanceof CoverUploadError && error.code === 'UPLOAD_CANCELLED') {
        setCover({ status: 'idle' });
        return;
      }
      setCover({ status: 'failed', file, message: t('coverError') });
    });
  };

  const removeCover = () => {
    if (cover.status === 'uploading') cover.controller.abort();
    focusTarget.current = ids.cover;
    setPreview(null);
    setCover({ status: 'idle' });
    setCoverProblem(null);
  };

  const updateLink = (key: number, update: Partial<LinkRow>) => {
    setLinks((rows) => rows.map((row) => row.key === key ? { ...row, ...update } : row));
  };

  const checkLink = (row: LinkRow) => {
    const url = row.url.trim();
    if (!url) {
      updateLink(row.key, { error: false });
      return;
    }
    const valid = validUrl(url);
    updateLink(row.key, {
      url,
      error: !valid,
      ...(valid && !row.label.trim() ? { label: urlHostname(url).slice(0, LABEL_MAX) } : {}),
    });
  };

  const addLink = () => {
    if (links.length >= MAX_PROPOSAL_LINKS) return;
    const key = linkKey.current++;
    focusTarget.current = `${ids.links}-${key}-label`;
    setLinks((rows) => [...rows, { key, label: '', url: '', error: false }]);
  };

  const removeLink = (key: number) => {
    // Focus the row that takes this one's place, else the previous row, else "Add link".
    const index = links.findIndex((row) => row.key === key);
    const neighbour = links[index + 1] ?? links[index - 1];
    focusTarget.current = neighbour ? `${ids.links}-${neighbour.key}-label` : ids.addLink;
    setLinks((rows) => rows.filter((row) => row.key !== key));
  };

  const showLinkError = (message: string) => {
    focusTarget.current = ids.link;
    setLinkError(message);
    setLinkOpen(true);
    setCustomSlug(slug);
  };

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || cover.status === 'uploading') return;
    setFailure(null);

    // The fields keep what was typed (an emptied field would fall back to the browser's own
    // required message); only the trimmed values are checked and sent.
    const trimmedTitle = title.trim();
    const trimmedSummary = summary.trim();
    const missing = { title: !trimmedTitle, summary: !trimmedSummary };
    setFieldErrors(missing);
    if (missing.title || missing.summary) {
      document.getElementById(missing.title ? ids.title : ids.summary)?.focus();
      return;
    }

    if (!ID_PATTERN.test(slug)) {
      showLinkError(t('linkFormat'));
      return;
    }
    if (RESERVED_PROJECT_IDS.has(slug)) {
      showLinkError(t('linkTaken', { suggestion: slugifyProjectId(slug) }));
      return;
    }

    const checked = links.map((row) => {
      const url = row.url.trim();
      return { ...row, url, error: url ? !validUrl(url) : Boolean(row.label.trim()) };
    });
    if (checked.some((row) => row.error)) {
      setLinks(checked);
      const first = checked.find((row) => row.error);
      if (first) document.getElementById(`${ids.links}-${first.key}-url`)?.focus();
      return;
    }
    setLinkError(null);

    const outputLinks = checked
      .filter((row) => row.url)
      .map((row) => ({ label: { [locale]: (row.label.trim() || urlHostname(row.url)).slice(0, LABEL_MAX) }, url: row.url }));
    const body = {
      id: slug,
      title: { [locale]: trimmedTitle, ...(otherTitle.trim() ? { [other]: otherTitle.trim() } : {}) },
      summary: { [locale]: trimmedSummary, ...(otherSummary.trim() ? { [other]: otherSummary.trim() } : {}) },
      outputLinks,
      skills,
      courseIds: courses,
      coverAssetId: cover.status === 'done' ? cover.asset.assetId : null,
      members: [],
    };

    setPending(true);
    try {
      const response = await fetch('/api/v1/projects', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const error = await errorOf(response);
        if (response.status === 409 && error.code === 'PROJECT_EXISTS') {
          showLinkError(t('linkTaken', { suggestion: nextSlug(slug) }));
          setPending(false);
          return;
        }
        // Server messages are English and technical; the learner always sees the localized message.
        setFailure(t('error'));
        setPending(false);
        return;
      }
      router.push(routes.learner.project(slug, { submitted: 1 }));
    } catch {
      setFailure(t('error'));
      setPending(false);
    }
  }

  const dirty = Boolean(title || summary || otherTitle || otherSummary || skills.length || courses.length || links.length || cover.status !== 'idle' || customSlug);
  useSupportUnsaved(dirty && !pending, t('unsavedConfirm'));
  const coverBusy = cover.status === 'uploading';
  const writtenIn = t('writtenIn', { language: locale });

  return (
    <form className="canvas-page canvas-support-proposal vf-proposal" aria-label={t('title')} onSubmit={submit}>
      <fieldset className="vf-proposal-section">
        <legend className="vf-proposal-legend">{t('sections.idea')}</legend>
        <p id={ids.writtenIn} className="vf-meta">{writtenIn}</p>
        <div className="vf-proposal-field">
          <CanvasTextInput label={t('titleField')} id={ids.title} name="title" required maxLength={TITLE_MAX} value={title} onChange={(value) => { setTitle(value); setLinkError(null); setFieldErrors((current) => ({ ...current, title: false })); }}
            messages={fieldErrors.title ? [{ type: 'error', text: <span id={ids.titleError}>{t('titleRequired')}</span> }] : []} aria-invalid={fieldErrors.title || undefined} aria-describedby={ids.writtenIn} />
        </div>
        <div className="vf-proposal-field">
          <CanvasTextArea label={t('summaryField')} id={ids.summary} name="summary" required rows={4} maxLength={SUMMARY_MAX} value={summary} onChange={(value) => { setSummary(value); setFieldErrors((current) => ({ ...current, summary: false })); }}
            messages={fieldErrors.summary ? [{ type: 'error', text: <span id={ids.summaryError}>{t('summaryRequired')}</span> }] : []} aria-invalid={fieldErrors.summary || undefined} aria-describedby={ids.writtenIn} />
        </div>
        <details className="vf-proposal-disclosure">
          <summary>{t('otherLanguage', { language: other })}</summary>
          <div className="vf-proposal-disclosure-body">
            <div className="vf-proposal-field">
              <CanvasTextInput label={t('otherTitle', { language: other })} id={ids.otherTitle} name="otherTitle" lang={other} maxLength={TITLE_MAX} value={otherTitle} onChange={(value) => setOtherTitle(value)} />
            </div>
            <div className="vf-proposal-field">
              <CanvasTextArea label={t('otherSummary', { language: other })} id={ids.otherSummary} name="otherSummary" lang={other} rows={4} maxLength={SUMMARY_MAX} value={otherSummary} onChange={(value) => setOtherSummary(value)} />
            </div>
          </div>
        </details>
        <div className="vf-proposal-link">
          <div className="vf-proposal-link-row">
            <p id={ids.linkHint} className="vf-meta">{t('linkHint', { slug })}</p>
            {!linkOpen ? (
              <CanvasButton variant="secondary" type="button" className="vf-btn vf-btn-ghost vf-btn-lg" aria-expanded={false} aria-controls={ids.linkEditor} onClick={() => { focusTarget.current = ids.link; setLinkOpen(true); setCustomSlug(slug); }}>
                {t('changeLink')}
              </CanvasButton>
            ) : null}
          </div>
          <div id={ids.linkEditor} hidden={!linkOpen} className="vf-proposal-field">
            <CanvasTextInput label={t('link')}
              id={ids.link}
              name="id"
              value={slug}
              maxLength={64}
              autoCapitalize="none"
              spellCheck={false}
              onChange={(value) => { setCustomSlug(value.toLowerCase()); setLinkError(null); }}
              messages={linkError ? [{ type: 'error', text: <span id={ids.linkError} role="alert">{linkError}</span> }] : []}
              aria-invalid={linkError ? true : undefined}
              aria-describedby={ids.linkHint}
            />
            <p className="vf-meta">{t('linkFormat')}</p>
          </div>
        </div>
      </fieldset>

      <fieldset className="vf-proposal-section">
        <legend className="vf-proposal-legend">{t('sections.connections')}</legend>
        <MultiCombobox
          label={t('skillsField')}
          options={skillOptions.map((option) => ({ ...option, keywords: [option.id] }))}
          value={skills}
          onChange={setSkills}
          searchLabel={t('skillsSearch')}
          emptyText={t('noOptions')}
          removeLabel={(name) => t('removeChip', { name })}
          selectedLabel={t('chipSelected')}
          fallbackLabel={readableProjectId}
        />
        <MultiCombobox
          label={t('coursesField')}
          options={courseOptions.map((option) => ({ ...option, keywords: [option.id] }))}
          value={courses}
          onChange={setCourses}
          searchLabel={t('coursesSearch')}
          emptyText={t('noOptions')}
          removeLabel={(name) => t('removeChip', { name })}
          selectedLabel={t('chipSelected')}
          fallbackLabel={readableProjectId}
        />
      </fieldset>

      <fieldset className="vf-proposal-section">
        <legend className="vf-proposal-legend">{t('sections.media')}</legend>
        <div ref={coverGroup} className="vf-proposal-cover" role="group" aria-labelledby={ids.coverHeading} aria-describedby={ids.coverHelp}>
          <p id={ids.coverHeading} className="vf-proposal-sublabel">{t('coverField')}</p>
          <p id={ids.coverHelp} className="vf-meta">{t('coverHelp')}</p>
          {cover.status === 'done' ? (
            <div className="vf-proposal-cover-frame">
              {/* A local blob preview of the just-uploaded file; next/image cannot optimise blob URLs. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={cover.preview} alt={t('coverPreview')} />
            </div>
          ) : null}
          {cover.status === 'uploading' ? (
            <div className="vf-proposal-cover-status">
              <div role="progressbar" aria-label={t('coverProgress')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={cover.percent} className="vf-proposal-progress">
                <span style={{ width: `${cover.percent}%` }} />
              </div>
              <span className="vf-meta" aria-hidden="true">{t('coverUploading', { percent: cover.percent })}</span>
            </div>
          ) : null}
          {cover.status === 'failed' ? <p role="alert" className="vf-proposal-error">{cover.message}</p> : null}
          {coverProblem ? <p role="alert" className="vf-proposal-error">{coverProblem}</p> : null}
          <div className="vf-proposal-actions-inline">
            {cover.status === 'uploading' ? (
              <CanvasButton variant="secondary" id={ids.coverCancel} type="button" className="vf-btn vf-btn-lg" onClick={() => cover.controller.abort()}>{t('coverCancel')}</CanvasButton>
            ) : (
              <label className="vf-btn vf-btn-lg vf-proposal-file">
                {cover.status === 'done' ? t('coverReplace') : t('coverUpload')}
                <input
                  id={ids.cover}
                  type="file"
                  className="sr-only"
                  accept={PROJECT_COVER_TYPES.join(',')}
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0];
                    event.currentTarget.value = '';
                    if (file) startUpload(file);
                  }}
                />
              </label>
            )}
            {cover.status === 'failed' ? <CanvasButton variant="secondary" type="button" className="vf-btn vf-btn-lg" onClick={() => startUpload(cover.file)}>{t('coverRetry')}</CanvasButton> : null}
            {cover.status === 'done' || cover.status === 'failed' ? <CanvasButton variant="secondary" type="button" className="vf-btn vf-btn-ghost vf-btn-lg" onClick={removeCover}>{t('coverRemove')}</CanvasButton> : null}
          </div>
        </div>

        <div className="vf-proposal-links" role="group" aria-labelledby={`${ids.links}-heading`} aria-describedby={ids.linksHint}>
          <p id={`${ids.links}-heading`} className="vf-proposal-sublabel">{t('linksField')}</p>
          <p id={ids.linksHint} className="vf-meta">{t('linksHint')}</p>
          {links.length ? (
            <ol className="vf-proposal-link-list">
              {links.map((row, index) => {
                const number = index + 1;
                const errorId = `${ids.links}-${row.key}-error`;
                return (
                  <li key={row.key} className="vf-proposal-link-item">
                    <div className="vf-proposal-field">
                      <CanvasTextInput label={t('linkLabel', { number })} id={`${ids.links}-${row.key}-label`} maxLength={LABEL_MAX} value={row.label} onChange={(value) => updateLink(row.key, { label: value })} />
                    </div>
                    <div className="vf-proposal-field">
                      <CanvasTextInput label={t('linkUrl', { number })}
                        id={`${ids.links}-${row.key}-url`}
                        type="url"
                        inputMode="url"
                        placeholder="https://"
                        value={row.url}
                        onChange={(value) => updateLink(row.key, { url: value, error: false })}
                        onBlur={() => checkLink(row)}
                        messages={row.error ? [{ type: 'error', text: <span id={errorId}>{t('linkHttps')}</span> }] : []}
                        aria-invalid={row.error || undefined}
                      />
                    </div>
                    <CanvasButton variant="secondary" type="button" className="vf-btn vf-btn-ghost vf-btn-lg vf-proposal-link-remove" onClick={() => removeLink(row.key)}>
                      <span aria-hidden="true">×</span>
                      <span className="sr-only">{t('removeLink', { number })}</span>
                    </CanvasButton>
                  </li>
                );
              })}
            </ol>
          ) : null}
          <div className="vf-proposal-actions-inline">
            <CanvasButton variant="secondary" id={ids.addLink} type="button" className="vf-btn vf-btn-lg" onClick={addLink} disabled={links.length >= MAX_PROPOSAL_LINKS}>{t('addLink')}</CanvasButton>
            {links.length >= MAX_PROPOSAL_LINKS ? <p className="vf-meta" role="status">{t('linksMax')}</p> : null}
          </div>
        </div>
      </fieldset>

      <div className="vf-proposal-submit">
        <CanvasButton type="submit" className="vf-btn vf-btn-primary vf-btn-lg" disabled={pending || coverBusy}>{pending ? t('submitting') : t('submit')}</CanvasButton>
        <Link href={routes.learner.projects()} className="vf-btn vf-btn-ghost vf-btn-lg">{t('cancel')}</Link>
        {failure ? <p role="alert" className="vf-proposal-error">{failure}</p> : null}
      </div>
    </form>
  );
}
