import Link from 'next/link';
import { Fragment, type ReactNode } from 'react';
import { SupportTable } from '../../support/SupportTable';
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
 * Native responsive directory rows have one meaningful destination: the linked title heading.
 * Type, summary, metadata and optional columns remain readable without duplicate tab stops.
 */
export function DirectoryTable({ caption, columns, rows, titleAs: Title = 'h3' }: DirectoryTableProps) {
  const headers = [
    { key: 'lead', label: columns.lead },
    { key: 'title', label: columns.title },
    ...(columns.extra ? [{ key: 'extra', label: columns.extra }] : []),
    ...(columns.status ? [{ key: 'status', label: columns.status }] : []),
  ];
  return <SupportTable caption={caption} columns={headers} rows={rows.map(row => ({
    key: row.id,
    cells: [
      row.lead,
      <div key="body"><Link href={row.href} className="vf-l-row-link" aria-label={row.ctaLabel}><Title className="vf-l-row-title">{row.title}</Title></Link>
        {row.summary ? <p className="vf-l-row-summary">{row.summary}</p> : null}
        {row.meta?.length ? <p className="vf-meta vf-l-row-meta">{row.meta.map((entry, index) => <Fragment key={index}>
          {index > 0 ? <span aria-hidden="true"> · </span> : null}{entry}
        </Fragment>)}</p> : null}
      </div>,
      ...(columns.extra ? [row.extra ?? <span key="extra" className="vf-meta">—</span>] : []),
      ...(columns.status ? [row.status ? <StateTag key="status" tone={row.status.tone}>{row.status.label}</StateTag> : null] : []),
    ],
  }))} />;
}
