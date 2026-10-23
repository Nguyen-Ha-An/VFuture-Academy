import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/ui-cn";

export type EmptyStateProps = Omit<ComponentProps<"div">, "title"> & {
  /** A decorative icon element, e.g. `<InboxIcon />`; it is hidden from assistive tech. */
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  /** Usually one Button or Link that resolves the empty state. */
  action?: ReactNode;
  /** Heading level for the title; defaults to h3 because the state sits inside a card. */
  headingLevel?: 2 | 3 | 4;
};

/** Presentational (no "use client"): strings come in as props so server pages can render it. */
export function EmptyState({ icon, title, description, action, headingLevel = 3, className, ...props }: EmptyStateProps) {
  const Heading = `h${headingLevel}` as const;
  return (
    <div
      data-slot="empty-state"
      className={cn("flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border px-6 py-10 text-center", className)}
      {...props}
    >
      {icon ? (
        <div aria-hidden="true" className="flex size-10 items-center justify-center rounded-md bg-muted text-muted-foreground [&_svg]:size-5">
          {icon}
        </div>
      ) : null}
      <div className="flex max-w-sm flex-col gap-1">
        <Heading className="text-sm font-medium leading-snug text-foreground">{title}</Heading>
        {description ? <p className="text-sm leading-normal text-muted-foreground">{description}</p> : null}
      </div>
      {action ? <div className="mt-1 flex flex-wrap items-center justify-center gap-2">{action}</div> : null}
    </div>
  );
}
