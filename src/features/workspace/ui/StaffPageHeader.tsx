"use client";

import { useEffect, type ReactNode } from 'react';
import { useStaffTitleRegistration } from './StaffTitleContext';

export type StaffPageHeaderProps = {
  title: string;
  description?: string;
  eyebrow?: string;
  actions?: ReactNode;
  children?: ReactNode;
};

/**
 * Record titles stay with the screen that knows them, rather than URL parsing.
 * Inside the refreshed shell (`.vf-staff`) the header takes the staff spec: muted eyebrow,
 * H1 24/700 at line-height 1.4 (Vietnamese diacritics need the room), muted description, actions right-aligned and wrapping, 24px below.
 * The `[.vf-staff_&]:` classes only match under that root, so the legacy shells keep
 * today's look (spacing there still comes from `.staff-page-header` in staff.css).
 */
export function StaffPageHeader({ title, description, eyebrow, actions, children }: StaffPageHeaderProps) {
  const register = useStaffTitleRegistration();
  useEffect(() => register(title), [register, title]);
  return <header className="staff-page-header [.vf-staff_&]:mb-6 [.vf-staff_&]:flex [.vf-staff_&]:flex-wrap [.vf-staff_&]:items-start [.vf-staff_&]:justify-between [.vf-staff_&]:gap-x-6 [.vf-staff_&]:gap-y-4">
    <div className="flex min-w-0 flex-1 flex-col gap-2 [.vf-staff_&]:basis-80 [.vf-staff_&]:gap-1">
      {eyebrow ? <p className="text-xs font-semibold tracking-wide text-primary [.vf-staff_&]:font-medium [.vf-staff_&]:leading-normal [.vf-staff_&]:tracking-normal [.vf-staff_&]:text-muted-foreground">{eyebrow}</p> : null}
      <h1 className="break-words text-2xl font-semibold tracking-tight sm:text-3xl [.vf-staff_&]:font-bold [.vf-staff_&]:leading-[1.4] [.vf-staff_&]:sm:text-2xl">{title}</h1>
      {description ? <p className="max-w-3xl text-sm leading-6 text-muted-foreground sm:text-base [.vf-staff_&]:leading-normal [.vf-staff_&]:sm:text-sm">{description}</p> : null}
      {children}
    </div>
    {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2 [.vf-staff_&]:max-w-full">{actions}</div> : null}
  </header>;
}
