import { Mail } from "lucide-react";
import { useTranslations } from "next-intl";
import { MarketingSection, primaryLinkClass } from "@/features/marketing/section-primitives";

export function ForSchools({ contactEmail }: { contactEmail?: string }) {
  const t = useTranslations("marketing.forSchools");
  return (
    <MarketingSection section="for-schools" id="for-schools">
      <div className="grid gap-12 rounded-md border border-border bg-card p-7 sm:p-10 lg:grid-cols-[1.15fr_0.85fr] lg:gap-20 lg:p-14">
        <div>
          <p className="font-mono text-xs font-medium tracking-[0.2em] text-primary uppercase">{t("eyebrow")}</p>
          <h2 className="mt-5 max-w-3xl text-balance text-3xl font-semibold tracking-[-0.035em] sm:text-4xl lg:text-5xl">{t("title")}</h2>
        </div>
        <div className="lg:pt-8">
          <p className="text-base leading-7 text-muted-foreground sm:text-lg">{t("description")}</p>
          {contactEmail ? (
            <a href={`mailto:${contactEmail}`} className={`${primaryLinkClass} mt-7`}>
              <Mail aria-hidden="true" className="size-4" />
              {t("cta")}
            </a>
          ) : null}
        </div>
        <div className="border-t border-border pt-7 lg:col-span-2" aria-labelledby="school-partners-heading">
          <h3 id="school-partners-heading" className="sr-only">{t("logosLabel")}</h3>
          <div className="grid grid-cols-3 gap-3 text-center font-mono text-xs tracking-[0.12em] text-muted-foreground uppercase sm:max-w-xl sm:text-sm">
            {(["vinsmc", "ans", "dewey"] as const).map((partner) => <span key={partner}>{t(`partners.${partner}`)}</span>)}
          </div>
        </div>
      </div>
    </MarketingSection>
  );
}
