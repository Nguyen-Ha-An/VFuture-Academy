// Insight half of the staff kit. The data barrel (index.ts) re-exports this file.
// Chart bodies (charts/*) are deliberately not exported: only ChartCard loads them, lazily.
export { StatCard, type StatCardProps, type StatDelta } from './StatCard';
export { StatGrid, type StatGridProps } from './StatGrid';
export { PipelineStrip, insightToneClasses, type InsightTone, type PipelineStage, type PipelineStripProps } from './PipelineStrip';
export { ActivityFeed, actorInitials, type ActivityFeedProps, type ActivityItem } from './ActivityFeed';
export { TimelineCard, type TimelineCardProps, type TimelineItem } from './TimelineCard';
export { ReadinessCard, type ReadinessCardProps, type ReadinessItem, type ReadinessStatus } from './ReadinessCard';
export { ChartCard, seriesColor, type ChartCardProps, type ChartRow, type ChartSeries } from './ChartCard';
export { SectionCard, type SectionCardProps } from './SectionCard';
export { FileGrid, type FileGridItem, type FileGridProps, type FileKind } from './FileGrid';
