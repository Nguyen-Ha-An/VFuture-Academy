"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { StaffPageHeader } from "@/features/workspace/ui/StaffPageHeader";
import { routes } from "@/lib/routes";

/** This boundary renders inside the workspace's existing main landmark. */
export function AdminForbidden() {
  const t = useTranslations("staffUi.admin.boundary.forbidden");

  return (
    <div className="mx-auto grid min-h-[60vh] w-full max-w-2xl content-center py-8">
      <Card>
        <CardContent>
          <StaffPageHeader eyebrow={t("code")} title={t("title")} description={t("description")} />
          <Button asChild className="min-h-11">
            <Link href={routes.learner.dashboard()}>{t("back")}</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
