"use client";

import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { chartNumberFormat, ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';
import type { ChartBodyProps } from '../ChartCard';

// Loaded only through ChartCard's next/dynamic import. Flat fills (no gradients),
// no animation, colours from the grayscale --chart ramp that ChartCard assigns.
export default function AreaTrendChart({ data, series, locale, stacked }: ChartBodyProps) {
  const config: ChartConfig = Object.fromEntries(series.map((item) => [item.key, { label: item.label, color: item.color }]));
  // Axis ticks abbreviate (1,5 N / 1.5K); the tooltip shows the full value in the same locale.
  const ticks = chartNumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 });
  return <ChartContainer config={config} locale={locale} className="aspect-auto size-full">
    <AreaChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }} accessibilityLayer={false}>
      <CartesianGrid vertical={false} />
      <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} />
      <YAxis tickLine={false} axisLine={false} width={40} allowDecimals={false} tickFormatter={(value: number) => ticks.format(value)} />
      <ChartTooltip cursor={false} content={<ChartTooltipContent indicator="line" />} />
      {series.length > 1 ? <ChartLegend itemSorter={null} content={<ChartLegendContent />} /> : null}
      {series.map((item) => <Area
        key={item.key}
        dataKey={item.key}
        name={item.key}
        type="monotone"
        stroke={item.color}
        strokeWidth={2}
        fill={item.fill === false ? 'none' : item.color}
        fillOpacity={item.fill === false ? 0 : 0.12}
        strokeDasharray={item.fill === false ? '4 4' : undefined}
        stackId={stacked ? 'stack' : undefined}
        connectNulls={false}
        isAnimationActive={false}
      />)}
    </AreaChart>
  </ChartContainer>;
}
