import Link from 'next/link';
import { Fragment, type ReactNode } from 'react';
import { StateTag, type Tone } from '../../ui/primitives';

export type DirectoryRow = {
  id: string;
  /** Mono part code or a type tag. */
  lead: ReactNode;
  title: string;
  /** One line of summary under the title. */
  summary?: string;
  /** Mono meta, joined with " · ". */
  meta?: ReactNode[];
  status?: { tone: Tone; label: string } | null;
  /** Content of the optional extra column (hidden below 760px), e.g. "Depends on". */
  extra?: ReactNode;
  href: string;
  /** Visible link text, e.g. "Open". */
  cta: string;
  /** Accessible link name, e.g. "Open Robotics 101". */
  ctaLabel: string;
};

export type DirectoryTableProps = {
  caption: string;
  columns: { lead: string; title: string; status?: string; extra?: string; cta: string };
  rows: DirectoryRow[];
  titleAs?: 'h2' | 'h3';
};

/**
 * The directory spec table: lead | title (summary, meta) | extra | status | one row link. Below
 * 760px rows stack into the lead/status, body, meter and trail areas (workspace.css).
 */
export function DirectoryTable({ caption, columns, rows, titleAs: Title = 'h3' }: DirectoryTableProps) {
  return <table className="vf-spec vf-l-dir-table" data-stack="">
    <caption className="sr-only">{caption}</caption>
    <thead><tr>
      <th scope="col">{columns.lead}</th>
      <th scope="col">{columns.title}</th>
      {columns.extra ? <th scope="col" data-col="hide-sm">{columns.extra}</th> : null}
      {columns.status ? <th scope="col">{columns.status}</th> : null}
      <th scope="col" className="vf-num">{columns.cta}</th>
    </tr></thead>
    <tbody>{rows.map(row => <tr key={row.id}>
      <td data-slot="lead" className="vf-part">{row.lead}</td>
      <td data-slot="body">
        <Title className="vf-l-row-title">{row.title}</Title>
        {row.summary ? <p className="vf-l-row-summary">{row.summary}</p> : null}
        {row.meta?.length ? <p className="vf-meta vf-l-row-meta">{row.meta.map((entry, index) => <Fragment key={index}>
          {index > 0 ? <span aria-hidden="true"> · </span> : null}{entry}
        </Fragment>)}</p> : null}
      </td>
      {columns.extra ? <td data-col="hide-sm">{row.extra ?? <span className="vf-meta">—</span>}</td> : null}
      {columns.status ? <td data-slot="status">{row.status ? <StateTag tone={row.status.tone}>{row.status.label}</StateTag> : null}</td> : null}
      <td data-slot="trail" className="vf-l-next-cell">
        <Link href={row.href} className="vf-l-next" aria-label={row.ctaLabel}>{row.cta}<span className="vf-l-arrow" aria-hidden="true">&nbsp;→</span></Link>
      </td>
    </tr>)}</tbody>
  </table>;
}
