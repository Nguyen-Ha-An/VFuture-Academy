'use client';

import { useId, useSyncExternalStore, type ReactNode } from 'react';
import { Table } from '@instructure/ui-table/v11_7';
import './support.css';

const mediaQuery = '(max-width: 760px)';
function subscribe(callback: () => void) {
  if (typeof window.matchMedia !== 'function') return () => {};
  const query = window.matchMedia(mediaQuery);
  query.addEventListener('change', callback);
  return () => query.removeEventListener('change', callback);
}

/** Native InstUI table retains every field when rows stack on a narrow viewport. */
export function SupportTable({ caption, columns, rows }: {
  caption: string;
  columns: { key: string; label: string }[];
  rows: { key: string; current?: boolean; cells: ReactNode[] }[];
}) {
  const id = useId();
  const narrow = useSyncExternalStore(subscribe, () => typeof window.matchMedia === 'function' && window.matchMedia(mediaQuery).matches, () => false);
  return <div className="canvas-support-table"><Table caption={() => caption} layout={narrow ? 'stacked' : 'auto'}>
    <Table.Head><Table.Row>{columns.map(column => <Table.ColHeader key={column.key} id={`${id}-${column.key}`}>{column.label}</Table.ColHeader>)}</Table.Row></Table.Head>
    <Table.Body>{rows.map(row => <Table.Row key={row.key} aria-current={row.current || undefined}>{row.cells.map((cell, index) => <Table.Cell key={columns[index].key}>{cell}</Table.Cell>)}</Table.Row>)}</Table.Body>
  </Table></div>;
}
