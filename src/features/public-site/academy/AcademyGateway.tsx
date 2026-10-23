import { ArrowRight, ArrowUpRight, BookOpen, CircleCheck } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import type { PATHWAYS } from "@/content-engine";
import { AcademyExplorer } from "./AcademyExplorer";
import { PublicLink } from "@/features/public-site/PublicNavigation";
import { PublicStickyAction } from "@/features/public-site/PublicStickyAction";
import { learningCopy } from "@/features/public-site/public-learning-copy";
import "./academy-gateway.css";

const workflow = ["choose", "practice", "ship"] as const;
const questions = ["who", "cost", "languages", "certificates", "exams"] as const;

export function AcademyGateway({ fields }: { fields: typeof PATHWAYS }) {
  const locale = useLocale() === "en" ? "en" : "vi";
  const copy = learningCopy[locale];
  const t = useTranslations("academyGateway");
  const pathwaysT = useTranslations("marketing.pathways");
  const faqT = useTranslations("marketing.faq");

  return (
    <div className="academy-gateway">
      <section data-public-header className="academy-hero" aria-labelledby="academy-title">
        <div className="academy-shell-container academy-hero__grid">
          <div className="academy-hero__copy">
            <p className="academy-shell-kicker">{t("hero.eyebrow")}</p>
            <h1 id="academy-title" className="academy-hero__title" aria-label={`${t("hero.titleLead")} ${t("hero.titleEmphasis")}`}>
              {t("hero.titleLead")}{" "}<span>{t("hero.titleEmphasis")}</span>
            </h1>
            <p className="academy-shell-section-copy academy-hero__description">{t("hero.description")}</p>
            <div className="academy-hero__actions">
              <PublicLink
                id="academy-primary-action"
                className="academy-shell-button"
                href="/courses"
                analytics={{ name: "landing.cta_clicked", props: { surface: "academy", cta: "hero-browse-courses" } }}
              >
                <BookOpen aria-hidden="true" size={17} />
                {t("hero.browseCourses")}
              </PublicLink>
              <PublicLink
                className="academy-shell-button academy-shell-button--secondary"
                href="/login"
                analytics={{ name: "landing.cta_clicked", props: { surface: "academy", cta: "hero-sign-in" } }}
              >
                {t("hero.signIn")}
                <ArrowRight aria-hidden="true" size={17} />
              </PublicLink>
            </div>
            <p className="academy-hero__account">
              {t("hero.accountPrompt")} <PublicLink href="/signup" analytics={{ name: "landing.cta_clicked", props: { surface: "academy", cta: "hero-create-account" } }}>{t("hero.createAccount")}</PublicLink>
            </p>
          </div>

          <div className="academy-hero__plan" role="group" aria-label={t("hero.diagramLabel")}>
            <div className="academy-plan__header">
              <span className="academy-plan__mark" aria-hidden="true">↗</span>
              <span>{t("hero.diagramEyebrow")}</span>
            </div>
            <div className="academy-plan__line" aria-hidden="true" />
            {workflow.map((step, index) => (
              <div className="academy-plan__step" key={step}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <strong>{t(`workflow.${step}.title`)}</strong>
                <i aria-hidden="true" />
              </div>
            ))}
            <p>{t("hero.diagramNote")}</p>
          </div>
        </div>
      </section>

      <section data-public-reveal className="academy-section academy-pathways" aria-labelledby="academy-pathways-title">
        <div className="academy-shell-container">
          <div className="academy-section__heading">
            <div>
              <p className="academy-shell-kicker">{pathwaysT("eyebrow")}</p>
              <h2 id="academy-pathways-title" className="academy-shell-section-title">{pathwaysT("title")}</h2>
            </div>
            <p className="academy-shell-section-copy">{pathwaysT("description")}</p>
          </div>
          <AcademyExplorer fields={fields} />
        </div>
      </section>

      <section data-public-reveal className="academy-section academy-workflow" aria-labelledby="academy-workflow-title">
        <div className="academy-shell-container academy-workflow__grid">
          <div className="academy-workflow__intro">
            <p className="academy-shell-kicker">{t("workflow.eyebrow")}</p>
            <h2 id="academy-workflow-title" className="academy-shell-section-title">{t("workflow.heading")}</h2>
            <p className="academy-shell-section-copy">{t("workflow.description")}</p>
          </div>
          <ol className="academy-workflow__steps">
            {workflow.map((step, index) => (
              <li key={step}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <div>
                  <h3>{t(`workflow.${step}.title`)}</h3>
                  <p>{t(`workflow.${step}.description`)}</p>
                </div>
                <CircleCheck aria-hidden="true" size={18} />
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="academy-section academy-next" aria-labelledby="academy-next-title" data-public-reveal>
        <div className="academy-shell-container">
          <p className="academy-shell-kicker">{copy.nextEyebrow}</p>
          <h2 id="academy-next-title" className="academy-shell-section-title">{copy.nextTitle}</h2>
          <div className="academy-next__links">
            <PublicLink href="/projects"><span className="academy-next__number" aria-hidden="true">01</span><div><h3>{copy.projectsTitle}</h3><p>{copy.projectsDescription}</p></div><ArrowUpRight size={23} aria-hidden="true" /></PublicLink>
            <PublicLink href="/resources"><span className="academy-next__number" aria-hidden="true">02</span><div><h3>{copy.resourcesTitle}</h3><p>{copy.resourcesDescription}</p></div><ArrowUpRight size={23} aria-hidden="true" /></PublicLink>
          </div>
        </div>
      </section>

      <section data-public-reveal className="academy-section academy-faq" aria-labelledby="academy-faq-title">
        <div className="academy-shell-container academy-faq__grid">
          <div>
            <p className="academy-shell-kicker">{faqT("eyebrow")}</p>
            <h2 id="academy-faq-title" className="academy-shell-section-title">{faqT("title")}</h2>
          </div>
          <div className="academy-faq__items">
            {questions.map((question) => (
              <details key={question}>
                <summary>
                  {faqT(`items.${question}.question`)}
                  <span aria-hidden="true">+</span>
                </summary>
                <p>{faqT(`items.${question}.answer`)}</p>
              </details>
            ))}
          </div>
        </div>
      </section>
      <PublicStickyAction targetId="academy-primary-action" href="/courses">{t("hero.browseCourses")}</PublicStickyAction>
    </div>
  );
}
