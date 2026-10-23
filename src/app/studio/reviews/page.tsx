import { getTranslations } from "next-intl/server";
import { ReviewQueue } from "@/features/admin/components/ContentReviewWorkspace";
import { studioReviewsData } from "@/features/studio/home-data";
import { StaffPageHeader } from "@/features/workspace/ui/StaffPageHeader";

export const dynamic = "force-dynamic";

export default async function ReviewsPage() {
  const [data, t] = await Promise.all([studioReviewsData(), getTranslations("cmsAdmin")]);
  return <section className="mx-auto max-w-7xl space-y-6"><StaffPageHeader title={t("reviewsTitle")} description={t("reviewsDescription")} /><ReviewQueue {...data} /></section>;
}
