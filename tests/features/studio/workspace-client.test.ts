import { describe, expect, it } from "vitest";

import { readApiData, workspaceErrorMessage } from "@/features/studio/ui/client";

describe("workspace API client", () => {
  it("unwraps successful data and exposes the API error message", async () => {
    await expect(readApiData<{ id: string }>(new Response(JSON.stringify({ data: { id: "course-1" } }), { status: 200 })))
      .resolves.toEqual({ id: "course-1" });
    const failure = readApiData(new Response(JSON.stringify({ error: { code: "CONFLICT", message: "Draft changed" } }), { status: 409 }));
    await expect(failure).rejects.toMatchObject({ code: "CONFLICT", message: "Draft changed" });
    await expect(failure).rejects.toThrow("Draft changed");
    try {
      await failure;
    } catch (cause) {
      expect(workspaceErrorMessage(cause, "Localized fallback")).toBe("Localized fallback (CONFLICT)");
    }
  });
});
