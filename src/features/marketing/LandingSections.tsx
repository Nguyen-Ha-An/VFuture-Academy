import { Fragment } from "react";
import {
  MARKETING_SECTIONS,
  type MarketingSection,
} from "@/features/marketing/section-order";
import {
  type PublicCourse,
  type PublicOpportunity,
} from "@/features/marketing/public-courses";
import { CallToAction } from "@/features/marketing/sections/CallToAction";
import { Faq } from "@/features/marketing/sections/Faq";
import { FeaturedCourses } from "@/features/marketing/sections/FeaturedCourses";
import { EcosystemEntries } from "@/features/marketing/sections/EcosystemEntries";
import { ForSchools } from "@/features/marketing/sections/ForSchools";
import { Hero } from "@/features/marketing/sections/Hero";
import { HowItWorks } from "@/features/marketing/sections/HowItWorks";
import { Loop } from "@/features/marketing/sections/Loop";
import { OpportunitiesTeaser } from "@/features/marketing/sections/OpportunitiesTeaser";
import { Participation } from "@/features/marketing/sections/Participation";
import { Pathways } from "@/features/marketing/sections/Pathways";

export function LandingSections({
  courses,
  opportunities,
  contactEmail,
}: {
  courses: PublicCourse[];
  opportunities: PublicOpportunity[];
  contactEmail?: string;
}) {
  const sections = {
    hero: <Hero />,
    loop: <Loop />,
    ecosystem: <EcosystemEntries />,
    pathways: <Pathways />,
    "how-it-works": <HowItWorks />,
    "featured-courses": <FeaturedCourses courses={courses} />,
    opportunities: <OpportunitiesTeaser opportunities={opportunities} />,
    participation: <Participation />,
    "for-schools": <ForSchools contactEmail={contactEmail} />,
    faq: <Faq />,
    "call-to-action": <CallToAction />,
  } satisfies Record<MarketingSection, React.ReactNode>;

  return (
    <>
      {MARKETING_SECTIONS.map((section) => (
        <Fragment key={section}>{sections[section]}</Fragment>
      ))}
    </>
  );
}
