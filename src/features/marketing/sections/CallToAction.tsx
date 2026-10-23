import { ArrowRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { AnalyticsLink } from "@/features/marketing/AnalyticsLink";
import { MarketingSection, secondaryLinkClass } from "@/features/marketing/section-primitives";

export function CallToAction() {
  const t = useTranslations("marketing.callToAction");
  return (
    <MarketingSection section="call-to-action" className="pb-28 pt-10 sm:pb-36">
      <div className="relative overflow-hidden rounded-md bg-primary px-6 py-16 text-primary-foreground sm:px-12 sm:py-20 lg:px-20">
        <div className="absolute -right-12 -bottom-28 size-64 rounded-full border border-primary-foreground/20" aria-hidden="true" />
        <div className="absolute right-12 -bottom-24 size-48 rounded-full border border-primary-foreground/20" aria-hidden="true" />
        <p className="font-mono text-xs tracking-[0.2em] text-primary-foreground uppercase">{t("eyebrow")}</p>
        <h2 className="mt-5 max-w-4xl text-balance text-3xl font-semibold tracking-[-0.04em] sm:text-5xl">{t("title")}</h2>
        <p className="mt-6 max-w-2xl text-base leading-7 text-primary-foreground/80 sm:text-lg">{t("description")}</p>
        <div className="relative mt-9 flex flex-col gap-3 sm:flex-row">
          <AnalyticsLink
            href="/signup"
            eventName="landing.cta_clicked"
            eventProps={{ cta: "final-primary" }}
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-md bg-primary-foreground px-5 py-3 text-sm font-semibold text-primary shadow-sm transition-colors hover:bg-primary-foreground/90 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary-foreground"
          >
            {t("primary")}
            <ArrowRight aria-hidden="true" className="size-4" />
          </AnalyticsLink>
          <AnalyticsLink
            href="/courses"
            eventName="landing.cta_clicked"
            eventProps={{ cta: "final-secondary" }}
            className={`${secondaryLinkClass} border-primary-foreground/35 bg-transparent text-primary-foreground hover:bg-primary-foreground/10`}
          >
            {t("secondary")}
          </AnalyticsLink>
        </div>
      </div>
    </MarketingSection>
  );
}
