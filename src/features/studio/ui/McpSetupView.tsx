'use client';

import { Check, Copy } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { StaffPageHeader } from '@/features/workspace/ui/StaffPageHeader';

export type McpSetupState =
  | { kind: 'enabled' | 'disabled'; endpoint: string }
  | { kind: 'restricted' | 'unavailable' };

export function McpSetupView({ state }: { state: McpSetupState }) {
  const t = useTranslations('staffUi.studio.mcp');
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const enabled = state.kind === 'enabled';

  async function copyEndpoint(endpoint: string) {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(endpoint);
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <StaffPageHeader title={t('title')} description={t('description')} />

      <section aria-label={t('availability.label')} className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card px-6 py-4">
        <Badge variant={enabled ? 'success' : 'neutral'}>{t(`availability.${state.kind}`)}</Badge>
        <p className="text-sm leading-normal text-muted-foreground">{t(`availability.${state.kind}Description`)}</p>
      </section>

      {'endpoint' in state ? (
        <Card role="region" aria-labelledby="mcp-server-url" className="gap-4">
          <CardHeader>
            <h2 id="mcp-server-url" className="text-sm font-medium leading-normal">{t('server.title')}</h2>
            <p className="text-sm leading-normal text-muted-foreground">{t('server.description')}</p>
          </CardHeader>
          <CardContent className="flex min-w-0 flex-wrap items-center gap-3">
            <label htmlFor="mcp-endpoint" className="sr-only">{t('server.urlLabel')}</label>
            <input
              id="mcp-endpoint"
              readOnly
              value={state.endpoint}
              onFocus={(event) => event.currentTarget.select()}
              className="h-9 min-w-0 w-full flex-1 rounded-md border border-input bg-background px-3 text-sm leading-normal outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background [@media(pointer:coarse)]:min-h-11"
            />
            {enabled ? (
              <Button variant="outline" className="[@media(pointer:coarse)]:min-h-11" onClick={() => void copyEndpoint(state.endpoint)} aria-label={t('server.copy')}>
                {copyState === 'copied' ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
                {t('server.copyShort')}
              </Button>
            ) : null}
          </CardContent>
          {copyState !== 'idle' ? (
            <p className="px-6 text-sm leading-normal" role={copyState === 'failed' ? 'alert' : 'status'}>
              {t(copyState === 'copied' ? 'server.copied' : 'server.copyFailed')}
            </p>
          ) : null}
        </Card>
      ) : null}

      {enabled ? (
        <>
          <Card role="region" aria-labelledby="mcp-connect" className="gap-4">
            <CardHeader>
              <h2 id="mcp-connect" className="text-sm font-medium leading-normal">{t('connect.title')}</h2>
              <p className="text-sm leading-normal text-muted-foreground">{t('connect.description')}</p>
            </CardHeader>
            <CardContent>
              <ul className="divide-y divide-border text-sm leading-normal">
                <li className="grid gap-1 py-3 first:pt-0 sm:grid-cols-[12rem_minmax(0,1fr)] sm:gap-4">
                  <strong className="font-medium">{t('connect.claude')}</strong>
                  <span className="text-muted-foreground">{t('connect.claudeStep')}</span>
                </li>
                <li className="grid gap-1 py-3 sm:grid-cols-[12rem_minmax(0,1fr)] sm:gap-4">
                  <strong className="font-medium">{t('connect.claudeCode')}</strong>
                  <div className="min-w-0 space-y-2">
                    <p className="text-muted-foreground">{t('connect.claudeCodeStep')}</p>
                    <label htmlFor="mcp-claude-command" className="sr-only">{t('connect.claudeCodeCommand')}</label>
                    <textarea
                      id="mcp-claude-command"
                      readOnly
                      rows={3}
                      value={`claude mcp add --transport http vfuture-studio ${state.endpoint}`}
                      onFocus={(event) => event.currentTarget.select()}
                      className="min-w-0 w-full resize-none break-all rounded-md border border-input bg-background px-3 py-2 text-sm leading-normal outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                    />
                  </div>
                </li>
                <li className="grid gap-1 py-3 last:pb-0 sm:grid-cols-[12rem_minmax(0,1fr)] sm:gap-4">
                  <strong className="font-medium">{t('connect.chatgpt')}</strong>
                  <span className="text-muted-foreground">{t('connect.chatgptStep')}</span>
                </li>
              </ul>
            </CardContent>
          </Card>
          <Card role="region" aria-labelledby="mcp-before-connect" className="gap-3">
            <CardHeader>
              <h2 id="mcp-before-connect" className="text-sm font-medium leading-normal">{t('before.title')}</h2>
            </CardHeader>
            <CardContent className="space-y-2 text-sm leading-normal text-muted-foreground">
              <p>{t('before.signIn')}</p>
              <p>{t('before.content')}</p>
              <p>{t('before.token')}</p>
              <p>{t('before.workflow')}</p>
            </CardContent>
          </Card>
        </>
      ) : null}

      <section className="space-y-2 rounded-lg border border-border bg-card p-6" aria-labelledby="mcp-manage-connections">
        <h2 id="mcp-manage-connections" className="text-sm font-medium leading-normal">{t('manage.title')}</h2>
        <p className="text-sm leading-normal text-muted-foreground">{t('manage.description')}</p>
        <Link href="/account/connected-apps" className="inline-flex min-h-11 items-center text-sm font-medium leading-normal underline underline-offset-4 focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {t('manage.link')}
        </Link>
      </section>
    </div>
  );
}
