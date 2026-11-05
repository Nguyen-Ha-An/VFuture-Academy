'use client';

import Link from 'next/link';
import { useId } from 'react';
import { CanvasTable as Table, CanvasResponsive as Responsive } from '@/features/canvas/ui';
import { canvasCopy, canvasDate } from './canvas-copy';
import type { CanvasResult } from './canvas-model';

/** Released result records only; no inferred course total or weighted grade. */
export function CanvasResultTable({ results, locale, showCourse = true }: { results: CanvasResult[]; locale: string; showCourse?: boolean }) {
  const id = useId();
  const copy = canvasCopy(locale);
  return <div className="canvas-native-results"><Responsive match="element" query={{ compact: { maxWidth: '640px' }, wide: { minWidth: '641px' } }}>
    {(_props, matches) => <Table caption={() => copy.results} layout={matches?.includes('compact') ? 'stacked' : 'auto'} hover>
      <Table.Head><Table.Row><Table.ColHeader id={`${id}-activity`}>{copy.activity}</Table.ColHeader>{showCourse && <Table.ColHeader id={`${id}-course`}>{copy.course}</Table.ColHeader>}<Table.ColHeader id={`${id}-score`}>{copy.score}</Table.ColHeader><Table.ColHeader id={`${id}-recorded`}>{copy.recorded}</Table.ColHeader></Table.Row></Table.Head>
      <Table.Body>{results.map(result => <Table.Row key={result.id}>
        <Table.RowHeader><Link href={result.href}>{result.title}</Link></Table.RowHeader>
        {showCourse && <Table.Cell header={copy.course}>{result.courseTitle}</Table.Cell>}
        <Table.Cell header={copy.score}><span className="canvas-result-score">{result.score !== null ? <>{result.score}{result.maxScore !== null ? ` / ${result.maxScore}` : ''}</> : '—'}</span></Table.Cell>
        <Table.Cell header={copy.recorded}>{result.recordedAt ? <time dateTime={result.recordedAt}>{canvasDate(result.recordedAt, locale, false)}</time> : '—'}</Table.Cell>
      </Table.Row>)}</Table.Body>
    </Table>}
  </Responsive></div>;
}
