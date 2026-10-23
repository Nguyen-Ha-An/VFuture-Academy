'use client';
import { useEffect, useState } from 'react';
import type { CodeBlock } from '../../schema/types';
import type { BlockRendererProps } from '../registry';

/**
 * Dual themes: github-light stays the inline colour everywhere (public prose, the Studio
 * preview island), and globals.css swaps in `--shiki-dark` only under the dark learner and
 * staff themes. The wrapper's `data-code-block` is what those rules (and public prose) key on.
 */
type CodeThemes = { light: string; dark: string };
type Highlighter = { codeToHtml(code: string, o: { lang: string; themes: CodeThemes; defaultColor: 'light' }): string };
export const CODE_THEMES: CodeThemes = { light: 'github-light', dark: 'github-dark' };
let highlighterPromise: Promise<Highlighter> | null = null;
export function getHighlighter(): Promise<Highlighter> {
  highlighterPromise ??= import('shiki/bundle/web').then((m) => m.createHighlighter({ themes: [CODE_THEMES.light, CODE_THEMES.dark], langs: ['python', 'javascript', 'typescript', 'tsx', 'jsx', 'html', 'css', 'json', 'sql', 'bash', 'markdown', 'yaml'] }) as Promise<Highlighter>).catch((err) => { highlighterPromise = null; throw err; });
  return highlighterPromise;
}

export function Code({ block, runtime }: BlockRendererProps<CodeBlock>) {
  const [html, setHtml] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => { let alive = true; getHighlighter().then((h) => { if (alive) setHtml(h.codeToHtml(block.code, { lang: block.language === 'plaintext' ? 'text' : block.language, themes: CODE_THEMES, defaultColor: 'light' })); }).catch(() => {}); return () => { alive = false; }; }, [block.code, block.language]);
  const copy = async () => { try { await navigator.clipboard.writeText(block.code); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard unavailable */ } };
  const label = runtime.locale === 'vi' ? (copied ? 'Đã chép' : 'Chép mã') : copied ? 'Copied' : 'Copy code';
  return (
    <div data-code-block className="overflow-hidden rounded-md border border-border bg-muted text-sm">
      <div className="flex items-center justify-between border-b border-border px-3 py-1.5 text-xs text-muted-foreground"><span className="font-mono">{block.filename ?? block.language}</span><button type="button" onClick={copy} className="rounded-md px-2 py-0.5 hover:bg-background hover:text-foreground">{label}</button></div>
      {html ? <div className="overflow-x-auto p-3 [&_pre]:!bg-transparent" dangerouslySetInnerHTML={{ __html: html }} /> : <pre className="overflow-x-auto p-3"><code>{block.code}</code></pre>}
    </div>
  );
}
