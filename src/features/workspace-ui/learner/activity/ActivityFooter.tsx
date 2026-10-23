import type { ReactNode } from 'react';

import { StateTag, type Tone } from '../../ui/primitives';

export type ActivityFooterProps = {
  status?: { tone: Tone; label: string };
  note?: ReactNode;
  /** The single primary action, optionally preceded by a secondary one. */
  action?: ReactNode;
  children?: ReactNode;
};

/** One footer per activity: the save state on the left, the one primary action on the right. */
export function ActivityFooter({ status, note, action, children }: ActivityFooterProps) {
  return <div className="vf-activity-footer" data-activity-footer>
    <div className="vf-activity-footer-state" aria-live="polite">
      {status ? <StateTag tone={status.tone}>{status.label}</StateTag> : null}
      {note ? <span className="vf-meta">{note}</span> : null}
    </div>
    {action ? <div className="vf-activity-footer-actions">{action}</div> : null}
    {children}
  </div>;
}
