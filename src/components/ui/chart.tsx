"use client";

import { createContext, useContext, useId, useMemo, type ComponentProps, type ComponentType, type CSSProperties, type ReactNode } from "react";
import * as RechartsPrimitive from "recharts";
import type { LegendPayload, TooltipPayloadEntry, TooltipValueType } from "recharts";
import { cn } from "@/lib/ui-cn";

// shadcn chart over Recharts 3. Import this module only from lazily loaded
// dashboard/report chunks so Recharts stays out of the shell bundle.

// Prefer `color: "var(--chart-1)"` in a config: the staff tokens already swap
// the chart ramp for dark mode. A `theme` pair follows the same rule as
// staff-tokens.css: dark when the OS is dark and the shell is not pinned light
// (vf-theme "system"), or when the shell is pinned dark. `:root:has()` keeps
// portalled charts (sheets, popovers) themed too.
type ChartTheme = "light" | "dark";
type ThemeSelector = { media?: string; prefix: string };

const THEMES: Record<ChartTheme, readonly ThemeSelector[]> = {
  light: [{ prefix: "" }],
  dark: [
    { media: "(prefers-color-scheme: dark)", prefix: ':root:has(.vf-staff:not([data-theme="light"]))' },
    { prefix: ':root:has(.vf-staff[data-theme="dark"])' },
  ],
};

/** next-intl locale ("vi" | "en") to the Intl locale charts format numbers with. */
export function chartNumberLocale(locale: string | undefined): "vi-VN" | "en-US" {
  return locale?.toLowerCase().startsWith("vi") ? "vi-VN" : "en-US";
}

/** Locale-aware number formatter for chart ticks and tooltips, so vi reads 1.234,5 whatever the OS locale. */
export function chartNumberFormat(locale: string | undefined, options?: Intl.NumberFormatOptions) {
  return new Intl.NumberFormat(chartNumberLocale(locale), options);
}

export type ChartConfig = {
  [key in string]: {
    label?: ReactNode;
    icon?: ComponentType;
  } & ({ color?: string; theme?: never } | { color?: never; theme: Record<ChartTheme, string> });
};

type ChartContextProps = { config: ChartConfig; numbers: Intl.NumberFormat };

const ChartContext = createContext<ChartContextProps | null>(null);

export function useChart() {
  const context = useContext(ChartContext);
  if (!context) throw new Error("useChart must be used within a <ChartContainer />");
  return context;
}

export function ChartContainer({
  id,
  className,
  children,
  config,
  locale,
  ...props
}: ComponentProps<"div"> & {
  config: ChartConfig;
  /** The app locale (next-intl `useLocale()`); tooltips format numbers with it. */
  locale: string;
  children: ComponentProps<typeof RechartsPrimitive.ResponsiveContainer>["children"];
}) {
  const uniqueId = useId();
  const chartId = `chart-${(id ?? uniqueId).replace(/:/g, "")}`;
  const value = useMemo(() => ({ config, numbers: chartNumberFormat(locale) }), [config, locale]);

  return (
    <ChartContext.Provider value={value}>
      <div
        data-slot="chart"
        data-chart={chartId}
        className={cn(
          "flex aspect-video justify-center text-xs [&_.recharts-cartesian-axis-tick_text]:fill-muted-foreground [&_.recharts-cartesian-grid_line[stroke='#ccc']]:stroke-border/50 [&_.recharts-curve.recharts-tooltip-cursor]:stroke-border [&_.recharts-dot[stroke='#fff']]:stroke-transparent [&_.recharts-layer]:outline-none [&_.recharts-polar-grid_[stroke='#ccc']]:stroke-border [&_.recharts-radial-bar-background-sector]:fill-muted [&_.recharts-rectangle.recharts-tooltip-cursor]:fill-muted [&_.recharts-reference-line_[stroke='#ccc']]:stroke-border [&_.recharts-sector]:outline-none [&_.recharts-sector[stroke='#fff']]:stroke-transparent [&_.recharts-surface]:outline-none",
          className,
        )}
        {...props}
      >
        <ChartStyle id={chartId} config={config} />
        <RechartsPrimitive.ResponsiveContainer>{children}</RechartsPrimitive.ResponsiveContainer>
      </div>
    </ChartContext.Provider>
  );
}

// Config keys and colours become CSS custom properties, so only accept safe
// identifiers and colour values that cannot close the declaration.
const SAFE_KEY = /^[A-Za-z0-9_-]+$/;
const SAFE_COLOR = /^[^;{}<>]+$/;

export function ChartStyle({ id, config }: { id: string; config: ChartConfig }) {
  const colorConfig = Object.entries(config).filter(([key, item]) => SAFE_KEY.test(key) && (item.theme || item.color));
  if (!colorConfig.length) return null;

  const declarationsFor = (theme: ChartTheme) =>
    colorConfig
      .map(([key, item]) => {
        const color = item.theme?.[theme] ?? item.color;
        return color && SAFE_COLOR.test(color) ? `  --color-${key}: ${color};` : null;
      })
      .filter(Boolean)
      .join("\n");

  // Plain `color` entries are the same in both themes, so dark rules are only
  // written when some entry carries a light/dark pair.
  const themed = colorConfig.some(([, item]) => item.theme);
  const themes: ChartTheme[] = themed ? ["light", "dark"] : ["light"];
  const css = themes
    .flatMap((theme) => {
      const declarations = declarationsFor(theme);
      return THEMES[theme].map((selector) => {
        const rule = `${selector.prefix ? `${selector.prefix} ` : ""}[data-chart=${id}] {\n${declarations}\n}`;
        return selector.media ? `@media ${selector.media} {\n${rule}\n}` : rule;
      });
    })
    .join("\n");

  return <style dangerouslySetInnerHTML={{ __html: css }} />;
}

export const ChartTooltip = RechartsPrimitive.Tooltip;

type TooltipFormatter = (
  value: TooltipValueType | undefined,
  name: string | number | undefined,
  item: TooltipPayloadEntry,
  index: number,
  payload: unknown,
) => ReactNode;

export type ChartTooltipContentProps = {
  active?: boolean;
  payload?: ReadonlyArray<TooltipPayloadEntry>;
  label?: ReactNode;
  className?: string;
  labelClassName?: string;
  labelFormatter?: (label: ReactNode, payload: ReadonlyArray<TooltipPayloadEntry>) => ReactNode;
  formatter?: TooltipFormatter;
  color?: string;
  hideLabel?: boolean;
  hideIndicator?: boolean;
  indicator?: "line" | "dot" | "dashed";
  nameKey?: string;
  labelKey?: string;
};

// Recharts clones this element with its own props (coordinate, viewBox, …),
// so nothing is spread onto the DOM.
export function ChartTooltipContent({
  active,
  payload,
  className,
  indicator = "dot",
  hideLabel = false,
  hideIndicator = false,
  label,
  labelFormatter,
  labelClassName,
  formatter,
  color,
  nameKey,
  labelKey,
}: ChartTooltipContentProps) {
  const { config, numbers } = useChart();

  const tooltipLabel = useMemo(() => {
    if (hideLabel || !payload?.length) return null;
    const [item] = payload;
    const key = `${labelKey ?? item?.dataKey ?? item?.name ?? "value"}`;
    const itemConfig = getPayloadConfigFromPayload(config, item, key);
    const value = !labelKey && typeof label === "string" ? (config[label]?.label ?? label) : itemConfig?.label;
    if (labelFormatter) return <div className={cn("font-medium", labelClassName)}>{labelFormatter(value, payload)}</div>;
    if (!value) return null;
    return <div className={cn("font-medium", labelClassName)}>{value}</div>;
  }, [label, labelFormatter, payload, hideLabel, labelClassName, config, labelKey]);

  if (!active || !payload?.length) return null;

  const nestLabel = payload.length === 1 && indicator !== "dot";

  return (
    <div className={cn("grid min-w-[8rem] items-start gap-1.5 rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs leading-normal", className)}>
      {!nestLabel ? tooltipLabel : null}
      <div className="grid gap-1.5">
        {payload
          .filter((item) => item.type !== "none")
          .map((item, index) => {
            const key = `${nameKey ?? item.name ?? item.dataKey ?? "value"}`;
            const itemConfig = getPayloadConfigFromPayload(config, item, key);
            const payloadRecord = item.payload as Record<string, unknown> | undefined;
            const fill = typeof payloadRecord?.fill === "string" ? payloadRecord.fill : undefined;
            const indicatorColor = color ?? fill ?? item.color;

            return (
              <div
                key={`${item.dataKey ?? index}`}
                className={cn("flex w-full flex-wrap items-stretch gap-2 [&>svg]:size-2.5 [&>svg]:text-muted-foreground", indicator === "dot" && "items-center")}
              >
                {formatter && item.value !== undefined && item.name !== undefined ? (
                  formatter(item.value, item.name, item, index, item.payload)
                ) : (
                  <>
                    {itemConfig?.icon ? (
                      <itemConfig.icon />
                    ) : (
                      !hideIndicator && (
                        <div
                          className={cn("shrink-0 rounded-[2px] border-(--color-border) bg-(--color-bg)", {
                            "size-2.5": indicator === "dot",
                            "w-1": indicator === "line",
                            "w-0 border-[1.5px] border-dashed bg-transparent": indicator === "dashed",
                            "my-0.5": nestLabel && indicator === "dashed",
                          })}
                          style={{ "--color-bg": indicatorColor, "--color-border": indicatorColor } as CSSProperties}
                        />
                      )
                    )}
                    <div className={cn("flex flex-1 justify-between gap-2", nestLabel ? "items-end" : "items-center")}>
                      <div className="grid gap-1.5">
                        {nestLabel ? tooltipLabel : null}
                        <span className="text-muted-foreground">{itemConfig?.label ?? item.name}</span>
                      </div>
                      {item.value !== undefined && item.value !== null ? (
                        <span className="font-medium tabular-nums text-foreground">
                          {typeof item.value === "number" ? numbers.format(item.value) : String(item.value)}
                        </span>
                      ) : null}
                    </div>
                  </>
                )}
              </div>
            );
          })}
      </div>
    </div>
  );
}

export const ChartLegend = RechartsPrimitive.Legend;

export type ChartLegendContentProps = {
  className?: string;
  hideIcon?: boolean;
  payload?: ReadonlyArray<LegendPayload>;
  verticalAlign?: "top" | "bottom" | "middle";
  nameKey?: string;
};

export function ChartLegendContent({ className, hideIcon = false, payload, verticalAlign = "bottom", nameKey }: ChartLegendContentProps) {
  const { config } = useChart();
  if (!payload?.length) return null;

  return (
    <div className={cn("flex flex-wrap items-center justify-center gap-x-4 gap-y-1 leading-normal", verticalAlign === "top" ? "pb-3" : "pt-3", className)}>
      {payload
        .filter((item) => item.type !== "none")
        .map((item, index) => {
          const key = `${nameKey ?? item.dataKey ?? "value"}`;
          const itemConfig = getPayloadConfigFromPayload(config, item, key);
          return (
            <div key={`${item.value ?? index}`} className="flex items-center gap-1.5 [&>svg]:size-3 [&>svg]:text-muted-foreground">
              {itemConfig?.icon && !hideIcon ? (
                <itemConfig.icon />
              ) : (
                <div className="size-2 shrink-0 rounded-[2px]" style={{ backgroundColor: item.color }} />
              )}
              {itemConfig?.label ?? item.value}
            </div>
          );
        })}
    </div>
  );
}

function getPayloadConfigFromPayload(config: ChartConfig, payload: unknown, key: string) {
  if (typeof payload !== "object" || payload === null) return undefined;
  const record = payload as Record<string, unknown>;
  const inner = typeof record.payload === "object" && record.payload !== null ? (record.payload as Record<string, unknown>) : undefined;

  let configLabelKey = key;
  if (typeof record[key] === "string") configLabelKey = record[key] as string;
  else if (inner && typeof inner[key] === "string") configLabelKey = inner[key] as string;

  return configLabelKey in config ? config[configLabelKey] : config[key];
}
