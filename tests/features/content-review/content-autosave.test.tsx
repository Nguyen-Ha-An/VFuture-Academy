// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import {
  useContentAutosave,
  ContentSaveError,
} from "@/features/content-review/useContentAutosave";
const ack = { revision: "r2", savedAt: "2026-09-08T10:00:00Z" };
it('retains recovery but delegates the native prompt when a navigation guard owns it', () => {
  const key = 'guarded-unload-fixture';
  renderHook(() => useContentAutosave({ value: 'unsaved source', initialValue: 'saved source', valid: true, enabled: true,
    navigationGuarded: true, storageKey: key, persist: async () => ack, reconcile: async () => null }));
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(false);
  expect(JSON.parse(localStorage.getItem(key)!).source).toBe('unsaved source');
  localStorage.removeItem(key);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
it("debounces and preserves edits typed during the request", async () => {
  vi.useFakeTimers();
  let finish!: (a: typeof ack) => void;
  const persist = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValue(ack);
  const { result, rerender } = renderHook(
    ({ value }) =>
      useContentAutosave({
        value,
        initialValue: "a",
        valid: true,
        enabled: true,
        persist,
        reconcile: async () => null,
      }),
    { initialProps: { value: "b" } },
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1499);
  });
  expect(persist).not.toHaveBeenCalled();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(result.current.status).toBe("saving");
  rerender({ value: "c" });
  await act(async () => {
    finish(ack);
  });
  expect(result.current.dirty).toBe(true);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1500);
  });
  expect(persist.mock.calls.map((c) => c[0])).toEqual(["b", "c"]);
  expect(result.current.dirty).toBe(false);
});
it("reconciles a lost response and does not report newer text as saved", async () => {
  const persist = vi.fn().mockRejectedValue(new TypeError("network"));
  const reconcile = vi.fn().mockResolvedValue(ack);
  const { result } = renderHook(() =>
    useContentAutosave({
      value: "b",
      initialValue: "a",
      valid: true,
      enabled: true,
      persist,
      reconcile,
    }),
  );
  await act(async () => {
    expect(await result.current.save()).toBe(true);
  });
  expect(reconcile).toHaveBeenCalled();
  expect(result.current.status).toBe("saved");
});
it("stops autosave when outcome is uncertain, including after more edits", async () => {
  vi.useFakeTimers();
  const persist = vi.fn().mockRejectedValue(new TypeError("network"));
  const { result, rerender } = renderHook(
    ({ value }) =>
      useContentAutosave({
        value,
        initialValue: "a",
        valid: true,
        enabled: true,
        persist,
        reconcile: async () => {
          throw new Error("offline");
        },
      }),
    { initialProps: { value: "b" } },
  );
  await act(async () => {
    await result.current.save();
  });
  expect(result.current.status).toBe("uncertain");
  rerender({ value: "c" });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10000);
    await result.current.save();
  });
  expect(persist).toHaveBeenCalledTimes(1);
});
it("does not autosave invalid content or retry a conflict", async () => {
  vi.useFakeTimers();
  const persist = vi
    .fn()
    .mockRejectedValue(new ContentSaveError("changed", 409));
  const { result, rerender } = renderHook(
    ({ valid }) =>
      useContentAutosave({
        value: "b",
        initialValue: "a",
        valid,
        enabled: true,
        persist,
        reconcile: async () => null,
      }),
    { initialProps: { valid: false } },
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2000);
  });
  expect(persist).not.toHaveBeenCalled();
  rerender({ valid: true });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1500);
  });
  expect(result.current.status).toBe("conflict");
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10000);
  });
  expect(persist).toHaveBeenCalledTimes(1);
});

it("flushes changes already typed behind an in-flight save, but does not submit edits made during flush", async () => {
  let finish!: (a: typeof ack) => void;
  const persist = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValue(ack);
  const { result, rerender } = renderHook(
    ({ value }) =>
      useContentAutosave({
        value,
        initialValue: "a",
        valid: true,
        enabled: true,
        persist,
        reconcile: async () => null,
      }),
    { initialProps: { value: "b" } },
  );
  let first!: Promise<boolean>;
  act(() => {
    first = result.current.save();
  });
  rerender({ value: "c" });
  let flush!: Promise<boolean>;
  act(() => {
    flush = result.current.flush();
  });
  await act(async () => {
    finish(ack);
    await first;
    expect(await flush).toBe(true);
  });
  expect(persist.mock.calls.map((c) => c[0])).toEqual(["b", "c"]);
});
it("removes its stale recovery after reverting to the acknowledged value", async () => {
  vi.useFakeTimers();
  localStorage.clear();
  const { rerender } = renderHook(
    ({ value }) =>
      useContentAutosave({
        value,
        initialValue: "a",
        valid: false,
        enabled: true,
        persist: async () => ack,
        reconcile: async () => null,
        storageKey: "own-recovery",
      }),
    { initialProps: { value: "b" } },
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300);
  });
  expect(localStorage.getItem("own-recovery")).not.toBeNull();
  rerender({ value: "a" });
  expect(localStorage.getItem("own-recovery")).toBeNull();
});
