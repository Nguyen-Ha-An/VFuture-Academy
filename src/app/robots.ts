import type { MetadataRoute } from "next";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // Auth pages remain crawlable so crawlers can observe their noindex metadata.
      // Likewise draft policies use noindex, not robots blocking.
      disallow: ["/studio", "/app", "/api", "/home", "/learn", "/auth/", "/admin", "/grading"],
    },
    sitemap: new URL("/sitemap.xml", env.NEXT_PUBLIC_APP_URL).toString(),
  };
}
