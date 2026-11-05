// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { css } from '@emotion/react';
import { createCanvasEmotionRegistry } from '@/features/canvas/ui/emotion-registry';

afterEach(() => { document.head.querySelectorAll('[data-registry-test],style[data-emotion^="academy-instui"]').forEach(node => node.remove()); });

it('uses the document script nonce rather than a newer RSC request nonce for dynamic client CSS', () => {
  const script = document.createElement('script'); script.nonce = 'document-nonce'; script.dataset.registryTest = ''; document.head.append(script);
  const registry = createCanvasEmotionRegistry('new-rsc-request-nonce');
  expect(registry.nonce).toBe('document-nonce'); expect(registry.cache.sheet.nonce).toBe('document-nonce');
  const style = css({ color: 'teal' });
  registry.cache.insert(`.academy-instui-${style.name}`, style, registry.cache.sheet, true);
  expect(registry.cache.sheet.tags.length).toBeGreaterThan(0);
  expect(registry.cache.sheet.tags.every(tag => tag.nonce === 'document-nonce')).toBe(true);
  expect(registry.flush()).toEqual([]);
});

it('hydrates ordinary class names without consuming the separate Global style identity', () => {
  const ordinary = document.createElement('style'); ordinary.dataset.emotion = 'academy-instui server-class'; ordinary.textContent = '.academy-instui-server-class{color:teal}'; document.head.append(ordinary);
  const global = document.createElement('style'); global.dataset.emotion = 'academy-instui-global server-global'; global.textContent = 'body{margin:0}'; document.head.append(global);
  const registry = createCanvasEmotionRegistry('fallback-request-nonce');
  expect(registry.nonce).toBe('fallback-request-nonce');
  expect(registry.cache.inserted['server-class']).toBe(true);
  expect(registry.cache.inserted['server-global']).toBeUndefined();
  expect(global.dataset.emotion).toBe('academy-instui-global server-global');
  expect(registry.flush()).toEqual([]);
});
