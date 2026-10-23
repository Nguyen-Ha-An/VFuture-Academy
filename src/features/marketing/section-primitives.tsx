import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function SectionHeading({
  eyebrow,
  title,
  description,
  align = "left",
}: {
  eyebrow: string;
  title: string;
  description?: string;
  align?: "left" | "center";
}) {
  return (
    <div className={cn("max-w-3xl", align === "center" && "mx-auto text-center")}>
      <p className="font-mono text-xs font-medium tracking-[0.2em] text-primary uppercase">
        {eyebrow}
      </p>
      <h2 className="mt-4 text-balance text-3xl font-semibold tracking-[-0.035em] sm:text-4xl lg:text-5xl">
        {title}
      </h2>
      {description ? (
        <p className="mt-5 max-w-2xl text-pretty text-base leading-7 text-muted-foreground sm:text-lg">
          {description}
        </p>
      ) : null}
    </div>
  );
}

export function MarketingSection({
  id,
  section,
  className,
  children,
}: {
  id?: string;
  section: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      data-marketing-section={section}
      className={cn("marketing-fade scroll-mt-24 py-20 sm:py-28", className)}
    >
      <div className="mx-auto w-full max-w-7xl px-5 sm:px-8 lg:px-10">{children}</div>
    </section>
  );
}

export const primaryLinkClass =
  "inline-flex min-h-12 items-center justify-center gap-2 rounded-md bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring";

export const secondaryLinkClass =
  "inline-flex min-h-12 items-center justify-center gap-2 rounded-md border border-border bg-background px-5 py-3 text-sm font-semibold text-foreground transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring";
