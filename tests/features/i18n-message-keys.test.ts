import { describe, expect, it } from "vitest";
import en from "@/messages/en.json";
import vi from "@/messages/vi.json";

function keysOf(value: unknown, prefix = ""): string[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return [prefix];
  }

  return Object.entries(value).flatMap(([key, child]) =>
    keysOf(child, prefix ? `${prefix}.${key}` : key),
  );
}

describe("translation catalogs", () => {
  it("provide the identical message keys in Vietnamese and English", () => {
    expect(keysOf(vi).sort()).toEqual(keysOf(en).sort());
  });

  it.each([
    'resources.invalidFilters',
    'resources.types.guide',
    'resources.pathways.ai-emerging-technology',
    'opportunities.course',
    'opportunities.courseStatuses.completed',
    'studio.resources.statuses.published',
    'studio.resources.editor.scope',
    'studio.opportunities.statuses.published',
  ])('provides the ecosystem label key %s in both locales', (key) => {
    expect(keysOf(en)).toContain(key);
    expect(keysOf(vi)).toContain(key);
  });
});
