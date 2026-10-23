'use client';
import CodeMirror from '@uiw/react-codemirror';
import { EditorView } from '@codemirror/view';
import type { Extension } from '@codemirror/state';
import { json } from '@codemirror/lang-json';
import { python } from '@codemirror/lang-python';
import { javascript } from '@codemirror/lang-javascript';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { sql } from '@codemirror/lang-sql';
import { markdown } from '@codemirror/lang-markdown';

export function languageExtension(lang: string): Extension[] {
  switch (lang) {
    case 'python': return [python()];
    case 'javascript': return [javascript()];
    case 'typescript': return [javascript({ typescript: true })];
    case 'html': return [html()];
    case 'css': return [css()];
    case 'sql': return [sql()];
    case 'json': return [json()];
    case 'markdown': return [markdown()];
    default: return [];
  }
}
export function CodeEditor({ value, language, onChange, disabled, ariaLabel, minHeight = '160px' }: { value: string; language: string; onChange: (v: string) => void; disabled?: boolean; ariaLabel: string; minHeight?: string }) {
  const extensions = [...languageExtension(language), EditorView.contentAttributes.of({ 'aria-label': ariaLabel })];
  return <CodeMirror aria-label={ariaLabel} value={value} editable={!disabled} readOnly={disabled} minHeight={minHeight} extensions={extensions} onChange={onChange} basicSetup={{ lineNumbers: true, foldGutter: false }} className="rounded-md border border-input text-sm" />;
}
