import { useTranslations } from "next-intl";
import { MarketingSection } from "@/features/marketing/section-primitives";

const items = ["learn", "connect", "build", "share"] as const;

export function Loop() {
  const t = useTranslations("marketing.loop");
  return (
    <MarketingSection section="loop" className="bg-foreground text-background">
      <div className="grid gap-14 lg:grid-cols-[0.8fr_1.2fr] lg:gap-24">
        <div className="max-w-3xl">
          <p className="font-mono text-xs font-medium tracking-[0.2em] text-primary-foreground/75 uppercase">{t("eyebrow")}</p>
          <h2 className="mt-4 text-balance text-3xl font-semibold tracking-[-0.035em] sm:text-4xl lg:text-5xl">{t("title")}</h2>
          <p className="mt-5 max-w-2xl text-pretty text-base leading-7 text-background/75 sm:text-lg">{t("description")}</p>
        </div>
        <ol className="border-t border-background/25">
          {items.map((item, index) => (
            <li key={item} className="grid grid-cols-[3rem_1fr] gap-4 border-b border-background/25 py-6 sm:grid-cols-[4rem_10rem_1fr] sm:items-baseline">
              <span className="font-mono text-xs text-primary-foreground/70">{String(index + 1).padStart(2, "0")}</span>
              <h3 className="text-xl font-semibold">{t(`items.${item}.title`)}</h3>
              <p className="col-start-2 text-sm leading-6 text-background/70 sm:col-start-auto">{t(`items.${item}.body`)}</p>
            </li>
          ))}
        </ol>
      </div>
    </MarketingSection>
  );
}
