// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { EmptyState, ErrorState, FormField, LoadingState, PageHeader, StatusNotice, SurfaceCard } from "@/components/ui/page";

describe("shared UI foundation", () => {
  it("provides page, surface and form patterns with accessible status semantics", () => {
    render(<><PageHeader eyebrow="Studio" title="Courses" description="Manage courses" /><SurfaceCard>Card content</SurfaceCard><FormField label="Title" hint="Required"><input /></FormField><StatusNotice>Saved</StatusNotice><EmptyState title="No courses" /><LoadingState title="Loading courses" /><ErrorState title="Could not load" /></>);

    expect(screen.getByRole("heading", { level: 1, name: "Courses" })).toBeInTheDocument();
    expect(screen.getByText("Card content")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /Title/ })).toBeInTheDocument();
    expect(screen.getAllByRole("status")).toHaveLength(3);
    expect(screen.getByRole("alert")).toHaveTextContent("Could not load");
  });
});
