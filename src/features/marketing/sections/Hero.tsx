import { ArrowRight, Boxes, CircleDotDashed, Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";
import { AnalyticsLink } from "@/features/marketing/AnalyticsLink";
import {
  MarketingSection,
  primaryLinkClass,
  secondaryLinkClass,
} from "@/features/marketing/section-primitives";

export function Hero() {
  const t = useTranslations("marketing.hero");
  return (
    <MarketingSection section="hero" className="overflow-hidden pt-16 sm:pt-24 lg:pt-32">
      <div className="grid items-end gap-14 lg:grid-cols-[minmax(0,1.45fr)_minmax(19rem,0.55fr)] lg:gap-20">
        <div>
          <p className="font-mono text-xs font-medium tracking-[0.2em] text-primary uppercase">
            {t("eyebrow")}
          </p>
          <h1 className="mt-6 max-w-5xl text-balance text-4xl font-semibold leading-[1.06] tracking-[-0.055em] sm:text-6xl lg:text-7xl">
            {t("headline")}
          </h1>
          <p className="mt-7 max-w-2xl text-pretty text-lg leading-8 text-muted-foreground sm:text-xl">
            {t("subline")}
          </p>
          <div className="mt-9 flex flex-col gap-3 sm:flex-row">
            <AnalyticsLink
              href="/signup"
              eventName="landing.cta_clicked"
              eventProps={{ cta: "hero-primary" }}
              className={primaryLinkClass}
            >
              {t("primaryCta")}
              <ArrowRight aria-hidden="true" className="size-4" />
            </AnalyticsLink>
            <AnalyticsLink
              href="/courses"
              eventName="landing.cta_clicked"
              eventProps={{ cta: "hero-secondary" }}
              className={secondaryLinkClass}
            >
              {t("secondaryCta")}
            </AnalyticsLink>
          </div>
        </div>

        <aside className="relative border-l border-primary/40 pl-6 sm:pl-8" aria-label={t("signalTitle")}>
          <div className="absolute -left-1.5 top-0 size-3 rounded-full bg-primary" />
          <p className="font-mono text-xs tracking-[0.18em] text-primary uppercase">{t("signalLabel")}</p>
          <h2 className="mt-4 text-2xl font-semibold tracking-tight">{t("signalTitle")}</h2>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">{t("signalBody")}</p>
          <div className="mt-7 grid grid-cols-3 gap-2 text-primary" aria-hidden="true">
            <CircleDotDashed className="size-6" />
            <Sparkles className="size-6" />
            <Boxes className="size-6" />
          </div>
        </aside>
      </div>
      <div className="mt-20 flex flex-wrap items-center gap-x-6 gap-y-3 border-y border-border py-5 text-sm text-muted-foreground">
        <span>{t("trust")}</span>
        {(["vinsmc", "ans", "dewey"] as const).map((partner) => (
          <span key={partner} className="font-mono text-xs tracking-[0.12em] text-foreground uppercase">
            {t(`partners.${partner}`)}
          </span>
        ))}
      </div>
    </MarketingSection>
  );
}
