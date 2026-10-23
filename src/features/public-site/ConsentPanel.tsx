'use client';

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useLocale } from 'next-intl';
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogTitle,
} from '@/components/ui/classic';
import {
  getAnalyticsConsent, getServerAnalyticsConsent, setAnalyticsConsent, subscribeAnalyticsConsent,
} from '@/lib/analytics-consent-client';
import { consentCopy } from './consent-copy';
import './consent.css';

const OPEN_PREFERENCES_EVENT = 'vf:cookie-preferences';
const subscribeHydration = () => () => {};
const hydratedSnapshot = () => true;
const serverHydratedSnapshot = () => false;

export function CookiePreferencesButton({ children }: { children?: ReactNode }) {
  const locale = useLocale() === 'en' ? 'en' : 'vi';
  return (
    <button type="button" className="consent-preferences-button" data-cookie-preferences-trigger onClick={(event) => {
      window.dispatchEvent(new CustomEvent(OPEN_PREFERENCES_EVENT, { detail: event.currentTarget }));
    }}>
      {children ?? consentCopy[locale].preferences}
    </button>
  );
}

export function CookieConsent() {
  const locale = useLocale() === 'en' ? 'en' : 'vi';
  const copy = consentCopy[locale];
  const hydrated = useSyncExternalStore(subscribeHydration, hydratedSnapshot, serverHydratedSnapshot);
  const consent = useSyncExternalStore(subscribeAnalyticsConsent, getAnalyticsConsent, getServerAnalyticsConsent);
  const [open, setOpen] = useState(false);
  const [analytics, setAnalytics] = useState(false);
  const [failed, setFailed] = useState(false);
  const opener = useRef<HTMLElement | null>(null);
  const manageButton = useRef<HTMLButtonElement | null>(null);
  const focusTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    function showPreferences(event: Event) {
      const source = (event as CustomEvent<unknown>).detail;
      opener.current = source instanceof HTMLElement ? source : null;
      setAnalytics(getAnalyticsConsent() === 'granted');
      setFailed(false);
      setOpen(true);
    }
    window.addEventListener(OPEN_PREFERENCES_EVENT, showPreferences);
    return () => {
      window.removeEventListener(OPEN_PREFERENCES_EVENT, showPreferences);
      if (focusTimer.current !== undefined) clearTimeout(focusTimer.current);
    };
  }, []);

  function choose(value: 'granted' | 'denied') {
    const saved = setAnalyticsConsent(value);
    setAnalytics(saved && value === 'granted');
    setFailed(!saved);
    setOpen(!saved);
  }

  return (
    <>
      <noscript><p className="consent-noscript">{copy.noScript} <a href={locale === 'en' ? '/privacy?lang=en' : '/privacy'}>{copy.privacy}</a></p></noscript>
      {hydrated && consent === 'unknown' && !open && (
        <section className="consent-banner" aria-labelledby="consent-banner-title" data-consent-open="true">
          <div className="consent-banner__copy">
            <h2 id="consent-banner-title">{copy.title}</h2>
            <p>{copy.summary} <a href={locale === 'en' ? '/privacy?lang=en' : '/privacy'}>{copy.privacy}</a></p>
          </div>
          <div className="consent-actions">
            <button className="consent-button" type="button" onClick={() => choose('granted')}>{copy.accept}</button>
            <button className="consent-button" type="button" onClick={() => choose('denied')}>{copy.reject}</button>
            <button ref={manageButton} className="consent-button" type="button" onClick={(event) => {
              opener.current = event.currentTarget;
              setAnalytics(false);
              setOpen(true);
            }}>{copy.manage}</button>
          </div>
          {failed && <p className="consent-error" role="status">{copy.failed}</p>}
        </section>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogPortal>
          <DialogOverlay className="consent-overlay" />
          <DialogContent className="consent-dialog" data-consent-open="true" onCloseAutoFocus={(event) => {
            event.preventDefault();
            // The banner trigger is replaced while the dialog is open. Resolve its
            // current node after the closing state commits, then fall back to the footer.
            if (focusTimer.current !== undefined) clearTimeout(focusTimer.current);
            focusTimer.current = setTimeout(() => {
              const target = opener.current?.isConnected ? opener.current
                : manageButton.current ?? document.querySelector<HTMLElement>('[data-cookie-preferences-trigger]');
              target?.focus();
            }, 0);
          }}>
            <div className="consent-dialog__heading">
              <DialogTitle>{copy.preferences}</DialogTitle>
              <DialogClose className="consent-close" aria-label={copy.close}>×</DialogClose>
            </div>
            <DialogDescription>{copy.description}</DialogDescription>
            <div className="consent-option">
              <h3>{copy.essential} <span>{copy.always}</span></h3>
              <p>{copy.essentialDescription}</p>
            </div>
            <div className="consent-option">
              <label className="consent-toggle">
                <input type="checkbox" checked={analytics} onChange={(event) => setAnalytics(event.currentTarget.checked)} aria-describedby="consent-analytics-description" />
                <span>{copy.analytics}</span>
              </label>
              <p id="consent-analytics-description">{copy.analyticsDescription}</p>
            </div>
            <p className="consent-detail">{copy.storage}</p>
            <p className="consent-detail">{copy.operational}</p>
            <a className="consent-policy" href={locale === 'en' ? '/privacy?lang=en' : '/privacy'}>{copy.privacy}</a>
            <div className="consent-actions">
              <button className="consent-button" type="button" onClick={() => choose(analytics ? 'granted' : 'denied')}>{copy.save}</button>
              <button className="consent-button" type="button" onClick={() => choose('denied')}>{copy.reject}</button>
            </div>
            {failed && <p className="consent-error" role="status">{copy.failed}</p>}
          </DialogContent>
        </DialogPortal>
      </Dialog>
    </>
  );
}
