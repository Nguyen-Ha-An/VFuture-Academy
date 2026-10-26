import { NextResponse } from "next/server";
import type { Locale } from "@/content-engine";
import { listPublicCourses } from "@/features/marketing/public-courses";
import {
  applyPublicResponseHeaders,
  checkPublicRateLimit,
} from "@/features/marketing/public-http";
import { withHandler } from "@/lib/api";

function requestedLocale(request: Request): Locale | null {
  const value = new URL(request.url).searchParams.get("locale") ?? "vi";
  return value === "vi" || value === "en" ? value : null;
}

export const GET = withHandler(async (request: Request) => {
  const rateLimit = await checkPublicRateLimit(request);
  if (!rateLimit.allowed) {
    return applyPublicResponseHeaders(NextResponse.json(
      { error: rateLimit.status === 503 ? "rate_limit_unavailable" : "rate_limited" },
      { status: rateLimit.status ?? 429, headers: { "Retry-After": "60" } },
    ), rateLimit);
  }
  const locale = requestedLocale(request);
  if (!locale) {
    return applyPublicResponseHeaders(
      NextResponse.json({ error: "invalid_locale" }, { status: 400 }),
      rateLimit,
    );
  }
  const courses = await listPublicCourses(locale, { limit: 100 });
  return applyPublicResponseHeaders(NextResponse.json({ data: courses }), rateLimit);
});
