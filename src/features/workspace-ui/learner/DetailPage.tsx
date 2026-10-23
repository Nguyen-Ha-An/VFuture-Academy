import { useId, type ReactNode } from 'react';
import { StateTag, type Tone } from '../ui/primitives';

export type ActionPanelProps = {
  title: string;
  titleId?: string;
  body?: ReactNode;
  status?: { tone: Tone; label: string };
  /** The one primary action (a vf-btn link or button); null when there is none yet. */
  action: ReactNode;
  note?: ReactNode;
};

/** The detail page's next step: a card with a 2px signal left rule. */
export function ActionPanel({ title, titleId, body, status, action, note }: ActionPanelProps) {
  const generated = useId();
  const id = titleId ?? `action-${generated.replace(/[^a-zA-Z0-9_-]/g, '')}`;
  return <section className="vf-l-action" aria-labelledby={id}>
    <div className="vf-l-action-head">
      <h2 id={id} className="vf-h3 vf-l-action-title">{title}</h2>
      {status ? <StateTag tone={status.tone}>{status.label}</StateTag> : null}
    </div>
    {body ? <div className="vf-l-action-body">{body}</div> : null}
    {action ? <div className="vf-l-action-cta">{action}</div> : null}
    {note ? <div className="vf-meta vf-l-action-note">{note}</div> : null}
  </section>;
}

export type DetailPageProps = {
  /** The page header (PageHeader with crumbs). */
  header: ReactNode;
  /** A one-off notice (e.g. "Proposal submitted") under the header, before the main content. */
  notice?: ReactNode;
  action?: ActionPanelProps;
  aside?: ReactNode;
  /** Accessible name for the aside landmark. */
  asideLabel?: string;
  children: ReactNode;
};

/**
 * A learner detail page on the split frame: head, then the action panel and aside in the 280px
 * column from 1100px (stacked in source order below that), and the main column.
 */
export function DetailPage({ header, notice, action, aside, asideLabel, children }: DetailPageProps) {
  const hasAside = Boolean(aside) || Boolean(action);
  return <article className="vf-l-frame vf-l-split vf-l-detail" data-aside={hasAside ? '' : undefined}>
    <div data-area="head">{header}{notice}</div>
    {action ? <div data-area="action"><ActionPanel {...action} /></div> : null}
    <div data-area="main">{children}</div>
    {aside ? <aside data-area="aside" aria-label={asideLabel}>{aside}</aside> : null}
  </article>;
}
