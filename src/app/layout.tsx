import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import "./fonts.css";
import "./globals.css";

const criticalLatinFonts = [
  "be-vietnam-pro-300-latin.d69da10e8642.woff2",
  "be-vietnam-pro-400-latin.03d1b589cff1.woff2",
  "be-vietnam-pro-700-latin.a193dd87699b.woff2",
];
const criticalVietnameseFonts = [
  "be-vietnam-pro-300-vietnamese.1b48c66409b3.woff2",
  "be-vietnam-pro-400-vietnamese.dc085e2fba34.woff2",
  "be-vietnam-pro-700-vietnamese.4f58af2d1c3e.woff2",
];

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"),
  title: "VFuture Academy",
  description: "A bilingual learning academy for future builders.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const [locale, messages] = await Promise.all([getLocale(), getMessages()]);
  const criticalFonts = locale === "vi"
    ? [...criticalLatinFonts, ...criticalVietnameseFonts]
    : criticalLatinFonts;

  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        {criticalFonts.map((font) => (
          <link key={font} rel="preload" href={`/fonts/site/${font}`} as="font" type="font/woff2" crossOrigin="anonymous" />
        ))}
      </head>
      <body><NextIntlClientProvider locale={locale} messages={messages}>{children}</NextIntlClientProvider></body>
    </html>
  );
}
