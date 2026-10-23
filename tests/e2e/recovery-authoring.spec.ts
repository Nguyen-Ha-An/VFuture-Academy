import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";

import { openRolePage, unavailableRoleStorageStateMessage } from "./support/auth";
import { assertE2EResetTarget } from "./support/reset";

test.describe("@recovery-06 course authoring access", () => {
  test("keeps course creation and publication behind Studio authentication", async ({ request }) => {
    const create = await request.post("/api/v1/studio/courses", {
      data: {
        id: "recovery-06-anonymous",
        title: { en: "Anonymous" },
        languages: ["en"],
        defaultLanguage: "en",
        pathway: "core-future-skills",
        level: "foundation",
      },
    });
    const publish = await request.post("/api/v1/studio/courses/recovery-06-anonymous/publish", { data: {} });
    expect(create.status()).toBe(401);
    expect(publish.status()).toBe(401);
  });
});

test.describe("@recovery-06 forms to immutable publication", () => {
  const unavailable = unavailableRoleStorageStateMessage(["admin"]);
  test.skip(Boolean(unavailable), unavailable ?? "Admin role state is available.");

  test("creates unique form content, flushes it to preview, and preserves version one after version two", async ({ browser, baseURL }) => {
    test.setTimeout(120_000);
    if (!baseURL) throw new Error("Course authoring acceptance requires an explicit application origin.");
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceRoleKey) throw new Error("Course authoring acceptance requires staging cleanup credentials.");
    assertE2EResetTarget(supabaseUrl, process.env);

    const suffix = randomUUID().replaceAll("-", "").slice(0, 16);
    const courseId = `recovery-authoring-${suffix}`;
    const versionOneTitle = `Recovery forms ${suffix}`;
    const versionTwoTitle = `${versionOneTitle} v2`;
    const lessonTitle = `Published lesson ${suffix}`;
    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { context, page } = await openRolePage(browser, "admin", new URL(baseURL).origin);
    let verifiedCreated = false;
    let checkpoint = "verify the disposable course namespace";
    const draftWrites: Array<{ path: string; status: number }> = [];
    const draftReads: Array<{ path: string; status: number }> = [];
    const draftWriteRequests: string[] = [];
    page.on("request", (request) => {
      const path = new URL(request.url()).pathname;
      if (request.method() === "PUT" && path.startsWith(`/api/v1/studio/courses/${courseId}/draft`)) {
        draftWriteRequests.push(path);
      }
    });
    page.on("response", (response) => {
      const path = new URL(response.url()).pathname;
      if (response.request().method() === "PUT" && path.startsWith(`/api/v1/studio/courses/${courseId}/draft`)) {
        draftWrites.push({ path, status: response.status() });
      }
      if (response.request().method() === "GET" && path === `/api/v1/studio/courses/${courseId}/draft`) {
        draftReads.push({ path, status: response.status() });
      }
    });

    try {
      const existing = await admin.from("courses").select("id").eq("id", courseId).maybeSingle();
      if (existing.error) throw new Error(`Course precondition check failed for ${courseId}.`);
      expect(existing.data).toBeNull();

      checkpoint = "create the course through the Studio form";
      await page.goto("/studio/courses");
      await page.getByRole("button", { name: "New course", exact: true }).click();
      const createDialog = page.getByRole("dialog", { name: "Create a course" });
      await createDialog.getByLabel("Course ID").fill(courseId);
      await createDialog.getByLabel("Vietnamese title").fill(`Khóa học ${suffix}`);
      await createDialog.getByLabel("English title").fill(versionOneTitle);
      await createDialog.getByLabel("Default language").selectOption("en");
      await createDialog.getByRole("button", { name: "Create course" }).click();
      await expect(page).toHaveURL(new RegExp(`/studio/courses/${courseId}$`), { timeout: 20_000 });

      checkpoint = "verify the created draft";
      const created = await admin.from("courses").select("id,current_version_id").eq("id", courseId).maybeSingle();
      if (created.error) throw new Error(`Course creation verification failed for ${courseId}.`);
      expect(created.data).toMatchObject({ id: courseId, current_version_id: null });
      verifiedCreated = created.data?.id === courseId;

      checkpoint = "edit the manifest and first lesson forms";
      await page.getByRole("button", { name: "Forms", exact: true }).click();
      const courseForm = page.getByRole("form", { name: "Course metadata" });
      await expect(courseForm).toBeVisible();
      await courseForm.getByLabel("Summary (English)").fill(`Summary saved through forms ${suffix}`);
      await courseForm.getByLabel("Estimated minutes").fill("25");

      const outline = page.getByRole("navigation", { name: "Course outline" });
      await outline.getByRole("button", { name: /first-lesson|Lesson/i }).first().click();
      const itemForm = page.getByRole("form", { name: "Item metadata" });
      await expect(itemForm).toBeVisible();
      const firstItemWrite = page.waitForResponse((response) => response.request().method() === "PUT"
        && new URL(response.url()).pathname.endsWith(`/draft/items/first-lesson`), { timeout: 20_000 });
      await itemForm.getByLabel("Title (English)").fill(lessonTitle);
      await itemForm.getByLabel("Summary (English)").fill(`Lesson summary ${suffix}`);

      checkpoint = "flush the first lesson to the draft and compile its preview";
      const preview = page.getByRole("region", { name: "Course item preview" });
      await preview.getByRole("button", { name: "EN" }).click({ timeout: 20_000 });
      await preview.getByRole("button", { name: "Refresh preview" }).click({ timeout: 20_000 });
      expect((await firstItemWrite).status()).toBe(200);
      await expect(preview.getByRole("heading", { name: lessonTitle })).toBeVisible({ timeout: 20_000 });

      checkpoint = "publish immutable version one";
      await page.getByRole("button", { name: "Publish", exact: true }).click();
      const firstDialog = page.getByRole("dialog", { name: "Publish immutable version" });
      await expect(firstDialog).toBeVisible({ timeout: 20_000 });
      for (const checkbox of await firstDialog.getByRole("checkbox").all()) await checkbox.check();
      const firstPublish = page.waitForResponse((response) => response.url().endsWith(`/${courseId}/publish`) && response.request().method() === "POST", { timeout: 20_000 });
      await firstDialog.getByRole("button", { name: "Publish version" }).click();
      expect((await firstPublish).status()).toBe(200);
      await expect(page.getByText("Published version 1")).toBeVisible({ timeout: 20_000 });

      checkpoint = "verify immutable version one";
      const versionOne = await admin.from("course_versions").select("id,version,manifest").eq("course_id", courseId).eq("version", 1).single();
      if (versionOne.error) throw new Error(`Could not verify version one for ${courseId}.`);
      expect(versionOne.data.manifest).toMatchObject({ title: { en: versionOneTitle } });
      const versionOneId = versionOne.data.id;

      checkpoint = "edit and publish immutable version two";
      await outline.getByRole("button", { name: "Course manifest" }).click();
      const nextCourseForm = page.getByRole("form", { name: "Course metadata" });
      await nextCourseForm.getByLabel("Title (English)").fill(versionTwoTitle);
      await page.getByRole("button", { name: "Publish", exact: true }).click();
      const secondDialog = page.getByRole("dialog", { name: "Publish immutable version" });
      await expect(secondDialog).toBeVisible({ timeout: 20_000 });
      for (const checkbox of await secondDialog.getByRole("checkbox").all()) await checkbox.check();
      const secondPublish = page.waitForResponse((response) => response.url().endsWith(`/${courseId}/publish`) && response.request().method() === "POST", { timeout: 20_000 });
      await secondDialog.getByRole("button", { name: "Publish version" }).click();
      expect((await secondPublish).status()).toBe(200);
      await expect(page.getByText("Published version 2")).toBeVisible({ timeout: 20_000 });

      checkpoint = "verify both immutable versions";
      const versions = await admin.from("course_versions").select("id,version,manifest").eq("course_id", courseId).order("version", { ascending: true });
      if (versions.error) throw new Error(`Could not verify immutable versions for ${courseId}.`);
      expect(versions.data).toHaveLength(2);
      expect(versions.data[0]).toMatchObject({ id: versionOneId, version: 1, manifest: { title: { en: versionOneTitle } } });
      expect(versions.data[1]).toMatchObject({ version: 2, manifest: { title: { en: versionTwoTitle } } });
    } catch (error) {
      // Only fixture IDs, response statuses and diagnostic codes are recorded.
      try {
        const snapshotResponse = await context.request.get(`/api/v1/studio/courses/${courseId}/draft`, { timeout: 5_000 });
        const snapshot = await snapshotResponse.json() as { data?: { items?: Record<string, unknown>; updatedAt?: string | null } };
        const validationResponse = await context.request.post(`/api/v1/studio/courses/${courseId}/draft/validate`, { data: { publish: false }, timeout: 5_000 });
        const validation = await validationResponse.json() as { data?: { errors?: Array<{ code?: string; docId?: string; path?: string }> } };
        console.info(JSON.stringify({ authoringCheckpoint: {
          checkpoint, courseId, draftStatus: snapshotResponse.status(), draftUpdatedAt: snapshot.data?.updatedAt ?? null,
          storedItemIds: Object.keys(snapshot.data?.items ?? {}), reads: draftReads.slice(-12),
          writeRequests: draftWriteRequests.slice(-12), writes: draftWrites.slice(-12),
          alerts: (await page.getByRole("alert").allTextContents()).slice(0, 8),
          diagnostics: (validation.data?.errors ?? []).slice(0, 12).map(({ code, docId, path }) => ({ code, docId, path })),
        } }));
      } catch {
        console.info(JSON.stringify({ authoringCheckpoint: { checkpoint, courseId, diagnosticReadback: "unavailable" } }));
      }
      throw error;
    } finally {
      await context.close();
      if (verifiedCreated) {
        const detached = await admin.from("courses").update({ current_version_id: null }).eq("id", courseId).select("id").single();
        if (detached.error || detached.data?.id !== courseId) throw new Error(`Course cleanup precondition failed for ${courseId}.`);
        const removed = await admin.from("courses").delete().eq("id", courseId).select("id").single();
        if (removed.error || removed.data?.id !== courseId) throw new Error(`Course cleanup failed for ${courseId}.`);
        const auditCleanup = await admin.from("audit_log").delete().eq("target_type", "course").eq("target_id", courseId);
        if (auditCleanup.error) throw new Error(`Course audit cleanup failed for ${courseId}.`);
      }
    }
  });
});
