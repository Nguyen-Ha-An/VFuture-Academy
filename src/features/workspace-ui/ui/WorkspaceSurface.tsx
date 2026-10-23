import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { workspaceThemeAttribute, type WorkspaceTheme } from '../theme';
import '../workspace.css';

/**
 * Root of every Calibration Bench surface. Its presence switches the document to the
 * workspace tokens (workspace.css uses :root:has(.vf-workspace)), including portals.
 */
export function WorkspaceSurface({ theme, density = 'comfortable', className, children }: { theme: WorkspaceTheme; density?: 'comfortable' | 'compact'; className?: string; children: ReactNode }) {
  return <div className={cn('vf-workspace', className)} data-theme={workspaceThemeAttribute(theme)} data-density={density}>{children}</div>;
}
