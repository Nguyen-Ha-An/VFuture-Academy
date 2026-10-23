import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { CourseCard } from "@/features/marketing/CourseCard";
import type { PublicCourse } from "@/features/marketing/public-courses";
import { MarketingSection, SectionHeading } from "@/features/marketing/section-primitives";

export function FeaturedCourses({ courses }: { courses: PublicCourse[] }) {
  const t = useTranslations("marketing.featured");
  if (courses.length === 0) return <section hidden data-marketing-section="featured-courses" />;

  return (
    <MarketingSection section="featured-courses">
      <div className="flex flex-col gap-7 sm:flex-row sm:items-end sm:justify-between">
        <SectionHeading eyebrow={t("eyebrow")} title={t("title")} description={t("description")} />
        <Link
          href="/courses"
          className="inline-flex min-h-11 shrink-0 items-center gap-2 self-start rounded-sm text-sm font-semibold text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring sm:self-auto"
        >
          {t("viewAll")}
          <ArrowRight aria-hidden="true" className="size-4" />
        </Link>
      </div>
      <div className="mt-14 grid gap-x-8 gap-y-14 sm:grid-cols-2 lg:grid-cols-3">
        {courses.slice(0, 6).map((course) => <CourseCard key={course.id} course={course} />)}
      </div>
    </MarketingSection>
  );
}
