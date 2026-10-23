import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  enforceRequestRateLimit: vi.fn(),
  getSessionUser: vi.fn(),
  getPublicCourse: vi.fn(),
  insert: vi.fn(),
  listPublicCourses: vi.fn(),
  supabaseService: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getSessionUser: mocks.getSessionUser,
}));

vi.mock("@/features/marketing/public-courses", () => ({
  getPublicCourse: mocks.getPublicCourse,
  listPublicCourses: mocks.listPublicCourses,
}));

vi.mock("@/lib/supabase/server", () => ({
  supabaseService: mocks.supabaseService,
}));
vi.mock("@/lib/rate-limit", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/rate-limit")>(),
  RATE_LIMITS: { analytics: {} },
  enforceRateLimit: vi.fn(),
  enforceRequestRateLimit: mocks.enforceRequestRateLimit,
  userRateLimitKey: vi.fn((_scope: string, userId: string) => `analytics:user:${userId}`),
}));

import { POST as postAnalytics } from "@/app/api/v1/analytics/route";
import { GET as getCourses } from "@/app/api/v1/public/courses/route";
import { GET as getCourse } from "@/app/api/v1/public/courses/[courseId]/route";
import { resetPublicRateLimitForTests } from "@/features/marketing/public-http";

function responseCookie(response: Response) {
  return response.headers.get("set-cookie")?.split(";", 1)[0] ?? "";
}

describe("public marketing API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("RATE_LIMIT_COOKIE_SECRET", "test-rate-limit-cookie-secret-with-32-bytes");
    vi.stubEnv("TRUSTED_PROXY", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "marketing-api-test-session-secret");
    resetPublicRateLimitForTests();
    mocks.getSessionUser.mockResolvedValue(null);
    mocks.enforceRequestRateLimit.mockResolvedValue(undefined);
    mocks.listPublicCourses.mockResolvedValue([]);
    mocks.getPublicCourse.mockResolvedValue(null);
    mocks.insert.mockResolvedValue({ error: null });
    mocks.supabaseService.mockReturnValue({
      from: vi.fn().mockReturnValue({ insert: mocks.insert }),
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetPublicRateLimitForTests();
  });

  it.each(['', 'vf_analytics_consent=v1.denied', 'vf_analytics_consent=v0.granted', 'vf_analytics_consent=broken'])('discards analytics without current consent before any auth, DB or body work: %s', async (cookie) => {
    const request = new Request('https://academy.example/api/v1/analytics', {
      method: 'POST', headers: { Cookie: cookie, 'Content-Length': '1000000' }, body: 'not-json',
    });
    const response = await postAnalytics(request);
    expect(response.status).toBe(204);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(request.bodyUsed).toBe(false);
    expect(mocks.getSessionUser).not.toHaveBeenCalled();
    expect(mocks.supabaseService).not.toHaveBeenCalled();
    expect(mocks.enforceRequestRateLimit).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it.each([
    { name: 'exam.started', props: { itemId: 'exam-1' } },
    { name: 'course.enrolled', props: { courseId: 'course-1' } },
    { name: 'public.page_viewed', props: { route: '/courses?email=private@example.com' } },
    { name: 'public.filters_applied', props: { route: 'resources', search: 'private@example.com' } },
    { name: 'public.cta_clicked', props: { route: 'home', cta: 'contact', userId: 'forged' } },
    { name: 'public.page_viewed', props: { route: 'home', url: 'https://example.com' } },
  ])('rejects browser operational events and prohibited properties: $name', async (event) => {
    const response = await postAnalytics(new Request('https://academy.example/api/v1/analytics', {
      method: 'POST', headers: { Cookie: 'vf_analytics_consent=v1.granted' },
      body: JSON.stringify({ events: [event] }),
    }));
    expect(response.status).toBe(400);
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it('accepts the five bounded public event contracts after consent', async () => {
    const events = [
      { name: 'public.page_viewed', props: { route: 'home', locale: 'en' } },
      { name: 'public.card_clicked', props: { route: 'courses', catalog: 'courses', itemId: 'ai-foundations' } },
      { name: 'public.filters_applied', props: { route: 'resources', hasSearch: true } },
      { name: 'public.pagination_clicked', props: { route: 'courses', page: 2 } },
      { name: 'public.cta_clicked', props: { route: 'course_detail', cta: 'enroll', itemId: 'ai-foundations' } },
    ];
    const response = await postAnalytics(new Request('https://academy.example/api/v1/analytics', {
      method: 'POST', headers: { Cookie: 'vf_analytics_consent=v1.granted' }, body: JSON.stringify({ events }),
    }));
    expect(response.status).toBe(202);
    expect(mocks.insert).toHaveBeenCalledWith(events.map((event) => ({ ...event, user_id: null })));
    expect(mocks.enforceRequestRateLimit).toHaveBeenCalled();
  });

  it("rejects an unsupported catalog locale", async () => {
    const response = await getCourses(
      new Request("https://academy.example/api/v1/public/courses?locale=fr"),
    );

    expect(response.status).toBe(400);
    expect(mocks.listPublicCourses).not.toHaveBeenCalled();
  });

  it("returns a localized public course detail and a missing course as 404", async () => {
    mocks.getPublicCourse.mockResolvedValueOnce({ id: "ai-foundations", title: "AI Foundations" });
    const found = await getCourse(
      new Request("https://academy.example/api/v1/public/courses/ai-foundations?locale=en"),
      { params: Promise.resolve({ courseId: "ai-foundations" }) },
    );
    const missing = await getCourse(
      new Request("https://academy.example/api/v1/public/courses/missing?locale=en"),
      { params: Promise.resolve({ courseId: "missing" }) },
    );

    expect(found.status).toBe(200);
    expect(await found.json()).toEqual({ data: { id: "ai-foundations", title: "AI Foundations" } });
    expect(missing.status).toBe(404);
  });

  it("does not advertise an independent long-lived CDN cache for public courses", async () => {
    mocks.listPublicCourses.mockResolvedValueOnce([{ id: "ai-foundations" }]);
    mocks.getPublicCourse.mockResolvedValueOnce({ id: "ai-foundations" });

    const catalog = await getCourses(
      new Request("https://academy.example/api/v1/public/courses?locale=en"),
    );
    const detail = await getCourse(
      new Request("https://academy.example/api/v1/public/courses/ai-foundations?locale=en", {
        headers: { Cookie: responseCookie(catalog) },
      }),
      { params: Promise.resolve({ courseId: "ai-foundations" }) },
    );

    // The minting response carries a per-visitor token, so a shared cache must not store it.
    expect(catalog.headers.get("set-cookie")).toContain("vf_public_session=");
    expect(catalog.headers.get("cache-control")).toBe("private, no-store");
    // Once the visitor holds the cookie, no response-level CDN lifetime is added; the
    // server-side tagged cache remains the single freshness policy.
    expect(detail.headers.get("set-cookie")).toBeNull();
    expect(detail.headers.get("cache-control")).toBeNull();
  });

  it("caps anonymous analytics batches at 50 events", async () => {
    const response = await postAnalytics(
      new Request("https://academy.example/api/v1/analytics", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: "vf_analytics_consent=v1.granted" },
        body: JSON.stringify({
          events: Array.from({ length: 51 }, (_, index) => ({
            name: "landing.cta_clicked",
            props: { cta: `cta-${index}` },
            at: new Date().toISOString(),
          })),
        }),
      }),
    );

    expect(response.status).toBe(400);
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("rejects analytics names outside the shared runtime allowlist", async () => {
    const response = await postAnalytics(
      new Request("https://academy.example/api/v1/analytics", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: "vf_analytics_consent=v1.granted" },
        body: JSON.stringify({ events: [{ name: "forged.event", props: {}, at: "2099-01-01T00:00:00.000Z" }] }),
      }),
    );

    expect(response.status).toBe(400);
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("rejects an event whose serialized properties exceed 4 KiB", async () => {
    const props = Object.fromEntries(Array.from(
      { length: 18 },
      (_, index) => [`property-${index}`, "x".repeat(240)],
    ));
    const response = await postAnalytics(
      new Request("https://academy.example/api/v1/analytics", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: "vf_analytics_consent=v1.granted" },
        body: JSON.stringify({
          events: [{ name: "landing.cta_clicked", props, at: "2026-09-03T00:00:00.000Z" }],
        }),
      }),
    );

    expect(response.status).toBe(400);
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("uses the database server time instead of a client-supplied timestamp", async () => {
    const response = await postAnalytics(
      new Request("https://academy.example/api/v1/analytics", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: "vf_analytics_consent=v1.granted" },
        body: JSON.stringify({
          events: [{ name: "landing.cta_clicked", props: { cta: "hero" }, at: "2099-01-01T00:00:00.000Z" }],
        }),
      }),
    );

    expect(response.status).toBe(202);
    expect(mocks.insert).toHaveBeenCalledWith([{
      user_id: null,
      name: "landing.cta_clicked",
      props: { cta: "hero" },
    }]);
  });

  it("rejects a declared body larger than 64 KiB before parsing", async () => {
    const response = await postAnalytics(
      new Request("https://academy.example/api/v1/analytics", {
        method: "POST",
        headers: {
          "Content-Length": String(64 * 1024 + 1),
          "Content-Type": "application/json", Cookie: "vf_analytics_consent=v1.granted",
        },
        body: "{}",
      }),
    );

    expect(response.status).toBe(413);
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("rejects a chunked body once the streamed bytes exceed 64 KiB", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(32 * 1024));
        controller.enqueue(new Uint8Array(32 * 1024));
        controller.enqueue(new Uint8Array(1));
        controller.close();
      },
    });
    const response = await postAnalytics(
      new Request("https://academy.example/api/v1/analytics", {
        method: "POST",
        headers: {
          "Content-Type": "application/json", Cookie: "vf_analytics_consent=v1.granted",
        },
        body,
        duplex: "half",
      } as RequestInit & { duplex: "half" }),
    );

    expect(response.status).toBe(413);
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("accepts analytics as a no-op while the Plan 4 table is absent", async () => {
    mocks.insert.mockResolvedValueOnce({
      error: { code: "42P01", message: 'relation "analytics_events" does not exist' },
    });
    const response = await postAnalytics(
      new Request("https://academy.example/api/v1/analytics", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: "vf_analytics_consent=v1.granted" },
        body: JSON.stringify({
          events: [{
            name: "landing.cta_clicked",
            props: { cta: "hero-primary" },
            at: new Date().toISOString(),
          }],
        }),
      }),
    );

    expect(response.status).toBe(202);
  });

  it("records the verified session user on analytics events", async () => {
    mocks.getSessionUser.mockResolvedValueOnce({ id: "user-42" });
    const response = await postAnalytics(
      new Request("https://academy.example/api/v1/analytics", {
        method: "POST",
        headers: {
          "Content-Type": "application/json", Cookie: "vf_analytics_consent=v1.granted",
        },
        body: JSON.stringify({
          events: [{
            name: "landing.cta_clicked",
            props: { cta: "hero-primary" },
            at: new Date().toISOString(),
          }],
        }),
      }),
    );

    expect(response.status).toBe(202);
    expect(mocks.insert).toHaveBeenCalledWith([
      expect.objectContaining({ user_id: "user-42" }),
    ]);
  });

  it("ignores spoofed forwarding headers when rate-limiting without a trusted proxy", async () => {
    const bootstrap = await getCourses(
      new Request("https://academy.example/api/v1/public/courses"),
    );
    const cookie = responseCookie(bootstrap);
    const responses = [];
    for (let index = 0; index < 61; index += 1) {
      responses.push(await postAnalytics(
        new Request("https://academy.example/api/v1/analytics", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Cookie: `${cookie}; vf_analytics_consent=v1.granted`,
            "x-forwarded-for": `198.51.100.${index}`,
          },
          body: JSON.stringify({
            events: [{
              name: "landing.cta_clicked",
              props: { cta: "hero-primary" },
              at: new Date().toISOString(),
            }],
          }),
        }),
      ));
    }
    expect(responses.at(-1)?.status).toBe(429);
  });

  it("uses forwarding headers when and only when the deployment trusts its proxy", async () => {
    vi.stubEnv("TRUSTED_PROXY", "1");
    const responses = [];
    for (let index = 0; index < 61; index += 1) {
      responses.push(await getCourses(new Request(
        "https://academy.example/api/v1/public/courses",
        { headers: { "x-forwarded-for": `198.51.100.${index}` } },
      )));
    }

    expect(responses.every(({ status }) => status === 200)).toBe(true);
  });

  it("shares a rate-limit bucket across the public course endpoints", async () => {
    const bootstrap = await getCourses(
      new Request("https://academy.example/api/v1/public/courses"),
    );
    // The cookie earns this visitor a private bucket; it spans both public course
    // endpoints, so switching endpoints cannot buy a fresh budget.
    const headers = { Cookie: responseCookie(bootstrap) };
    for (let index = 0; index < 60; index += 1) {
      const response = await getCourses(
        new Request("https://academy.example/api/v1/public/courses", { headers }),
      );
      expect(response.status).toBe(200);
    }

    const response = await getCourse(
      new Request("https://academy.example/api/v1/public/courses/ai-foundations", { headers }),
      { params: Promise.resolve({ courseId: "ai-foundations" }) },
    );

    expect(response.status).toBe(429);
    expect(mocks.getPublicCourse).not.toHaveBeenCalled();
  });
});
