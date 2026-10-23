import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { MarketingSection, SectionHeading } from "@/features/marketing/section-primitives";

const questions = ["who", "cost", "languages", "certificates", "exams"] as const;

export function Faq() {
  const t = useTranslations("marketing.faq");
  return (
    <MarketingSection section="faq">
      <div className="grid gap-14 lg:grid-cols-[0.75fr_1.25fr] lg:gap-24">
        <SectionHeading eyebrow={t("eyebrow")} title={t("title")} />
        <div className="border-t border-border">
          {questions.map((question) => (
            <details key={question} className="group border-b border-border py-1">
              <summary className="flex min-h-16 cursor-pointer list-none items-center justify-between gap-5 rounded-sm py-4 text-left font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
                {t(`items.${question}.question`)}
                <Plus aria-hidden="true" className="size-4 shrink-0 text-primary transition-transform group-open:rotate-45 motion-reduce:transition-none" />
              </summary>
              <p className="max-w-2xl pb-6 pr-10 text-sm leading-7 text-muted-foreground">{t(`items.${question}.answer`)}</p>
            </details>
          ))}
        </div>
      </div>
    </MarketingSection>
  );
}
