import { useId, type ComponentProps, type ReactNode } from "react";
import { Card, CardAction, CardDescription, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/ui-cn";

export type DataCardProps = Omit<ComponentProps<"section">, "title"> & {
  title?: ReactNode;
  description?: ReactNode;
  /** Header actions, e.g. a primary "New" button; sits top-right of the title. */
  actions?: ReactNode;
  /** Usually a DataToolbar; rendered between the header and the content. */
  toolbar?: ReactNode;
  /** Usually a DataPagination; rendered under the content with a hairline. */
  footer?: ReactNode;
  /** Names the section when there is no visible title. */
  "aria-label"?: string;
  /** Heading level of the title; h2 by default because the page owns the h1. */
  headingLevel?: 2 | 3;
  contentClassName?: string;
};

/**
 * The list container on every staff page: header, toolbar, table, pagination.
 * Presentational (no "use client") so server pages can render it; the table content
 * runs edge to edge and the toolbar and footer carry the 24px side padding.
 */
export function DataCard({
  title,
  description,
  actions,
  toolbar,
  footer,
  headingLevel = 2,
  className,
  contentClassName,
  children,
  "aria-label": ariaLabel,
  ...props
}: DataCardProps) {
  const generatedId = useId();
  const titleId = `${generatedId}-title`;
  const Heading = `h${headingLevel}` as const;
  const hasHeader = Boolean(title || description || actions);
  return (
    <section
      data-slot="data-card"
      aria-labelledby={title ? titleId : undefined}
      aria-label={title ? undefined : ariaLabel}
      className={cn("min-w-0", className)}
      {...props}
    >
      <Card className="gap-0 py-0">
        {hasHeader ? (
          <CardHeader className="py-5 max-sm:has-data-[slot=card-action]:grid-cols-1">
            {title ? (
              <Heading id={titleId} className="text-sm font-medium leading-snug text-card-foreground">
                {title}
              </Heading>
            ) : null}
            {description ? <CardDescription>{description}</CardDescription> : null}
            {/* Below 640px the action drops under the title so the title and description keep the width. */}
            {actions ? <CardAction className="flex flex-wrap items-center gap-2 max-sm:col-start-1 max-sm:row-span-1 max-sm:row-start-auto max-sm:justify-self-start">{actions}</CardAction> : null}
          </CardHeader>
        ) : null}
        {toolbar ? <div className={cn("px-6 pb-4", !hasHeader && "pt-5")}>{toolbar}</div> : null}
        <div data-slot="data-card-content" className={cn("min-w-0 border-t border-border [&_tr>*:first-child]:pl-6 [&_tr>*:last-child]:pr-6 [&_tbody_tr:last-child]:border-0", contentClassName)}>
          {children}
        </div>
        {footer ? <div className="border-t border-border px-6 py-3">{footer}</div> : null}
      </Card>
    </section>
  );
}
