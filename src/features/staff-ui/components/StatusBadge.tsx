import type { ComponentProps } from "react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { statusTone, type StatusKind, type StatusTone, type StatusValues } from "./status-tones";

// Tone → canonical badge variant. Kept here so status-tones.ts stays UI-free.
const TONE_VARIANT = {
  neutral: "neutral",
  info: "info",
  success: "success",
  warning: "warning",
  danger: "danger",
  outline: "outline",
} as const satisfies Record<StatusTone, NonNullable<ComponentProps<typeof Badge>["variant"]>>;

export type StatusBadgeProps<K extends StatusKind = StatusKind> = Omit<ComponentProps<"span">, "children"> & {
  kind: K;
  value: StatusValues[K] | (string & {});
  /** Overrides the default vi/en label from staffUi.kit.status.<kind>.<value>. */
  label?: string;
  /** Overrides the mapped tone, e.g. to mute a state in a secondary column. */
  tone?: StatusTone;
};

/** No "use client": renders the same from server and client components. */
export function StatusBadge<K extends StatusKind>({ kind, value, label, tone, className, ...props }: StatusBadgeProps<K>) {
  const t = useTranslations("staffUi.kit.status");
  const key = `${kind}.${value}`;
  // An unknown value (bad data, a state added later) shows its raw text on a neutral pill.
  const text = label ?? (t.has(key) ? t(key) : value);
  const resolvedTone = tone ?? statusTone(kind, value);
  return (
    <Badge variant={TONE_VARIANT[resolvedTone]} data-tone={resolvedTone} className={className} {...props}>
      {text}
    </Badge>
  );
}
