"use client";

import { useLocale, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import type { AppLocale } from "@/i18n/request";

const ONE_YEAR = 60 * 60 * 24 * 365;

export function localeCookie(locale: AppLocale, secure: boolean) {
  return `locale=${locale}; path=/; max-age=${ONE_YEAR}; samesite=lax${secure ? "; secure" : ""}`;
}

/**
 * Saves the locale on the profile, mirrors it in the `locale` cookie and reloads so server-rendered
 * copy follows. Shared by LocaleSwitcher and the staff user menu.
 */
export function useLocaleChange() {
  const locale = useLocale() as AppLocale;
  const t = useTranslations("locale");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function changeLocale(nextLocale: AppLocale) {
    setError(null);
    startTransition(async () => {
      try {
        const response = await fetch("/api/v1/profile/locale", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale: nextLocale }),
        });
        if (!response.ok) throw new Error('Locale update failed');
        document.cookie = localeCookie(nextLocale, window.location.protocol === "https:");
        window.location.reload();
      } catch {
        setError(t("updateError"));
      }
    });
  }

  return { locale, changeLocale, isPending, error };
}

export function LocaleSwitcher({ variant = "select" }: { variant?: "select" | "links" }) {
  const { locale, changeLocale, isPending, error } = useLocaleChange();
  const searchParams = useSearchParams();
  const t = useTranslations("locale");
  const common = useTranslations("common");

  function localeHref(nextLocale: AppLocale) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("lang", nextLocale);
    return `?${params.toString()}`;
  }

  if (variant === "links") {
    return (
      <nav aria-label={common("language")} className="flex items-center font-mono text-xs tracking-wide uppercase">
        {(["vi", "en"] as const).map((item, index) => (
          <span key={item} className="contents">
            {index > 0 ? <span aria-hidden="true" className="text-border">/</span> : null}
            <a
              href={localeHref(item)}
              hrefLang={item}
              aria-current={locale === item ? "page" : undefined}
              className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-sm px-2 text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring aria-[current=page]:text-primary"
            >
              {t(item)}
            </a>
          </span>
        ))}
      </nav>
    );
  }

  return <div><label className="inline-flex min-h-10 items-center gap-2 text-sm font-medium text-muted-foreground"><span>{common("language")}</span><select aria-label={common("language")} className="min-h-10 rounded-md border border-input bg-background px-2 text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" disabled={isPending} value={locale} onChange={(event) => changeLocale(event.target.value as AppLocale)}><option value="vi">{t("vi")}</option><option value="en">{t("en")}</option></select></label>{error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}</div>;
}
