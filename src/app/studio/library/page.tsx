import { getTranslations } from "next-intl/server";
import { ContentInventory } from "@/features/admin/components/ContentReviewWorkspace";
import { studioLibraryData } from "@/features/studio/home-data";

export const dynamic = "force-dynamic";

export default async function LibraryPage() {
  const [data, t] = await Promise.all([studioLibraryData(), getTranslations("cmsAdmin")]);
  return <section className="mx-auto max-w-7xl space-y-6"><ContentInventory {...data} title={t("title")} description={t("description")} /></section>;
}
