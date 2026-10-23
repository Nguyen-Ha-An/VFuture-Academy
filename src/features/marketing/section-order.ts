export const MARKETING_SECTIONS = [
  "hero",
  "loop",
  "ecosystem",
  "pathways",
  "how-it-works",
  "featured-courses",
  "opportunities",
  "participation",
  "for-schools",
  "faq",
  "call-to-action",
] as const;

export type MarketingSection = (typeof MARKETING_SECTIONS)[number];
