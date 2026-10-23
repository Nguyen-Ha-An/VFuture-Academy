// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ContentWorkflowPanel } from "@/features/content-review/ContentWorkflowPanel";

const fetchMock = vi.fn();
function panel(props: React.ComponentProps<typeof ContentWorkflowPanel>) {
  return (
    <NextIntlClientProvider locale="en" messages={{}}>
      <ContentWorkflowPanel {...props} />
    </NextIntlClientProvider>
  );
}

function response(data: unknown, ok = true, message = "Request failed") {
  return Promise.resolve({
    ok,
    json: async () => (ok ? { data } : { error: { message } }),
  });
}

const editableWorkflow = {
  content: {
    contentType: "bank_question",
    contentId: "question-1",
    revisionKey: "revision-7",
    status: "draft",
    publishedRevisionKey: null,
  },
  activeReview: null,
  publication: null,
  actions: {
    requestReview: true,
    withdrawReview: false,
    approveAndPublish: false,
    mutate: true,
  },
};

const pendingWorkflow = {
  content: {
    contentType: "bank_question",
    contentId: "question-1",
    revisionKey: "revision-7",
    status: "draft",
    publishedRevisionKey: null,
  },
  activeReview: {
    id: "review-1",
    status: "pending",
    revisionKey: "revision-7",
    note: null,
  },
  publication: null,
  actions: {
    requestReview: false,
    withdrawReview: true,
    approveAndPublish: false,
    mutate: false,
  },
};

afterEach(() => {
  cleanup();
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

describe("ContentWorkflowPanel", () => {
  it("separates a working draft from the published revision without changing submit guards", async () => {
    const publishedWorkflow = {
      ...editableWorkflow,
      content: { ...editableWorkflow.content, status: "published", publishedRevisionKey: "revision-7" },
      publication: { revisionKey: "revision-7", publishedAt: "2026-09-09T00:00:00Z" },
    };
    fetchMock.mockImplementationOnce(() => response(publishedWorkflow));
    vi.stubGlobal("fetch", fetchMock);
    render(panel({ contentType: "bank_question", contentId: "question-1" }));

    expect(await screen.findByText("Live")).toBeInTheDocument();
    await userEvent.click(screen.getByText("Revision details"));
    expect(screen.getByText("Current revision")).toBeInTheDocument();
    expect(screen.getAllByText("revision-7")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Create revision" })).toBeEnabled();
  });

  it("flushes the editor before submitting and never submits if that flush fails", async () => {
    const beforeSubmit = vi.fn().mockResolvedValue(false);
    fetchMock.mockImplementationOnce(() => response(editableWorkflow));
    vi.stubGlobal("fetch", fetchMock);
    render(
      panel({
        contentType: "bank_question",
        contentId: "question-1",
        beforeSubmit,
      }),
    );

    await userEvent.click(
      await screen.findByRole("button", { name: "Submit for review" }),
    );

    expect(beforeSubmit).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Save your changes before submitting for review.",
    );
  });

  it("shows the real validation message when beforeSubmit reports a failed check", async () => {
    const beforeSubmit = vi.fn().mockResolvedValue({ ok: false, message: "Fix 2 errors before submitting: Answer key has the wrong shape." });
    fetchMock.mockImplementationOnce(() => response(editableWorkflow));
    vi.stubGlobal("fetch", fetchMock);
    render(panel({ contentType: "bank_question", contentId: "question-1", beforeSubmit }));

    await userEvent.click(await screen.findByRole("button", { name: "Submit for review" }));

    expect(beforeSubmit).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("alert")).toHaveTextContent("Fix 2 errors before submitting: Answer key has the wrong shape.");
    expect(screen.getByRole("alert")).not.toHaveTextContent("Save your changes before submitting for review.");
  });

  it("keeps a stale submission actionable and retries using a reloaded revision", async () => {
    const afterStale = {
      ...editableWorkflow,
      content: { ...editableWorkflow.content, revisionKey: "revision-8" },
    };
    fetchMock
      .mockImplementationOnce(() => response(editableWorkflow))
      .mockImplementationOnce(() => response(editableWorkflow))
      .mockImplementationOnce(() =>
        response({}, false, "This review is stale. Reload and try again."),
      )
      .mockImplementationOnce(() => response(afterStale))
      .mockImplementationOnce(() => response(afterStale))
      .mockImplementationOnce(() =>
        response({ activeReview: { id: "review-2", status: "pending" } }),
      )
      .mockImplementationOnce(() => response(pendingWorkflow));
    vi.stubGlobal("fetch", fetchMock);
    render(
      panel({
        contentType: "bank_question",
        contentId: "question-1",
        beforeSubmit: async () => true,
      }),
    );
    const submit = await screen.findByRole("button", {
      name: "Submit for review",
    });

    await userEvent.click(submit);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This review is stale. Reload and try again.",
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Reload workflow" }),
    );
    await userEvent.click(
      await screen.findByRole("button", { name: "Submit for review" }),
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(7));
    expect(fetchMock.mock.calls[5][0]).toContain("/reviews");
    expect(JSON.parse(fetchMock.mock.calls[5][1].body)).toEqual({
      expectedRevision: "revision-8",
    });
  });

  it("locks a pending review and withdraw restores editing", async () => {
    const locks = vi.fn();
    fetchMock
      .mockImplementationOnce(() => response(pendingWorkflow))
      .mockImplementationOnce(() =>
        response({ activeReview: { id: "review-1", status: "withdrawn" } }),
      )
      .mockImplementationOnce(() => response(editableWorkflow));
    vi.stubGlobal("fetch", fetchMock);
    render(
      panel({
        contentType: "bank_question",
        contentId: "question-1",
        onLockChange: locks,
      }),
    );

    await userEvent.click(
      await screen.findByRole("button", { name: "Withdraw to edit" }),
    );

    await waitFor(() => expect(locks).toHaveBeenLastCalledWith(false));
    expect(fetchMock.mock.calls[1][0]).toContain("/reviews/review-1/withdraw");
    expect(
      screen.getByRole("button", { name: "Submit for review" }),
    ).toBeEnabled();
  });
});

it("never submits another author revision that appeared after the local save acknowledgment", async () => {
  fetchMock
    .mockImplementationOnce(() => response(editableWorkflow))
    .mockImplementationOnce(() =>
      response({
        ...editableWorkflow,
        content: { ...editableWorkflow.content, revisionKey: "remote-newer" },
      }),
    );
  vi.stubGlobal("fetch", fetchMock);
  render(
    panel({
      contentType: "bank_question",
      contentId: "question-1",
      beforeSubmit: async () => true,
      getExpectedRevision: () => "revision-7",
    }),
  );
  await userEvent.click(
    await screen.findByRole("button", { name: "Submit for review" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent("changed");
  expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(
    false,
  );
});
