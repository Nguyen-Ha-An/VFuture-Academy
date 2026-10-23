"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Fragment } from "react";
import { breadcrumbTrail } from "@/components/ShellPrimitives";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { cn } from "@/lib/ui-cn";
import type { StaffNavigation } from "../navigation";

type Crumb = { label: string; href: string };

/**
 * Top-bar trail: owning nav item, labelled child section, then readable path segments
 * (ShellPrimitives' `breadcrumbTrail`). The last crumb shows the record title the page
 * registered through StaffTitleContext, so detail pages never show a raw ID. Below `md`
 * only the last crumb is visible.
 */
export function StaffBreadcrumbs({ pathname, navigation, currentTitle }: { pathname: string; navigation: StaffNavigation; currentTitle?: string }) {
  const common = useTranslations("common");
  const items = navigation.groups.flatMap((group) => group.items.map((item) => ({ ...item, matches: item.sections })));
  const trail = breadcrumbTrail(pathname, items);
  if (!trail) return null;
  const crumbs: Crumb[] = [{ label: trail.parent.label, href: trail.parent.href }, ...trail.crumbs];
  const last = crumbs.length - 1;
  return (
    <Breadcrumb aria-label={common("breadcrumbs")} className="min-w-0">
      <BreadcrumbList className="flex-nowrap gap-1.5 leading-[1.4] sm:gap-2">
        {crumbs.map((crumb, index) => {
          const current = index === last;
          return (
            <Fragment key={crumb.href}>
              {index > 0 ? <BreadcrumbSeparator className="hidden md:inline-flex" /> : null}
              <BreadcrumbItem className={cn(!current && "hidden md:inline-flex", current && "min-w-0")}>
                {current ? (
                  <BreadcrumbPage className={cn("max-w-[16rem] font-medium md:max-w-[24rem]", index > 0 && !currentTitle && "capitalize")}>{index > 0 && currentTitle ? currentTitle : crumb.label}</BreadcrumbPage>
                ) : (
                  <BreadcrumbLink asChild className={cn("max-w-[12rem] truncate", index > 0 && "capitalize")}>
                    <Link href={crumb.href}>{crumb.label}</Link>
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
            </Fragment>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
