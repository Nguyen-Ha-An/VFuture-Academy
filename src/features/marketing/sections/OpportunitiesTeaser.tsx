import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { PublicOpportunity } from "@/features/marketing/public-courses";
import { MarketingSection, SectionHeading } from "@/features/marketing/section-primitives";
import { routes } from "@/lib/routes";

export function OpportunitiesTeaser({ opportunities }: { opportunities: PublicOpportunity[] }) {
  const t = useTranslations("marketing.opportunities");
  if (opportunities.length === 0) return <section hidden data-marketing-section="opportunities" />;

  return (
    <MarketingSection section="opportunities" className="border-y border-border bg-muted/50">
      <SectionHeading eyebrow={t("eyebrow")} title={t("title")} description={t("description")} />
      <div className="mt-12 grid gap-4 lg:grid-cols-3">
        {opportunities.slice(0, 3).map((opportunity) => {
          return (
            <article key={opportunity.id} className="relative min-h-56 rounded-md border border-border bg-background p-6">
              {opportunity.organization ? <p className="font-mono text-xs tracking-wide text-primary uppercase">{opportunity.organization}</p> : null}
              <h3 className="mt-10 text-xl font-semibold tracking-tight">
                <Link
                  href={routes.public.opportunity(opportunity.id)}
                  aria-label={t("open", { opportunity: opportunity.title })}
                  className="rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
                >
                  <span className="absolute inset-0" aria-hidden="true" />
                  {opportunity.title}
                </Link>
              </h3>
              {opportunity.summary ? <p className="mt-3 line-clamp-2 text-sm leading-6 text-muted-foreground">{opportunity.summary}</p> : null}
              <ArrowUpRight aria-hidden="true" className="absolute right-6 bottom-6 size-4 text-primary" />
            </article>
          );
        })}
      </div>
      <Link href={routes.public.opportunities()} className="mt-8 inline-flex min-h-11 items-center rounded-md border border-border bg-background px-4 text-sm font-semibold hover:bg-muted">{t('viewAll')}</Link>
    </MarketingSection>
  );
}
