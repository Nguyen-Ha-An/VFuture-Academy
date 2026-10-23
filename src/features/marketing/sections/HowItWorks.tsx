import { Award, BookOpenCheck, Route } from "lucide-react";
import { useTranslations } from "next-intl";
import { MarketingSection, SectionHeading } from "@/features/marketing/section-primitives";

const steps = [
  { key: "choose", Icon: Route },
  { key: "practice", Icon: BookOpenCheck },
  { key: "ship", Icon: Award },
] as const;

export function HowItWorks() {
  const t = useTranslations("marketing.howItWorks");
  return (
    <MarketingSection section="how-it-works" className="border-y border-border bg-card">
      <SectionHeading eyebrow={t("eyebrow")} title={t("title")} description={t("description")} />
      <ol className="mt-14 grid gap-10 lg:grid-cols-3 lg:gap-6">
        {steps.map(({ key, Icon }) => (
          <li key={key}>
            <div
              role="img"
              aria-label={t(`steps.${key}.visualLabel`)}
              className="relative flex aspect-[16/9] items-center justify-center overflow-hidden rounded-md border border-border bg-background"
            >
              <div className="absolute inset-x-5 top-5 h-px bg-border" />
              <div className="absolute right-5 bottom-5 left-5 grid grid-cols-3 gap-2" aria-hidden="true">
                <span className="h-1 rounded-full bg-primary" />
                <span className="h-1 rounded-full bg-primary/40" />
                <span className="h-1 rounded-full bg-border" />
              </div>
              <Icon aria-hidden="true" className="size-12 stroke-[1.25] text-primary" />
            </div>
            <p className="mt-6 font-mono text-xs tracking-[0.16em] text-primary uppercase">{t(`steps.${key}.label`)}</p>
            <h3 className="mt-3 text-xl font-semibold tracking-tight">{t(`steps.${key}.title`)}</h3>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">{t(`steps.${key}.body`)}</p>
          </li>
        ))}
      </ol>
    </MarketingSection>
  );
}
