'use client';

import { FormEvent, useState } from 'react';
import { useTranslations } from 'next-intl';

import type { ProfileSettings as ProfileSettingsValue } from '@/features/profile/service';
import { Card, Notice } from '@/features/workspace-ui/ui/primitives';

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

/**
 * The profile "Public profile" card: handle and visibility forms with vf-label labels, vf-btn
 * buttons and a Notice for the saved/failed status (DESIGN D14). A saved handle is broadcast as
 * `profile-handle-saved` so the head meta (ProfileHandle) follows without a refresh.
 */
export function ProfileSettings({ initial }: { initial: ProfileSettingsValue }) {
  const t = useTranslations('profile.settings');
  const [handle, setHandle] = useState(initial.handle ?? '');
  const [profilePublic, setProfilePublic] = useState(initial.profilePublic);
  const [handleState, setHandleState] = useState<SaveState>('idle');
  const [handleError, setHandleError] = useState<'taken' | 'rateLimited' | 'generic' | null>(null);
  const [visibilityState, setVisibilityState] = useState<SaveState>('idle');

  async function saveHandle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setHandleState('saving');
    setHandleError(null);
    try {
      const response = await fetch('/api/v1/profile/handle', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ handle }),
      });
      if (response.ok) {
        setHandleState('saved');
        window.dispatchEvent(new CustomEvent('profile-handle-saved', { detail: { handle } }));
        return;
      }
      setHandleError(response.status === 409 ? 'taken' : response.status === 429 ? 'rateLimited' : 'generic');
      setHandleState('error');
    } catch {
      setHandleError('generic');
      setHandleState('error');
    }
  }

  async function saveVisibility(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setVisibilityState('saving');
    try {
      const response = await fetch('/api/v1/profile/public', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ profilePublic }),
      });
      setVisibilityState(response.ok ? 'saved' : 'error');
    } catch {
      setVisibilityState('error');
    }
  }

  function handleMessage() {
    if (handleError === 'taken') return t('handleTaken');
    if (handleError === 'rateLimited') return t('handleRateLimited');
    return handleState === 'error' ? t('error') : t('saved');
  }

  const status = (state: SaveState, message: string) => state === 'saved'
    ? <Notice label={t('statusLabel')}>{message}</Notice>
    : state === 'error' ? <Notice tone="fault" label={t('errorLabel')}>{message}</Notice> : null;

  return (
    <Card title={t('title')} titleId="profile-settings-heading" className="vf-l-settings">
      <p className="vf-l-prose vf-l-muted">{t('description')}</p>
      <div className="vf-l-settings-forms">
        <form onSubmit={saveHandle} className="vf-l-settings-form">
          <label htmlFor="profile-handle" className="vf-label">{t('handleLabel')}</label>
          <input
            id="profile-handle"
            value={handle}
            onChange={(event) => {
              setHandle(event.target.value);
              setHandleState('idle');
              setHandleError(null);
            }}
            minLength={3}
            maxLength={32}
            pattern="[a-z0-9][a-z0-9_-]{2,31}"
            aria-describedby="profile-handle-hint profile-handle-status"
            aria-invalid={handleState === 'error'}
            required
            autoComplete="off"
            className="vf-l-input"
          />
          <p id="profile-handle-hint" className="vf-meta">{t('handleHint')}</p>
          <div className="vf-l-settings-actions">
            <button type="submit" className="vf-btn vf-btn-primary" disabled={handleState === 'saving'}>{handleState === 'saving' ? t('saving') : t('save')}</button>
          </div>
          <div id="profile-handle-status" aria-live="polite">{status(handleState, handleMessage())}</div>
        </form>
        <form onSubmit={saveVisibility} className="vf-l-settings-form">
          <span className="vf-label">{t('visibilityTitle')}</span>
          <label htmlFor="profile-public" className="vf-l-check">
            <input
              id="profile-public"
              type="checkbox"
              checked={profilePublic}
              onChange={(event) => setProfilePublic(event.target.checked)}
              aria-describedby="profile-public-hint"
            />
            {t('visibilityLabel')}
          </label>
          <p id="profile-public-hint" className="vf-meta">{t('visibilityHint')}</p>
          <div className="vf-l-settings-actions">
            <button type="submit" className="vf-btn vf-btn-primary" disabled={visibilityState === 'saving'}>{visibilityState === 'saving' ? t('saving') : t('save')}</button>
          </div>
          <div aria-live="polite">{status(visibilityState, visibilityState === 'error' ? t('error') : t('saved'))}</div>
        </form>
      </div>
    </Card>
  );
}
