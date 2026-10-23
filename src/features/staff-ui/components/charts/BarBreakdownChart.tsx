"use client";

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { chartNumberFormat, ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';
import type { ChartBodyProps } from '../ChartCard';

// Loaded only through ChartCard's next/dynamic import. 'rows' draws horizontal
// bars (rankings such as schools by active learners); stacking is optional.
export default function BarBreakdownChart({ data, series, locale, stacked, orientation = 'columns' }: ChartBodyProps) {
  const config: ChartConfig = Object.fromEntries(series.map((item) => [item.key, { label: item.label, color: item.color }]));
  // Axis ticks abbreviate (1,5 N / 1.5K); the tooltip shows the full value in the same locale.
  const ticks = chartNumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 });
  const rows = orientation === 'rows';
  return <ChartContainer config={config} locale={locale} className="aspect-auto size-full">
    <BarChart data={data} layout={rows ? 'vertical' : 'horizontal'} margin={{ top: 4, right: 8, bottom: 0, left: 0 }} accessibilityLayer={false}>
      <CartesianGrid vertical={rows} horizontal={!rows} />
      {rows
        ? <>
          <XAxis type="number" tickLine={false} axisLine={false} allowDecimals={false} tickFormatter={(value: number) => ticks.format(value)} />
          <YAxis type="category" dataKey="label" tickLine={false} axisLine={false} width={120} />
        </>
        : <>
          <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={16} />
          <YAxis tickLine={false} axisLine={false} width={40} allowDecimals={false} tickFormatter={(value: number) => ticks.format(value)} />
        </>}
      <ChartTooltip cursor={false} content={<ChartTooltipContent indicator="dot" />} />
      {/* itemSorter={null}: the legend follows the series (stack) order, not Recharts' alphabetical default. */}
      {series.length > 1 ? <ChartLegend itemSorter={null} content={<ChartLegendContent />} /> : null}
      {series.map((item, index) => <Bar
        key={item.key}
        dataKey={item.key}
        name={item.key}
        fill={item.color}
        // A hairline in the card colour between stacked segments keeps adjacent greys apart.
        stroke={stacked ? 'var(--card)' : undefined}
        strokeWidth={stacked ? 1 : undefined}
        stackId={stacked ? 'stack' : undefined}
        radius={stacked && index < series.length - 1 ? 0 : 4}
        maxBarSize={rows ? 24 : 40}
        isAnimationActive={false}
      />)}
    </BarChart>
  </ChartContainer>;
}
