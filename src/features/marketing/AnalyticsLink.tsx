"use client";

import Link from "next/link";
import type { ComponentProps } from "react";
import { track } from "@/lib/analytics-client";

type AnalyticsLinkProps = ComponentProps<typeof Link> & {
  eventName: string;
  eventProps: Record<string, string | number | boolean | null>;
};

export function AnalyticsLink({
  eventName,
  eventProps,
  onClick,
  ...props
}: AnalyticsLinkProps) {
  return (
    <Link
      {...props}
      onClick={(event) => {
        track(eventName, eventProps);
        onClick?.(event);
      }}
    />
  );
}
