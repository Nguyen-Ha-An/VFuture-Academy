"use client";
import { useLocale } from "next-intl";
import { Button } from "@/components/ui/classic";
import type { useContentAutosave } from "./useContentAutosave";

type SaveState = ReturnType<typeof useContentAutosave>;
export function ContentSaveIndicator({
  state,
  valid = true,
  disabled = false,
  saveLabel,
}: {
  state: SaveState;
  valid?: boolean;
  disabled?: boolean;
  saveLabel?: string;
}) {
  const vi = useLocale() === "vi";
  const busy = state.status === "saving" || state.status === "reconciling";
  const time = state.savedAt
    ? new Date(state.savedAt).toLocaleTimeString(vi ? "vi-VN" : "en-GB", {
        hour12: false,
      })
    : null;
  const statuses = {
    saving: vi ? "Đang lưu…" : "Saving…",
    reconciling: vi
      ? "Đang kiểm tra kết quả lưu…"
      : "Checking whether changes were saved…",
    uncertain: vi ? "Chưa xác nhận đã lưu" : "Save not confirmed",
    conflict: vi
      ? "Bản trên server đã thay đổi. Giữ bản đang sửa và tải lại để đối chiếu."
      : "The server version changed. Keep your edits and reload to compare.",
    error: vi ? "Không lưu được" : "Could not save",
  };
  let label: string;
  if (state.status in statuses)
    label = statuses[state.status as keyof typeof statuses];
  else if (!valid && state.dirty)
    label = vi
      ? "Chưa thể lưu — sửa lỗi nội dung; bản đang sửa chưa lưu lên server."
      : "Cannot save — fix the content errors; edits are not on the server.";
  else if (state.dirty) label = vi ? "Có thay đổi chưa lưu" : "Unsaved changes";
  else
    label = time
      ? vi
        ? `Đã lưu lúc ${time}`
        : `Saved at ${time}`
      : vi
        ? "Đã tải bản lưu từ server"
        : "Loaded saved version";
  function download(source = state.source) {
    // Recovery source is shown only after explicit user action.
    if (source === null) return;
    const url = URL.createObjectURL(
      new Blob([source], { type: "application/json" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "studio-recovery.json";
    anchor.click();
    URL.revokeObjectURL(url);
  }
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          disabled={
            disabled ||
            busy ||
            !valid ||
            !state.dirty ||
            state.status === "uncertain" ||
            state.status === "conflict"
          }
          onClick={() => void state.save()}
        >
          {busy
            ? vi
              ? "Đang lưu…"
              : "Saving…"
            : (saveLabel ?? (vi ? "Lưu ngay" : "Save now"))}
        </Button>
        <p
          role="status"
          aria-live="polite"
          className="text-sm text-muted-foreground"
        >
          {label}
        </p>
        {state.status === "uncertain" ? (
          <Button
            type="button"
            disabled={busy}
            onClick={() => void state.retryRead()}
          >
            {vi ? "Kiểm tra lại" : "Check again"}
          </Button>
        ) : null}
      </div>
      {state.status === "conflict" || state.status === "uncertain" ? (
        <div className="flex gap-2">
          <Button type="button" onClick={() => download()}>
            {vi ? "Tải bản đang sửa" : "Download current edits"}
          </Button>
          <Button
            type="button"
            onClick={() =>
              window.open(window.location.href, "_blank", "noopener,noreferrer")
            }
          >
            {vi ? "Xem bản server ở tab mới" : "View server version in new tab"}
          </Button>
        </div>
      ) : null}
      {state.error ? (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      ) : null}
      {state.storageError ? (
        <p role="alert" className="text-sm text-destructive">
          {vi
            ? "Không lưu được bản khôi phục trên thiết bị."
            : "Could not save recovery data on this device."}
        </p>
      ) : null}
      {state.recovery !== null ? (
        <div className="flex flex-wrap items-center gap-2 rounded border p-3">
          <span>
            {vi
              ? "Có bản chưa lưu trên thiết bị này."
              : "There are unsaved edits on this device."}
          </span>
          <Button
            type="button"
            disabled={disabled}
            onClick={state.restoreRecovery}
          >
            {vi ? "Khôi phục" : "Restore"}
          </Button>
          <Button type="button" onClick={() => download(state.recovery!)}>
            {vi ? "Tải bản khôi phục" : "Download recovery"}
          </Button>
          <Button type="button" onClick={state.discardRecovery}>
            {vi ? "Bỏ bản khôi phục" : "Discard recovery"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
