"use client";

import { useTranslations } from "next-intl";

import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { StaffPageHeader } from "@/features/workspace/ui/StaffPageHeader";

export default function AdminLoading() {
  const t = useTranslations("staffUi.admin.boundary.loading");

  return (
    <section role="status" aria-live="polite" className="space-y-6">
      <StaffPageHeader title={t("title")} description={t("status")} />
      <div aria-hidden="true" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((index) => (
          <Card key={index}>
            <CardContent className="space-y-4">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-8 w-1/3" />
            </CardContent>
          </Card>
        ))}
      </div>
      <Card aria-hidden="true">
        <CardContent className="space-y-4">
          <Skeleton className="h-4 w-1/4" />
          <Skeleton className="h-48 w-full" />
        </CardContent>
      </Card>
    </section>
  );
}
