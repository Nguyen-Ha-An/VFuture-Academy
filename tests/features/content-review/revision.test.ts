import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  isoRevisionTimestamp,
  sameContentRevision,
} from "@/features/content-review/revision";
describe("CMS revision timestamp spellings", () => {
  it("preserves PostgreSQL microseconds while producing ISO accepted by save routes", () => {
    const iso = isoRevisionTimestamp("2026-09-08 12:34:56.123456+00");
    expect(iso).toBe("2026-09-08T12:34:56.123456Z");
    expect(z.iso.datetime({ offset: true }).safeParse(iso).success).toBe(true);
    expect(
      sameContentRevision("resource", iso, "2026-09-08 12:34:56.123456+00"),
    ).toBe(true);
    expect(
      sameContentRevision("resource", iso, "2026-09-08 12:34:56.123457+00"),
    ).toBe(false);
  });
  it("normalizes offsets without treating opaque bank/media revisions as timestamps", () => {
    expect(isoRevisionTimestamp("2026-09-08 19:34:56.000001+07")).toBe(
      "2026-09-08T12:34:56.000001Z",
    );
    expect(
      sameContentRevision(
        "bank_question",
        "2026-09-08T12:00:00Z",
        "2026-09-08 12:00:00+00",
      ),
    ).toBe(false);
  });
});
