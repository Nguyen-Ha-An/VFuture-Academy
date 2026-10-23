// @vitest-environment jsdom
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, expectTypeOf, it } from "vitest";
import type { ManagedInvitation } from "@/features/admin/management-contracts";
import type { AttemptStatus } from "@/features/exams/types";
import type { SubmissionStatus } from "@/features/instructor-grading/types";
import type { ProjectStatus } from "@/features/projects/service";
import type { StudioResourceStatus } from "@/features/resources/service";
import {
  CONTENT_STATUSES,
  EXAM_ATTEMPT_STATUSES,
  INVITATION_STATUSES,
  PROJECT_STATUSES,
  STATUS_TONES,
  STATUS_TONE_MAP,
  STATUS_VALUES,
  SUBMISSION_STATUSES,
  StatusBadge,
  statusTone,
  type StatusKind,
} from "@/features/staff-ui/components";
import en from "@/messages/en.json";
import vi from "@/messages/vi.json";
import kit from "@/messages/staff-ui/kit.json";
import { staffUiTestMessages } from "@/messages/staff-ui";

afterEach(cleanup);

const KINDS = Object.keys(STATUS_VALUES) as StatusKind[];
const MIGRATIONS = join(process.cwd(), "supabase/migrations");

/** Last `check (status in (...))` for a table across the migrations, in file order. */
function dbStatuses(table: string): string[] {
  let found: string[] | null = null;
  for (const file of readdirSync(MIGRATIONS).sort()) {
    const sql = readFileSync(join(MIGRATIONS, file), "utf8");
    const createPattern = new RegExp(`create table (?:if not exists )?public\\.${table}\\s*\\(([\\s\\S]*?)\\n\\);`, "gi");
    for (const match of sql.matchAll(createPattern)) {
      const status = /\bstatus text[^\n]*check \(status in \(([^)]*)\)\)/i.exec(match[1]);
      if (status) found = [...status[1].matchAll(/'([^']+)'/g)].map((value) => value[1]);
    }
    const alterPattern = new RegExp(`alter table public\\.${table}\\s+add constraint \\w+ check \\(status in \\(([^)]*)\\)`, "gi");
    for (const match of sql.matchAll(alterPattern)) found = [...match[1].matchAll(/'([^']+)'/g)].map((value) => value[1]);
  }
  if (!found) throw new Error(`no status check found for ${table}`);
  return found;
}

describe("status tone maps", () => {
  it("cover exactly the existing TypeScript unions (type level)", () => {
    expectTypeOf<Exclude<SubmissionStatus, (typeof SUBMISSION_STATUSES)[number]>>().toEqualTypeOf<never>();
    expectTypeOf<Exclude<AttemptStatus, (typeof EXAM_ATTEMPT_STATUSES)[number]>>().toEqualTypeOf<never>();
    expectTypeOf<Exclude<StudioResourceStatus, (typeof CONTENT_STATUSES)[number]>>().toEqualTypeOf<never>();
    expectTypeOf<Exclude<ProjectStatus, (typeof PROJECT_STATUSES)[number]>>().toEqualTypeOf<never>();
    expectTypeOf<Exclude<ManagedInvitation["status"], (typeof INVITATION_STATUSES)[number]>>().toEqualTypeOf<never>();
    expectTypeOf<keyof (typeof STATUS_TONE_MAP)["submission"]>().toEqualTypeOf<SubmissionStatus>();
    expectTypeOf<keyof (typeof STATUS_TONE_MAP)["examAttempt"]>().toEqualTypeOf<AttemptStatus>();
  });

  it("map every runtime value of every kind to a known tone, with no extras", () => {
    for (const kind of KINDS) {
      const map = STATUS_TONE_MAP[kind] as Record<string, string>;
      expect(Object.keys(map).sort(), kind).toEqual([...STATUS_VALUES[kind]].sort());
      for (const tone of Object.values(map)) expect(STATUS_TONES).toContain(tone);
    }
  });

  it("match the status check constraints in supabase/migrations", () => {
    expect([...STATUS_VALUES.review].sort()).toEqual(dbStatuses("cms_review_requests").sort());
    expect([...STATUS_VALUES.content].sort()).toEqual(dbStatuses("resources").sort());
    expect([...STATUS_VALUES.project].sort()).toEqual(dbStatuses("projects").sort());
    expect([...STATUS_VALUES.submission].sort()).toEqual(dbStatuses("assignment_submissions").sort());
    expect([...STATUS_VALUES.examAttempt].sort()).toEqual(dbStatuses("exam_attempts").sort());
    expect([...STATUS_VALUES.enrollment].sort()).toEqual(dbStatuses("enrollments").sort());
  });

  it("have a vi and en label for every value", () => {
    for (const locale of ["vi", "en"] as const) {
      const labels = kit[locale].status as Record<string, Record<string, string>>;
      expect(Object.keys(labels).sort()).toEqual([...KINDS].sort());
      for (const kind of KINDS) {
        expect(Object.keys(labels[kind]).sort(), `${locale}.${kind}`).toEqual([...STATUS_VALUES[kind]].sort());
        for (const label of Object.values(labels[kind])) expect(label.trim()).not.toBe("");
      }
    }
  });

  it("falls back to neutral for values outside the map", () => {
    expect(statusTone("submission", "approved")).toBe("success");
    expect(statusTone("review", "pending")).toBe("warning");
    expect(statusTone("member", "suspended")).toBe("danger");
    expect(statusTone("submission", "mystery")).toBe("neutral");
  });
});

describe("StatusBadge", () => {
  function renderBadge(node: React.ReactNode, locale: "vi" | "en" = "en") {
    return render(
      <NextIntlClientProvider locale={locale} messages={staffUiTestMessages(locale === "en" ? en : vi, locale)}>
        {node}
      </NextIntlClientProvider>,
    );
  }

  it("renders the canonical badge with the mapped tone and the default label", () => {
    renderBadge(
      <>
        <StatusBadge kind="submission" value="approved" />
        <StatusBadge kind="review" value="changes_requested" />
        <StatusBadge kind="invitation" value="pending" />
        <StatusBadge kind="content" value="draft" />
        <StatusBadge kind="enrollment" value="active" />
        <StatusBadge kind="invitation" value="revoked" />
      </>,
    );
    expect(screen.getByText("Approved")).toHaveAttribute("data-tone", "success");
    expect(screen.getByText("Approved")).toHaveClass("bg-success", "text-success-foreground");
    expect(screen.getByText("Changes requested")).toHaveClass("bg-destructive/10", "text-destructive-soft-foreground");
    expect(screen.getByText("Pending")).toHaveClass("bg-warning", "text-warning-foreground");
    expect(screen.getByText("Draft")).toHaveClass("bg-muted");
    expect(screen.getByText("Active")).toHaveClass("bg-info", "text-info-foreground");
    expect(screen.getByText("Revoked")).toHaveClass("border-border", "text-foreground");
    for (const badge of document.querySelectorAll("[data-slot=badge]")) expect(badge.className).not.toMatch(/shadow/);
  });

  it("uses Vietnamese defaults, label and tone overrides, and a neutral raw fallback", () => {
    renderBadge(
      <>
        <StatusBadge kind="examAttempt" value="pending_manual" />
        <StatusBadge kind="project" value="idea" label="Ý tưởng mới" tone="info" />
        <StatusBadge kind="member" value="legacy_state" />
      </>,
      "vi",
    );
    expect(screen.getByText("Chờ chấm tay")).toHaveAttribute("data-tone", "warning");
    expect(screen.getByText("Ý tưởng mới")).toHaveAttribute("data-tone", "info");
    expect(screen.getByText("legacy_state")).toHaveAttribute("data-tone", "neutral");
  });
});
