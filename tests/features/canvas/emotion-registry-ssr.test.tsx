// @vitest-environment node
import { PassThrough } from 'node:stream';
import { Fragment, Suspense, type ReactNode } from 'react';
import { renderToPipeableStream, renderToStaticMarkup, renderToString } from 'react-dom/server';
import { Global, css } from '@emotion/react';
import { CacheProvider } from '@instructure/emotion';
import { ServerInsertedHTMLContext } from 'next/dist/shared/lib/server-inserted-html.shared-runtime';
import { describe, expect, it } from 'vitest';
import { CanvasProvider } from '@/features/canvas/ui/CanvasProvider';
import { CanvasButton } from '@/features/canvas/ui/controls';
import { createCanvasEmotionRegistry } from '@/features/canvas/ui/emotion-registry';

function flush(callbacks: Set<() => ReactNode>) {
  return renderToStaticMarkup(<>{[...callbacks].map((callback, index) => <Fragment key={index}>{callback()}</Fragment>)}</>);
}
function request(nonce: string) {
  const callbacks = new Set<() => ReactNode>();
  const html = renderToString(<ServerInsertedHTMLContext.Provider value={callback => { callbacks.add(callback); }}>
    <CanvasProvider theme="light" nonce={nonce}><Global styles={{ body: { margin: 0 } }} /><CanvasButton href="/app/courses">Browse courses</CanvasButton></CanvasProvider>
  </ServerInsertedHTMLContext.Provider>);
  return { html, styles: () => flush(callbacks) };
}
function names(markup: string) {
  return [...markup.matchAll(/data-emotion="[^"]*? ([^"]+)"/g)].flatMap(match => match[1]!.split(' '));
}

describe('request-local Canvas Emotion SSR registry', () => {
  it('uses the real Next insertion hook and keeps ordinary/global styles out of component markup', () => {
    const rendered = request('request-nonce-one');
    expect(rendered.html).toContain('Browse courses');
    expect(rendered.html).toContain('<a');
    expect(rendered.html).not.toMatch(/<style[^>]*data-emotion/);
    const head = rendered.styles();
    expect(head).toContain('data-emotion="academy-instui ');
    expect(head).toContain('data-emotion="academy-instui-global ');
    expect(head).toContain('nonce="request-nonce-one"');
    expect(head).toContain('body{margin:0;}');
    expect(rendered.styles()).toBe('');
  });

  it('isolates independent request caches and nonces instead of losing styles to a previous request', () => {
    const first = request('nonce-a');
    const second = request('nonce-b');
    const a = first.styles();
    const b = second.styles();
    expect(names(a).length).toBeGreaterThan(0);
    expect(names(a)).toEqual(names(b));
    expect(a).toContain('nonce="nonce-a"'); expect(a).not.toContain('nonce="nonce-b"');
    expect(b).toContain('nonce="nonce-b"'); expect(b).not.toContain('nonce="nonce-a"');
  });

  it('drains new SSR rules exactly once while retaining the inserted cache for deduplication', () => {
    const registry = createCanvasEmotionRegistry('nonce');
    const ordinary = css({ color: 'rebeccapurple' });
    registry.cache.insert(`.academy-instui-${ordinary.name}`, ordinary, registry.cache.sheet, true);
    expect(registry.flush()).toEqual([{ name: ordinary.name, isGlobal: false, css: expect.stringContaining('rebeccapurple') }]);
    expect(registry.flush()).toEqual([]);
    renderToString(<CacheProvider value={registry.cache}><Global styles={{ html: { boxSizing: 'border-box' } }} /></CacheProvider>);
    const global = registry.flush();
    expect(global).toHaveLength(1); expect(global[0]?.isGlobal).toBe(true);
    expect(global[0]?.css).toContain('box-sizing:border-box');
    expect(typeof registry.cache.inserted[ordinary.name]).toBe('string');
  });

  it('collects a real suspended native link style after the shell flush without an inline style sibling', async () => {
    let ready = false;
    let release = () => {};
    const gate = new Promise<void>(resolve => { release = () => { ready = true; resolve(); }; });
    function LateLink() { if (!ready) throw gate; return <CanvasButton href="/app/courses" variant="outline">Late browse courses</CanvasButton>; }
    const callbacks = new Set<() => ReactNode>();
    const output = new PassThrough();
    const chunks: Buffer[] = [];
    const errors: unknown[] = [];
    output.on('data', (chunk: Buffer) => { chunks.push(chunk); });
    const ended = new Promise<void>((resolve, reject) => { output.once('end', resolve); output.once('error', reject); });
    let shellReady = () => {};
    let shellFailed: (error: unknown) => void = () => {};
    const shell = new Promise<void>((resolve, reject) => { shellReady = resolve; shellFailed = reject; });
    const stream = renderToPipeableStream(<ServerInsertedHTMLContext.Provider value={callback => { callbacks.add(callback); }}>
      <CanvasProvider theme="light" nonce="stream-nonce"><CanvasButton>Shell action</CanvasButton><Suspense fallback={<p>Waiting for data</p>}><LateLink /></Suspense></CanvasProvider>
    </ServerInsertedHTMLContext.Provider>, { onShellReady() { stream.pipe(output); shellReady(); }, onShellError: shellFailed, onError(error) { errors.push(error); } });
    try {
      await shell;
      const initial = flush(callbacks);
      expect(names(initial).length).toBeGreaterThan(0);
      release(); await ended;
      const late = flush(callbacks);
      expect(names(late).length).toBeGreaterThan(0);
      expect(names(late).filter(name => names(initial).includes(name))).toEqual([]);
      expect(late).toContain('nonce="stream-nonce"');
      const html = Buffer.concat(chunks).toString();
      expect(html).toContain('Late browse courses');
      expect(html).not.toMatch(/<style[^>]*data-emotion/);
      expect(flush(callbacks)).toBe(''); expect(errors).toEqual([]);
    } finally { release(); stream.abort(); output.destroy(); }
  });
});
