/** Hide body portals as well as the guard subtree while preserving local drafts. */
export function concealSessionPortals(status: HTMLElement): () => void {
  let root = status;
  while (root.parentElement && root.parentElement !== document.body) root = root.parentElement;
  const marker = crypto.randomUUID();
  const previousMarker = root.getAttribute('data-academy-session-status-root');
  root.setAttribute('data-academy-session-status-root', marker);
  const style = document.createElement('style');
  style.textContent = `body > :not([data-academy-session-status-root="${marker}"]) { visibility: hidden !important; pointer-events: none !important; }`;
  document.head.append(style);
  const hidden = new Map<HTMLElement, { aria: string | null; inert: string | null }>();
  const ancestors = new Map<HTMLElement, string>();
  // An already-open modal may have hidden the application root from assistive
  // technology. Temporarily expose only the recovery status's ancestors.
  for (let node: HTMLElement | null = status; node && node !== document.body; node = node.parentElement) {
    if (node.getAttribute('aria-hidden') === 'true') { ancestors.set(node, 'true'); node.removeAttribute('aria-hidden'); }
  }
  const isolate = () => {
    for (const node of document.body.children) {
      if (!(node instanceof HTMLElement) || node === root || ['SCRIPT', 'STYLE', 'LINK'].includes(node.tagName)) continue;
      if (!hidden.has(node)) hidden.set(node, { aria: node.getAttribute('aria-hidden'), inert: node.getAttribute('inert') });
      node.setAttribute('aria-hidden', 'true');
      node.setAttribute('inert', '');
    }
  };
  isolate();
  const observer = new MutationObserver(isolate);
  observer.observe(document.body, { childList: true });
  return () => {
    observer.disconnect(); style.remove();
    if (previousMarker === null) root.removeAttribute('data-academy-session-status-root'); else root.setAttribute('data-academy-session-status-root', previousMarker);
    for (const [node, before] of hidden) {
      if (before.aria === null) node.removeAttribute('aria-hidden'); else node.setAttribute('aria-hidden', before.aria);
      if (before.inert === null) node.removeAttribute('inert'); else node.setAttribute('inert', before.inert);
    }
    for (const [node, aria] of ancestors) node.setAttribute('aria-hidden', aria);
  };
}


type SessionFocus = {
  element: HTMLElement;
  selection: { start: number; end: number; direction: 'forward' | 'backward' | 'none' | null } | null;
};

function availableForFocus(element: HTMLElement): boolean {
  if (!element.isConnected || element.closest('[hidden], [inert], [aria-hidden="true"]') || element.matches(':disabled')) return false;
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return false;
  }
  return true;
}

/** Capture before concealment changes focus; retry controls must not replace the editor. */
export function captureSessionFocus(status: HTMLElement | null): SessionFocus | null {
  const element = document.activeElement;
  if (!(element instanceof HTMLElement) || element === document.body || status?.contains(element) || !availableForFocus(element)) return null;
  const input = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement ? element : null;
  const selection = input && input.selectionStart !== null && input.selectionEnd !== null
    ? { start: input.selectionStart, end: input.selectionEnd, direction: input.selectionDirection } : null;
  return { element, selection };
}

/** Run only after the same actor is revalidated and portal concealment is cleaned up. */
export function restoreSessionFocus(saved: SessionFocus): void {
  if (!availableForFocus(saved.element)) return;
  saved.element.focus({ preventScroll: true });
  if (saved.selection && (saved.element instanceof HTMLInputElement || saved.element instanceof HTMLTextAreaElement)) {
    saved.element.setSelectionRange(saved.selection.start, saved.selection.end, saved.selection.direction ?? undefined);
  }
}
