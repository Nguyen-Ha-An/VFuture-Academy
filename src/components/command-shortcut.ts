"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";

/**
 * The ⌘K / Ctrl+K plumbing shared by the staff and learner command menus. Free of cmdk so each
 * trigger can import it without pulling its lazily loaded dialog chunk.
 */

const noopSubscribe = () => () => {};

export function isApplePlatform(): boolean {
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  return /mac|iphone|ipad|ipod/i.test(nav.userAgentData?.platform || nav.platform || nav.userAgent);
}

/** Apple → ⌘K / Meta+K, otherwise Ctrl K / Control+K. The server snapshot is "not Apple" so SSR markup is stable. */
export function useApplePlatform(): boolean {
  return useSyncExternalStore(noopSubscribe, isApplePlatform, () => false);
}

/**
 * True when a modal owns focus (unsaved-changes prompt, confirmations, the mobile drawer).
 * Popovers and menus also use role="dialog" but sit in a Radix popper wrapper and are not modal.
 */
export function modalHasFocus(): boolean {
  const modal = document.activeElement?.closest('[role="dialog"], [role="alertdialog"], dialog[open]');
  return Boolean(modal && !modal.closest("[data-radix-popper-content-wrapper]"));
}

/** Text entry of any kind: form fields, contenteditable (CodeMirror's content included) and ARIA textboxes. */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target instanceof HTMLElement && target.isContentEditable) return true;
  return Boolean(target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], .cm-editor'));
}

export type CommandShortcutOptions = {
  /** Reads the menu's current state at key time. */
  isOpen: () => boolean;
  /** Called with the next state; the caller starts its dialog import and sets state. */
  onToggle: (next: boolean) => void;
  /** Also refuse to open while the key event comes from text entry (the learner menu). */
  ignoreEditable?: boolean;
};

/**
 * Registers the global ⌘K / Ctrl+K toggle. Closing is always allowed; opening over another modal
 * would steal its focus trap, so it is refused while a modal has focus (and, with `ignoreEditable`,
 * while the learner types in a field or editor).
 */
export function useCommandShortcut(options: CommandShortcutOptions) {
  const latest = useRef(options);
  useEffect(() => {
    latest.current = options;
  });

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.repeat || event.altKey || event.shiftKey) return;
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "k") return;
      const { isOpen, onToggle, ignoreEditable } = latest.current;
      const open = isOpen();
      if (!open && (modalHasFocus() || (ignoreEditable && isEditableTarget(event.target)))) return;
      event.preventDefault();
      onToggle(!open);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
