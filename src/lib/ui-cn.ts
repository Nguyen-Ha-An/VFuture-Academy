import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

// Class merging for the canonical shadcn primitives in src/components/ui.
// Later classes win over conflicting earlier ones, so callers can override a
// variant's utilities. `@/lib/utils` keeps its clsx-only `cn` for older code.
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
