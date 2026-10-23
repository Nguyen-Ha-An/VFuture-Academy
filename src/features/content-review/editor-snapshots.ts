import { OpportunityFormSchema } from "@/features/opportunities/schema";

export function sameContent(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (!left || !right || typeof left !== "object" || typeof right !== "object")
    return false;
  if (Array.isArray(left) || Array.isArray(right))
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, i) => sameContent(value, right[i]))
    );
  const a = left as Record<string, unknown>,
    b = right as Record<string, unknown>;
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => Object.hasOwn(b, key) && sameContent(a[key], b[key]))
  );
}

export function opportunityFormFromRow(row: Record<string, unknown>) {
  return OpportunityFormSchema.parse({
    id: row.id,
    title: row.title,
    organization: row.organization,
    type: row.type,
    description: row.description,
    eligibility: row.eligibility ?? {},
    recommendedSkills: row.recommended_skills ?? [],
    recommendedCourses: row.recommended_courses ?? [],
    requiredCourses: row.required_courses ?? [],
    applicationUrl: row.application_url ?? null,
    internalApplication: row.internal_application === true,
    openAt: row.open_at ?? null,
    closeAt: row.close_at ?? null,
    startAt: row.start_at ?? null,
    endAt: row.end_at ?? null,
    location: row.location ?? null,
    online: row.online === true,
    branchScope: row.branch_scope ?? { scope: "global" },
    featured: row.featured === true,
  });
}

/** Display timestamps may be normalized; opaque revision tokens must retain microseconds. */
export function savedTime(revision: string): string {
  const timestamp = new Date(
    revision.replace(" ", "T").replace(/\+00$/, "+00:00"),
  );
  if (!Number.isFinite(timestamp.getTime()))
    throw new Error("Invalid save acknowledgment timestamp");
  return timestamp.toISOString();
}
