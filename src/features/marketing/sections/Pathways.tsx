import { ArrowUpRight, Banknote, BrainCircuit, FlaskConical, Lightbulb, Network } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { PATHWAYS } from "@/content-engine";
import { MarketingSection, SectionHeading } from "@/features/marketing/section-primitives";

const pathwayDetails = {
  "ai-emerging-technology": { key: "aiEmergingTechnology", Icon: BrainCircuit },
  "research-innovation": { key: "researchInnovation", Icon: FlaskConical },
  "entrepreneurship-product": { key: "entrepreneurshipProduct", Icon: Lightbulb },
  "fintech-economics": { key: "fintechEconomics", Icon: Banknote },
  "core-future-skills": { key: "coreFutureSkills", Icon: Network },
} as const;

export function Pathways() {
  const t = useTranslations("marketing.pathways");
  return (
    <MarketingSection section="pathways">
      <SectionHeading eyebrow={t("eyebrow")} title={t("title")} description={t("description")} />
      <div className="mt-14 grid border-t border-l border-border sm:grid-cols-2 lg:grid-cols-5">
        {PATHWAYS.map((pathway, index) => {
          const { key, Icon } = pathwayDetails[pathway];
          const name = t(`items.${key}.name`);
          return (
            <Link
              key={pathway}
              href={`/courses?pathway=${pathway}`}
              aria-label={t("open", { pathway: name })}
              className="group relative min-h-72 border-r border-b border-border p-5 transition-colors hover:bg-muted focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring"
            >
              <div className="flex items-start justify-between">
                <span className="font-mono text-xs text-muted-foreground">{String(index + 1).padStart(2, "0")}</span>
                <Icon aria-hidden="true" className="size-5 text-primary" />
              </div>
              <h3 className="mt-20 text-lg font-semibold tracking-tight">{name}</h3>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">{t(`items.${key}.promise`)}</p>
              <ArrowUpRight aria-hidden="true" className="absolute right-5 bottom-5 size-4 text-primary" />
            </Link>
          );
        })}
      </div>
    </MarketingSection>
  );
}
