// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireUser: vi.fn(), getCourse: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireUser: mocks.requireUser }));
vi.mock("@/features/catalog/service", () => ({ getCourse: mocks.getCourse }));
vi.mock("@/features/notebooks/config", () => ({ notebookRuntimeUrl: () => "https://runtime.example" }));
vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("not found"); },
  redirect: (location: string) => { throw new Error(`redirect:${location}`); },
  useRouter: () => ({ push: vi.fn() }),
}));
async function englishTranslator(namespace?: string) {
  const { createTranslator } = await vi.importActual<typeof import("next-intl")>("next-intl");
  const { default: en } = await import("@/messages/en.json");
  const { withBenchMessages } = await import("@/messages/bench");
  return createTranslator({ locale: "en", messages: withBenchMessages(en, "en"), namespace: namespace as never }) as unknown as (key: string, values?: Record<string, unknown>) => string;
}
const translators = vi.hoisted(() => new Map<string, (key: string, values?: Record<string, unknown>) => string>());
vi.mock("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async (namespace: string) => englishTranslator(namespace),
}));
vi.mock("next-intl", async () => {
  for (const namespace of ["learner.focus", "bench.learner.activity", "bench.learner.activity.state", "bench.shared.theme"]) translators.set(namespace, await englishTranslator(namespace));
  return { useTranslations: (namespace: string) => translators.get(namespace) ?? ((key: string) => key) };
});
vi.mock("@/features/notebooks/ui/NotebookWorkspace", () => ({
  NotebookWorkspace: ({ studio, locator, runtimeUrl }: {
    studio: boolean;
    locator: { courseId: string; itemId: string; blockId: string | null };
    runtimeUrl: string | null;
  }) => <div data-testid="notebook-workspace" data-studio={String(studio)} data-item={locator.itemId} data-block={String(locator.blockId)} data-runtime={String(runtimeUrl)} />,
}));

import NotebookPage from "@/app/app/courses/[courseId]/items/[itemId]/notebook/page";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const course = {
  enrollment: { id: "enrollment-1" },
  meta: { title: "Data Science" },
  outline: { modules: [{ id: "module-1", title: "Python", items: [
    { id: "intro", title: "Introduction", type: "lesson", status: "completed" },
    { id: "item-1", title: "Cleaning a dataset", type: "assignment", status: "submitted" },
  ] }] },
  progress: { items: { intro: "completed", "item-1": "submitted" }, completedItems: 1, totalItems: 2 },
};

describe("learner notebook page", () => {
  it("renders the learner notebook workspace for the requested locator", async () => {
    mocks.requireUser.mockResolvedValue({ id: "learner-1" });
    mocks.getCourse.mockResolvedValue(course);
    render(await NotebookPage({
      params: Promise.resolve({ courseId: "course-1", itemId: "item-1" }),
      searchParams: Promise.resolve({ blockId: "block-1" }),
    }));
    const workspace = screen.getByTestId("notebook-workspace");
    expect(workspace).toHaveAttribute("data-studio", "false");
    expect(workspace).toHaveAttribute("data-item", "item-1");
    expect(workspace).toHaveAttribute("data-block", "block-1");
    expect(workspace).toHaveAttribute("data-runtime", "https://runtime.example");
  });

  it("frames the notebook with its course context and the item title as the page heading", async () => {
    mocks.requireUser.mockResolvedValue({ id: "learner-1" });
    mocks.getCourse.mockResolvedValue(course);
    const view = render(await NotebookPage({
      params: Promise.resolve({ courseId: "course-1", itemId: "item-1" }),
      searchParams: Promise.resolve({}),
    }));
    expect(mocks.getCourse).toHaveBeenCalledWith({ userId: "learner-1", roles: [] }, "course-1", "en");
    expect(screen.getByRole("heading", { level: 1, name: "Cleaning a dataset" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Your notebook" })).toBeNull();
    expect(view.container.querySelector("[data-learning-kind=\"notebook\"]")).toHaveAttribute("data-width", "frame");
    expect(screen.getByRole("link", { name: "Back to course: Data Science" })).toHaveAttribute("href", "/app/courses/course-1");
    expect(screen.getByText("Item 2 of 2")).toHaveClass("sr-only");
    expect(screen.getByRole("link", { name: /Back to assignment.*Cleaning a dataset/ })).toHaveAttribute("href", "/app/courses/course-1/items/item-1");
    expect(view.container.querySelectorAll("[aria-haspopup=\"dialog\"]")).toHaveLength(1);
  });

  it("sends a learner who is not enrolled to the course overview", async () => {
    mocks.requireUser.mockResolvedValue({ id: "learner-1" });
    mocks.getCourse.mockResolvedValue({ ...course, enrollment: null });
    await expect(NotebookPage({
      params: Promise.resolve({ courseId: "course-1", itemId: "item-1" }),
      searchParams: Promise.resolve({}),
    })).rejects.toThrow("redirect:/app/courses/course-1");
  });
});
