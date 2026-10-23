import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import {
  applyPublicResponseHeaders,
  checkPublicRateLimit,
} from "@/features/marketing/public-http";
import { withHandler } from "@/lib/api";
import {
  RATE_LIMITS,
  enforceRateLimit,
  enforceRequestRateLimit,
  userRateLimitKey,
} from "@/lib/rate-limit";
import { supabaseService } from "@/lib/supabase/server";
import {
  BROWSER_ANALYTICS_EVENT_NAMES, isBrowserAnalyticsEvent,
  MAX_ANALYTICS_BODY_BYTES,
} from "@/lib/analytics-contract";
import { readAnalyticsConsent } from "@/lib/analytics-consent";

const analyticsValueSchema = z.union([
  z.string().max(240),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);

const analyticsPropsSchema = z
  .record(z.string().min(1).max(64), analyticsValueSchema)
  .refine((props) => Object.keys(props).length <= 20, "too_many_properties")
  .refine(
    (props) => new TextEncoder().encode(JSON.stringify(props)).byteLength <= 4 * 1024,
    "properties_too_large",
  );

const analyticsBatchSchema = z.object({
  events: z.array(
    z.object({
      name: z.enum(BROWSER_ANALYTICS_EVENT_NAMES),
      props: analyticsPropsSchema.default({}),
      at: z.iso.datetime().optional(),
    }).strict().refine((event) => isBrowserAnalyticsEvent(event.name, event.props), 'invalid_event_properties'),
  ).min(1).max(50),
}).strict();

type JsonBodyResult =
  | { ok: true; value: unknown }
  | { ok: false; tooLarge: boolean };

function declaredBodyTooLarge(request: Request) {
  const value = request.headers.get("content-length");
  if (!value || !/^\d+$/.test(value)) return false;
  return Number(value) > MAX_ANALYTICS_BODY_BYTES;
}

async function readJsonBody(request: Request): Promise<JsonBodyResult> {
  const reader = request.body?.getReader();
  if (!reader) return { ok: false, tooLarge: false };

  const decoder = new TextDecoder();
  let bytesRead = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytesRead += value.byteLength;
      if (bytesRead > MAX_ANALYTICS_BODY_BYTES) {
        await reader.cancel();
        return { ok: false, tooLarge: true };
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, tooLarge: false };
  }
}

function isMissingAnalyticsTable(error: { code?: string; message?: string }) {
  return error.code === "42P01"
    || Boolean(error.message?.includes("analytics_events") && error.message.includes("does not exist"));
}

export const POST = withHandler(async (request: Request) => {
  // Reject before body reads, auth lookups, rate-limit DB calls, cookies or analytics writes.
  if (readAnalyticsConsent(request.headers.get('cookie')) !== 'granted') {
    return new NextResponse(null, { status: 204, headers: { 'Cache-Control': 'private, no-store' } });
  }
  if (declaredBodyTooLarge(request)) {
    return NextResponse.json({ error: "payload_too_large" }, { status: 413 });
  }

  const rateLimit = checkPublicRateLimit(request);
  if (!rateLimit.allowed) {
    return applyPublicResponseHeaders(NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": "60" } },
    ), rateLimit);
  }

  const user = await getSessionUser().catch(() => null);
  const database = supabaseService();
  if (user) {
    await enforceRateLimit(
      database,
      userRateLimitKey("analytics", user.id),
      RATE_LIMITS.analytics,
    );
  } else {
    await enforceRequestRateLimit(database, "analytics", request, RATE_LIMITS.analytics);
  }

  const body = await readJsonBody(request);
  if (!body.ok) {
    const response = body.tooLarge
      ? NextResponse.json({ error: "payload_too_large" }, { status: 413 })
      : NextResponse.json({ error: "invalid_json" }, { status: 400 });
    return applyPublicResponseHeaders(response, rateLimit);
  }
  const parsed = analyticsBatchSchema.safeParse(body.value);
  if (!parsed.success) {
    return applyPublicResponseHeaders(
      NextResponse.json({ error: "invalid_events" }, { status: 400 }),
      rateLimit,
    );
  }

  const { error } = await database.from("analytics_events").insert(
    parsed.data.events.map((event) => ({
      user_id: user?.id ?? null,
      name: event.name,
      props: event.props,
    })),
  );
  if (error && !isMissingAnalyticsTable(error)) {
    return applyPublicResponseHeaders(
      NextResponse.json({ error: "analytics_unavailable" }, { status: 503 }),
      rateLimit,
    );
  }
  return applyPublicResponseHeaders(new NextResponse(null, { status: 202 }), rateLimit);
});
