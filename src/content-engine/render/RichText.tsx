'use client';
import { createContext, useContext, type CSSProperties, type ReactNode } from 'react';
import type { Run } from '../schema/inline';
import { isBlankRun } from '../schema/inline';
import { asText } from './text';

/** Lets a question renderer supply the interactive control for every blank run in its stem. */
export const BlankRenderContext = createContext<((blankId: string, size?: 'sm' | 'md' | 'lg') => ReactNode) | null>(null);

/**
 * Annotations compose rather than replace each other. The element that directly
 * contains the text is chosen by priority (code → sub → sup → bold → span) and
 * carries the whitespace and colour styling; the remaining annotations wrap it.
 */
export function RichText({ runs, renderBlank }: { runs: Run[]; renderBlank?: (blankId: string, size?: 'sm' | 'md' | 'lg') => ReactNode }) {
  const ctxRender = useContext(BlankRenderContext);
  const rb = renderBlank ?? ctxRender ?? undefined;
  return (
    <>
      {runs.map((run, i) => {
        if (isBlankRun(run)) return <span key={i} className="inline-block align-baseline">{rb ? rb(run.blank, run.size) : <span aria-hidden="true">____</span>}</span>;
        const a = run.annotations ?? {};
        const text = asText(run.text);
        const style = a.color ? ({ color: a.color } as CSSProperties) : undefined;
        let node: ReactNode;
        let innerIsStrong = false;
        if (a.code) node = <code className="whitespace-pre-wrap rounded bg-muted px-1 font-mono text-[0.9em]" style={style}>{text}</code>;
        else if (a.sub) node = <sub className="whitespace-pre-wrap" style={style}>{text}</sub>;
        else if (a.sup) node = <sup className="whitespace-pre-wrap" style={style}>{text}</sup>;
        else if (a.bold) { node = <strong className="whitespace-pre-wrap" style={style}>{text}</strong>; innerIsStrong = true; }
        else node = <span className="whitespace-pre-wrap" style={style}>{text}</span>;
        if (a.bold && !innerIsStrong) node = <strong>{node}</strong>;
        if (a.italic) node = <em>{node}</em>;
        if (a.underline) node = <u>{node}</u>;
        if (a.strike) node = <s>{node}</s>;
        if (a.link) node = <a href={a.link.href} target={a.link.target} rel="noopener noreferrer" className="text-primary underline decoration-1 underline-offset-2">{node}</a>;
        return <span key={i}>{node}</span>;
      })}
    </>
  );
}
