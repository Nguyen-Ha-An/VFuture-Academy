'use client';

import { useId, type ComponentProps, type ReactNode } from 'react';
import { Table } from '@instructure/ui-table/v11_7';
import { CanvasResponsive } from './CanvasResponsive';

// Native Responsive initially omits its children as an SSR optimisation. Tables
// need their data in the server response too; render the same auto table on the
// server and initial hydration, then let the native measurement choose stacking.
class DataTableResponsive extends CanvasResponsive {
  override state: CanvasResponsive['state'] = { matches: [], hasRendered: true };
}

export type CanvasDataColumn<T> = {
  key: string;
  label: string;
  width?: string;
  render: (row: T) => ReactNode;
};

/** Native table composition keeps every column and its label in the stacked layout. */
export function CanvasDataTable<T>({ caption, rows, columns, rowKey, rowProps, stackedBelow = 48 }: {
  caption: string;
  rows: readonly T[];
  columns: readonly CanvasDataColumn<T>[];
  rowKey: (row: T) => string;
  rowProps?: (row: T) => Omit<ComponentProps<typeof Table.Row>, 'children'> & { 'data-state'?: string };
  stackedBelow?: number;
}) {
  const id = useId();
  return <DataTableResponsive
    query={{ small: { maxWidth: `${stackedBelow}rem` }, large: { minWidth: `${stackedBelow + 0.01}rem` } }}
    props={{ small: { layout: 'stacked' }, large: { layout: 'auto' } }}
  >{(responsive) => <Table caption={() => caption} layout={(responsive?.layout ?? 'auto') as 'stacked' | 'auto'} hover>
    <Table.Head><Table.Row>{columns.map((column) => <Table.ColHeader key={column.key} id={`${id}-${column.key}`} width={column.width}>{column.label}</Table.ColHeader>)}</Table.Row></Table.Head>
    <Table.Body>{rows.map((row) => <Table.Row key={rowKey(row)} {...rowProps?.(row)}>
      {columns.map((column, index) => index === 0
        ? <Table.RowHeader key={column.key}><div className="min-w-0 whitespace-normal [overflow-wrap:anywhere]">{column.render(row)}</div></Table.RowHeader>
        : <Table.Cell key={column.key}><div className="min-w-0 whitespace-normal [overflow-wrap:anywhere]">{column.render(row)}</div></Table.Cell>)}
    </Table.Row>)}</Table.Body>
  </Table>}</DataTableResponsive>;
}
