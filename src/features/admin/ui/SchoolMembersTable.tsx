"use client";

import { useId } from "react";
import { CanvasLink, CanvasResponsive, CanvasTable } from "@/features/canvas/ui";
import { StatusBadge } from "@/features/staff-ui/components";
import type { SchoolMemberRow } from "@/app/admin/branches/SchoolDetailView";

/** Native InstUI stacked rows retain role and status information on narrow screens. */
export function SchoolMembersTable({ title, rows, labels }: {
  title: string;
  rows: SchoolMemberRow[];
  labels: { member: string; roles: string; status: string };
}) {
  const id = useId();
  return <CanvasResponsive
    query={{ small: { maxWidth: "40rem" }, large: { minWidth: "40.01rem" } }}
    props={{ small: { layout: "stacked" }, large: { layout: "fixed" } }}
  >{(responsive) => <CanvasTable caption={() => title} layout={(responsive?.layout ?? "fixed") as "stacked" | "fixed"} hover>
    <CanvasTable.Head><CanvasTable.Row>
      <CanvasTable.ColHeader id={`${id}-member`} width="48%">{labels.member}</CanvasTable.ColHeader>
      <CanvasTable.ColHeader id={`${id}-roles`}>{labels.roles}</CanvasTable.ColHeader>
      <CanvasTable.ColHeader id={`${id}-status`}>{labels.status}</CanvasTable.ColHeader>
    </CanvasTable.Row></CanvasTable.Head>
    <CanvasTable.Body>{rows.map((member) => <CanvasTable.Row key={member.id}>
      <CanvasTable.RowHeader>
        <CanvasLink href={member.href}>{member.name}</CanvasLink>
        <span className="block break-all text-xs font-normal leading-normal text-muted-foreground">{member.email}</span>
      </CanvasTable.RowHeader>
      <CanvasTable.Cell>{member.roles}</CanvasTable.Cell>
      <CanvasTable.Cell><StatusBadge kind="member" value={member.status} /></CanvasTable.Cell>
    </CanvasTable.Row>)}</CanvasTable.Body>
  </CanvasTable>}</CanvasResponsive>;
}
