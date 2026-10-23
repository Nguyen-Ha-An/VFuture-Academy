// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requestNavigation } from "@/lib/navigation-guard";

const mocks = vi.hoisted(() => ({
  notebookJson: vi.fn(),
  uploadNotebookFile: vi.fn(),
  downloadNotebook: vi.fn(),
  instances: [] as Array<{
    request: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
    isClosed: boolean;
    onChange: (value: unknown) => void;
    onHello?: () => void;
    onError?: (message: string, code?: string) => void;
  }>,
  NotebookBridge: class {
    request = vi.fn(async () => ({}));
    isClosed = false;
    dispose = vi.fn(() => {
      this.isClosed = true;
    });
    constructor(
      _frame: Window,
      _origin: string,
      readonly onChange: (value: unknown) => void,
      readonly onHello?: () => void,
      readonly onError?: (message: string, code?: string) => void,
    ) {
      mocks.instances.push(this);
    }
  },
}));

vi.mock("next-intl", () => {
  const translate = (key: string) => key;
  return { useTranslations: () => translate, useLocale: () => "en" };
});
vi.mock("next/link", () => ({
  default: ({
    children,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a {...props}>{children}</a>
  ),
}));
vi.mock("@/features/notebooks/bridge", () => ({
  NotebookBridge: mocks.NotebookBridge,
}));
vi.mock("@/features/notebooks/client", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/features/notebooks/client")>();
  return {
    ...actual,
    notebookJson: mocks.notebookJson,
    uploadNotebookFile: mocks.uploadNotebookFile,
    downloadNotebook: mocks.downloadNotebook,
  };
});
vi.mock("@/features/notebooks/ui/NotebookViewer", () => ({
  NotebookViewer: () => <div>Notebook preview</div>,
}));

import { NotebookApiError } from "@/features/notebooks/client";
import { NotebookWorkspace } from "@/features/notebooks/ui/NotebookWorkspace";

const locator = { courseId: "course-1", itemId: "assignment-1", blockId: null };
const notebook = (source: string) => ({
  nbformat: 4,
  nbformat_minor: 5,
  metadata: {},
  cells: [
    {
      cell_type: "code",
      metadata: {},
      source,
      execution_count: null,
      outputs: [],
    },
  ],
});
const session = (overrides: Record<string, unknown> = {}) => ({
  userId: "learner-1",
  courseId: "course-1",
  courseVersionId: "version-1",
  itemId: "assignment-1",
  blockId: null,
  config: {
    runtimeMode: "jupyterlite",
    templateAssetId: "template-1",
    templateChecksum: "a".repeat(64),
    runtimeProfileId: "python-data-v1",
    runtimeProfileVersion: "1",
    datasets: [],
  },
  template: null,
  datasets: [],
  draft: null,
  studioRevision: null,
  assignment: {
    locator,
    courseVersionId: "version-1",
    attemptsUsed: 0,
    submissions: [],
    action: {
      allowed: true,
      kind: "initial",
      expectedLatestSubmissionId: null,
      nextAttemptNo: 1,
    },
  },
  ...overrides,
});
const artifact = {
  id: "artifact-1",
  checksum: "b".repeat(64),
  filename: "work.ipynb",
  size_bytes: 100,
  runtime_profile_id: "python-data-v1",
  runtime_profile_version: "1",
};

function configureApi(initial = session()) {
  mocks.notebookJson.mockImplementation(async (url: string) => {
    if (url.includes("/session")) return initial;
    if (url.includes("/draft")) return { revision: 1 };
    if (url.includes("/assignments/submit"))
      return {
        created: true,
        session: {
          ...initial.assignment,
          action: { allowed: false, reason: "awaiting_review" },
        },
      };
    return {};
  });
  mocks.uploadNotebookFile.mockResolvedValue(artifact);
}

async function renderWorkspace(initial = session(), studio = false) {
  configureApi(initial);
  render(
    <NotebookWorkspace
      locator={locator}
      studio={studio}
      runtimeUrl="https://runtime.example"
    />,
  );
  await screen.findByRole("button", { name: studio ? "saveTemplate" : "save" });
  const frame = screen.getByTitle("editor");
  fireEvent.load(frame);
  await waitFor(() => expect(mocks.instances.length).toBeGreaterThan(0));
  const bridge = mocks.instances.at(-1)!;
  bridge.request.mockImplementation(async (type: string) =>
    type === "EXPORT" ? { notebook: notebook("exported") } : {},
  );
  await act(async () => {
    bridge.onHello?.();
    await Promise.resolve();
  });
  return bridge;
}

beforeEach(() => {
  mocks.notebookJson.mockReset();
  mocks.uploadNotebookFile.mockReset();
  mocks.downloadNotebook.mockReset();
  mocks.instances.length = 0;
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("NotebookWorkspace async state", () => {
  it("groups learner file, submission, and execution controls in the refined workspace", async () => {
    await renderWorkspace(session());

    const files = screen.getByRole("group", { name: "import / download" });
    expect(within(files).getByLabelText("import")).toBeInTheDocument();
    expect(within(files).getByRole("button", { name: "download" })).toBeInTheDocument();

    const submission = screen.getByRole("group", { name: "save / submit" });
    expect(within(submission).getByRole("button", { name: "save" })).toBeEnabled();
    expect(within(submission).getByRole("button", { name: "submit" })).toBeEnabled();

    const editor = screen.getByRole("region", { name: "editor" });
    expect(within(editor).getByRole("heading", { name: "editor" })).toBeInTheDocument();
    expect(within(editor).getByRole("button", { name: "runAll" })).toBeEnabled();
  });

  it("leaves the heading to the activity frame and guards leaving with unsaved work in-page", async () => {
    const bridge = await renderWorkspace();
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
    expect(screen.queryByRole("link", { name: /back/ })).toBeNull();
    const confirm = vi.spyOn(window, "confirm");
    await expect(requestNavigation()).resolves.toBe(true);
    act(() => bridge.onChange(notebook("unsaved edit")));
    let decision = requestNavigation();
    const dialog = await screen.findByRole("dialog", { name: "leaveTitle" });
    fireEvent.click(within(dialog).getByRole("button", { name: "stay" }));
    await expect(decision).resolves.toBe(false);
    decision = requestNavigation();
    fireEvent.click(within(await screen.findByRole("dialog", { name: "leaveTitle" })).getByRole("button", { name: "leaveAnyway" }));
    await expect(decision).resolves.toBe(true);
    expect(confirm).not.toHaveBeenCalled();
  });

  it("shows an existing submission awaiting review in the refined learner workspace", async () => {
    const initial = session({
      assignment: {
        ...session().assignment,
        submissions: [{ submissionId: "submission-1", status: "in_review" }],
        action: { allowed: false, reason: "awaiting_review" },
      },
    });
    await renderWorkspace(initial);

    expect(screen.getByText("submitted")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "submit" })).toBeDisabled();
  });

  it("keeps the Studio workspace presentation out of the learner layout", async () => {
    await renderWorkspace(session({ courseVersionId: null, studioRevision: "revision-1", assignment: null }), true);

    expect(screen.queryByRole("group", { name: "submit" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "editor" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "saveTemplate" })).toBeInTheDocument();
  });

  it("replaces a silent runtime with a local preview and retries only the iframe", async () => {
    vi.useFakeTimers();
    configureApi(session());
    render(
      <NotebookWorkspace
        locator={locator}
        runtimeUrl="https://runtime.example"
      />,
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByRole("button", { name: "save" })).toBeInTheDocument();
    expect(mocks.instances.length).toBeGreaterThan(0);
    const bridge = mocks.instances.at(-1)!;
    act(() => bridge.onChange(notebook("preserved locally")));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(screen.queryByTitle("editor")).not.toBeInTheDocument();
    expect(screen.getByText("runtimeUnavailable")).toBeInTheDocument();
    expect(screen.getByText("Notebook preview")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "retryRuntime" }));
    expect(screen.getByTitle("editor")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("unsaved");
    fireEvent.click(screen.getAllByRole("button", { name: "download" })[0]);
    expect(mocks.downloadNotebook).toHaveBeenCalledWith(
      expect.objectContaining({
        cells: [expect.objectContaining({ source: "preserved locally" })],
      }),
    );
  });

  it("cancels the startup watchdog after INIT succeeds", async () => {
    vi.useFakeTimers();
    configureApi(session());
    render(
      <NotebookWorkspace
        locator={locator}
        runtimeUrl="https://runtime.example"
      />,
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const bridge = mocks.instances.at(-1)!;
    bridge.request.mockImplementation(async () => ({}));
    await act(async () => {
      bridge.onHello?.();
      await Promise.resolve();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(screen.getByTitle("editor")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "retryRuntime" }),
    ).not.toBeInTheDocument();
    expect(bridge.request).toHaveBeenCalledWith("INIT", expect.any(Object));
  });

  it("reattaches after Strict Mode cleanup and initializes from a repeated HELLO without iframe reload", async () => {
    configureApi(session());
    render(
      <StrictMode>
        <NotebookWorkspace
          locator={locator}
          runtimeUrl="https://runtime.example"
        />
      </StrictMode>,
    );
    await screen.findByRole("button", { name: "save" });
    // The toolbar can render before the passive iframe attachment effect runs.
    await waitFor(() => expect(mocks.instances.length).toBeGreaterThanOrEqual(1));
    const active = mocks.instances.at(-1)!;
    active.request.mockImplementation(async () => ({}));
    await act(async () => {
      active.onHello?.();
      await Promise.resolve();
    });
    expect(active.request).toHaveBeenCalledWith(
      "INIT",
      expect.objectContaining({ readOnly: false }),
    );
    expect(screen.getByRole("button", { name: "run" })).toBeEnabled();
  });
  it("does not mark the runtime INIT echo as an edit", async () => {
    const bridge = await renderWorkspace();
    act(() =>
      bridge.onChange(
        structuredClone({
          nbformat: 4,
          nbformat_minor: 5,
          metadata: {
            kernelspec: {
              display_name: "Python (Pyodide)",
              language: "python",
              name: "python",
            },
          },
          cells: [
            {
              id: "start",
              cell_type: "code",
              metadata: {},
              source: "",
              execution_count: null,
              outputs: [],
            },
          ],
        }),
      ),
    );
    expect(screen.getByRole("status")).toHaveTextContent("ready");
  });

  it("pauses autosave after a failure until explicit retry", async () => {
    const bridge = await renderWorkspace();
    mocks.uploadNotebookFile.mockRejectedValue(new Error("offline"));
    vi.useFakeTimers();
    act(() => bridge.onChange(notebook("changed")));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    expect(mocks.uploadNotebookFile).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(9_000);
    });
    expect(mocks.uploadNotebookFile).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "retrySave" }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(mocks.uploadNotebookFile).toHaveBeenCalledTimes(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(9_000);
    });
    expect(mocks.uploadNotebookFile).toHaveBeenCalledTimes(2);
    act(() => bridge.onChange(notebook("new edit")));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    expect(mocks.uploadNotebookFile).toHaveBeenCalledTimes(3);
  });

  it("submits the exact exported snapshot once and preserves edits made after capture", async () => {
    const bridge = await renderWorkspace();
    const exported = notebook("latest exported");
    bridge.request.mockImplementation(async (type: string) =>
      type === "EXPORT" ? { notebook: exported } : {},
    );
    let resolveSubmit!: (value: unknown) => void;
    const submitResponse = new Promise((resolve) => {
      resolveSubmit = resolve;
    });
    mocks.notebookJson.mockImplementation(async (url: string) => {
      if (url.includes("/session")) return session();
      if (url.includes("/assignments/submit")) return submitResponse;
      return { revision: 1 };
    });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "submit" }));
    const confirm = screen.getByRole("button", { name: "confirmSubmit" });
    await user.click(confirm);
    await user.click(confirm);
    await waitFor(() =>
      expect(mocks.uploadNotebookFile).toHaveBeenCalledTimes(1),
    );
    const uploadedBlob = mocks.uploadNotebookFile.mock.calls[0][2] as Blob;
    expect(JSON.parse(await uploadedBlob.text())).toEqual(exported);
    act(() => bridge.onChange(notebook("edit after capture")));
    resolveSubmit({
      created: true,
      session: {
        ...session().assignment,
        action: { allowed: false, reason: "awaiting_review" },
      },
    });
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("unsaved"),
    );
  });

  it("keeps conflict recovery visible and stops automatic retries", async () => {
    const bridge = await renderWorkspace();
    mocks.notebookJson.mockImplementation(async (url: string) => {
      if (url.includes("/session")) return session();
      if (url.includes("/draft"))
        throw new NotebookApiError(
          "NOTEBOOK_DRAFT_CONFLICT",
          "Saved in another tab",
          409,
        );
      return {};
    });
    vi.useFakeTimers();
    act(() => bridge.onChange(notebook("conflict")));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    expect(screen.getByRole("alert")).toHaveTextContent("conflictMessage");
    expect(screen.getByRole("button", { name: "downloadCopy" })).toBeEnabled();
    expect(
      screen.queryByRole("button", { name: "retrySave" }),
    ).not.toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(9_000);
    });
    expect(mocks.uploadNotebookFile).toHaveBeenCalledTimes(1);
  });

  it("disposes the runtime and keeps a downloadable recovery copy after session expiry", async () => {
    const bridge = await renderWorkspace();
    mocks.uploadNotebookFile.mockRejectedValue(
      new NotebookApiError("UNAUTHENTICATED", "expired", 401),
    );
    act(() => bridge.onChange(notebook("unsynced")));
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("sessionExpired"),
    );
    expect(bridge.dispose).toHaveBeenCalled();
    expect(screen.queryByTitle("editor")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "downloadCopy" })).toBeEnabled();
  });

  it("removes the prior account notebook from view when the authenticated actor changes", async () => {
    const bridge = await renderWorkspace();
    mocks.uploadNotebookFile.mockRejectedValue(
      new NotebookApiError("NOTEBOOK_ACTOR_CHANGED", "changed", 401),
    );
    act(() => bridge.onChange(notebook("prior account secret")));
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("sessionExpired"),
    );
    fireEvent.click(screen.getByRole("button", { name: "downloadCopy" }));
    expect(mocks.downloadNotebook).toHaveBeenCalledWith(
      expect.objectContaining({
        cells: [expect.objectContaining({ source: "" })],
      }),
    );
    expect(screen.queryByTitle("editor")).not.toBeInTheDocument();
  });

  it("uses Lite only as a Colab authoring surface without presenting local run controls", async () => {
    await renderWorkspace(
      session({
        config: {
          runtimeMode: "colab_external",
          templateAssetId: "template-1",
          templateChecksum: "a".repeat(64),
          runtimeProfileId: "colab-python-data-v1",
          runtimeProfileVersion: "1",
          datasets: [],
          colabReason: "Hosted package",
        },
        assignment: null,
        courseVersionId: null,
        studioRevision: "revision-1",
      }),
      true,
    );
    expect(screen.getByTitle("editor")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "run" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("previewOnly")).toBeInTheDocument();
  });

  it("accepts its own standalone download metadata when blockId is omitted", async () => {
    await renderWorkspace();
    const value = {
      ...notebook("imported"),
      metadata: { vfuture: { courseId: "course-1", itemId: "assignment-1" } },
    };
    const file = new File([JSON.stringify(value)], "work.ipynb", {
      type: "application/x-ipynb+json",
    });
    Object.defineProperty(file, "text", {
      value: async () => JSON.stringify(value),
    });
    fireEvent.change(screen.getByLabelText("import"), {
      target: { files: [file] },
    });
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("unsaved"),
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("restores unsaved Studio runtime configuration from the authenticated recovery key", async () => {
    const initial = session({
      assignment: null,
      courseVersionId: null,
      studioRevision: "revision-1",
    });
    configureApi(initial);
    const { unmount } = render(
      <NotebookWorkspace
        locator={locator}
        studio
        runtimeUrl="https://runtime.example"
      />,
    );
    await screen.findByRole("button", { name: "saveTemplate" });
    fireEvent.change(screen.getByLabelText("runtime"), {
      target: { value: "colab_external" },
    });
    fireEvent.change(screen.getByLabelText("reason"), {
      target: { value: "Needs hosted package" },
    });
    unmount();

    configureApi(initial);
    render(
      <NotebookWorkspace
        locator={locator}
        studio
        runtimeUrl="https://runtime.example"
      />,
    );
    await screen.findByRole("button", { name: "restore" });
    fireEvent.click(screen.getByRole("button", { name: "restore" }));
    expect(screen.getByLabelText("runtime")).toHaveValue("colab_external");
    expect(screen.getByLabelText("reason")).toHaveValue("Needs hosted package");
  });
});

it("keeps an oversized live notebook mounted so its source can be downloaded or outputs cleared", async () => {
  const bridge = await renderWorkspace();
  await act(async () => bridge.onHello?.());
  act(() => bridge.onError?.("Notebook exceeds limit", "PAYLOAD_TOO_LARGE"));
  expect(screen.getByTitle("editor")).toBeInTheDocument();
  expect(bridge.dispose).not.toHaveBeenCalled();
  expect(screen.getByText("tooLarge")).toBeInTheDocument();
  await userEvent.click(
    screen.getByRole("button", { name: "download" }),
  );
  expect(bridge.request).toHaveBeenCalledWith("DOWNLOAD", expect.any(Object));
});

it("persists dataset removal and captures the latest live source before replacing the iframe", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response("name,score\nAn,9\n"),
  );
  const initial = session({
    studioRevision: "revision-1",
    courseVersionId: null,
    datasets: [
      {
        assetId: "dataset-1",
        checksum: "c".repeat(64),
        filename: "scores.csv",
        sizeBytes: 20,
        mime: "text/csv",
        url: "https://storage.example/scores.csv",
      },
    ],
  });
  const bridge = await renderWorkspace(initial, true);
  bridge.request.mockImplementation(async (type: string) =>
    type === "EXPORT" ? { notebook: notebook("latest typed code") } : {},
  );
  await userEvent.click(screen.getByRole("button", { name: "removeDataset" }));
  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: "scores.csv" }),
    ).not.toBeInTheDocument(),
  );
  const recovery = JSON.parse(
    localStorage.getItem(
      "vfuture:notebook:learner-1:studio:course-1:assignment-1:",
    )!,
  );
  expect(recovery.datasets).toEqual([]);
  expect(recovery.notebook.cells[0].source).toBe("latest typed code");
});
