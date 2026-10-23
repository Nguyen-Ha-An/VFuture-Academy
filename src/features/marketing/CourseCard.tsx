import { ArrowUpRight, Clock3 } from "lucide-react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/classic";
import { levelMessageKey, pathwayMessageKey } from "@/features/marketing/catalog-labels";
import type { PublicCourse } from "@/features/marketing/public-courses";
import { AnalyticsLink } from "@/features/marketing/AnalyticsLink";
import { publicMediaHref } from "@/features/media/urls";
import { routes } from "@/lib/routes";

export function CourseCard({ course }: { course: PublicCourse }) {
  const t = useTranslations("marketing");
  const coverUrl = course.cover ? "url" in course.cover ? course.cover.url : publicMediaHref(course.cover.assetId) : undefined;
  const skillsLabelId = `course-${course.id}-skills`;
  return (
    <article className="group relative flex h-full flex-col border-t border-border pt-5">
      <div className="relative mb-5 aspect-[16/9] overflow-hidden rounded-sm bg-muted">
        {coverUrl ? (
          <Image
            src={coverUrl}
            unoptimized={Boolean(course.cover && "assetId" in course.cover)}
            alt={course.title}
            width={960}
            height={540}
            sizes="(min-width: 1024px) 30vw, (min-width: 640px) 45vw, 100vw"
            className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.02] motion-reduce:transition-none"
          />
        ) : (
          <div
            data-course-cover-placeholder
            aria-hidden="true"
            className="size-full bg-[linear-gradient(135deg,transparent_0_48%,var(--border)_48%_52%,transparent_52%_100%)] opacity-60"
          />
        )}
      </div>
      <div className="flex items-center justify-between gap-3">
        <Badge className="rounded-sm bg-accent font-mono text-[0.68rem] tracking-wide text-accent-foreground uppercase">
          {t(levelMessageKey(course.level))}
        </Badge>
        {course.estimatedMinutes ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <Clock3 aria-hidden="true" className="size-3.5" />
            {t("featured.minutes", { minutes: course.estimatedMinutes })}
          </span>
        ) : null}
      </div>
      <p className="mt-8 font-mono text-xs tracking-[0.12em] text-primary uppercase">
        {t(pathwayMessageKey(course.pathway))}
      </p>
      <h3 className="mt-3 text-xl font-semibold tracking-[-0.02em] sm:text-2xl">
        <AnalyticsLink
          href={routes.public.course(course.id)}
          eventName="landing.course_card_clicked"
          eventProps={{ courseId: course.id }}
          aria-label={t("featured.open", { course: course.title })}
          className="rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
        >
          <span className="absolute inset-0" aria-hidden="true" />
          {course.title}
        </AnalyticsLink>
      </h3>
      <p className="mt-3 line-clamp-3 text-sm leading-6 text-muted-foreground">{course.summary}</p>
      {course.skills.length ? (
        <>
          <h4 id={skillsLabelId} className="sr-only">{t("featured.skills")}</h4>
          <div className="mt-6 flex flex-wrap gap-2" aria-labelledby={skillsLabelId}>
            {course.skills.slice(0, 3).map((skill) => (
              <span key={skill.id} className="rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground">
                {skill.name}
              </span>
            ))}
          </div>
        </>
      ) : null}
      <ArrowUpRight
        aria-hidden="true"
        className="mt-auto size-5 self-end pt-8 text-primary"
      />
    </article>
  );
}
