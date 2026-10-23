'use client';
/* eslint-disable @next/next/no-img-element -- authenticated media redirects are intentionally unoptimized. */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

import { Card, Notice } from '@/features/workspace-ui/ui/primitives';

/** The profile Account card: photo, display name and language (DESIGN D14: vf-btn, Notice). */
export function ProfileSettings({
  displayName,
  locale,
  initialAvatarUrl,
}: {
  displayName: string;
  locale: 'vi' | 'en';
  initialAvatarUrl: string | null;
}) {
  const t = useTranslations('learner.profile');
  const focus = useTranslations('learner.focus');
  const settings = useTranslations('profile.settings');
  const languages = useTranslations('learner.enums.language');
  const router = useRouter();
  const [avatarUrl, setAvatarUrl] = useState(initialAvatarUrl);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setAvatarUrl(initialAvatarUrl), [initialAvatarUrl]);

  const uploadAvatar = async (file: File) => {
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.set('purpose', 'avatar');
      form.set('file', file);
      const response = await fetch('/api/v1/uploads', { method: 'POST', body: form });
      const body = await response.json() as { data?: { url?: string } };
      if (!response.ok || typeof body.data?.url !== 'string') throw new Error('avatar upload failed');
      setAvatarUrl(body.data.url);
      router.refresh();
    } catch {
      setError(t('uploadError'));
    } finally {
      setUploading(false);
    }
  };

  return (
    <Card title={focus('account')} titleId="profile-account-heading" className="vf-l-settings">
      <div className="vf-l-account">
        <div className="vf-l-account-photo">
          {avatarUrl ? <img src={avatarUrl} alt="" className="vf-l-avatar" /> : <div aria-hidden="true" className="vf-l-avatar" data-initial="">{displayName.slice(0, 1).toUpperCase()}</div>}
          <label className="vf-btn vf-l-upload" aria-disabled={uploading || undefined}>
            {uploading ? t('uploading') : t('changeAvatar')}
            <input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" disabled={uploading} onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              if (file) void uploadAvatar(file);
            }} />
          </label>
        </div>
        <dl className="vf-l-account-fields">
          <div><dt className="vf-label">{t('displayName')}</dt><dd>{displayName}</dd></div>
          <div><dt className="vf-label">{t('locale')}</dt><dd>{languages(locale)}</dd></div>
        </dl>
      </div>
      {error ? <Notice tone="fault" label={settings('errorLabel')}>{error}</Notice> : null}
    </Card>
  );
}
