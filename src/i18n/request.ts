import { cookies } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { withBenchMessages } from "@/messages/bench";
import { withStaffUiMessages } from "@/messages/staff-ui";

export const locales = ["vi", "en"] as const;
export type AppLocale = (typeof locales)[number];

function isLocale(value: string | undefined): value is AppLocale {
  return value !== undefined && locales.includes(value as AppLocale);
}

export default getRequestConfig(async () => {
  const localeCookie = (await cookies()).get("locale")?.value;
  const locale = isLocale(localeCookie) ? localeCookie : "vi";

  return {
    locale,
    messages: withStaffUiMessages(withBenchMessages((await import(`../messages/${locale}.json`)).default, locale), locale),
  };
});
