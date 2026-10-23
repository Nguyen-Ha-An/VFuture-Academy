import { describe, expect, it } from "vitest";

import {
  addItemReference,
  addModule,
  moveItemReference,
  moveModule,
  removeItemReference,
  removeModule,
  renameItemReference,
  renameModule,
} from "@/features/studio/structure-updates";

describe("course structure updates", () => {
  it("moves recognized rows without discarding malformed rows or inline item bodies", () => {
    const malformedModule = { mystery: "keep-module" };
    const malformedItem = { mystery: "keep-item" };
    const inlineLesson = {
      id: "inline-lesson",
      type: "lesson",
      title: { vi: "Bài học", en: "Lesson" },
      required: false,
      estimatedMinutes: 12,
      blocks: [{ type: "paragraph", content: [{ text: "Keep this body" }] }],
      settings: { future: true },
    };
    const manifest = {
      schemaVersion: 1,
      kind: "course",
      id: "course-1",
      futureRoot: { keep: true },
      modules: [
        {
          id: "module-a",
          title: "Module A",
          summary: "Keep summary",
          futureModule: 7,
          items: [inlineLesson, malformedItem, { id: "exam-1", type: "exam", title: "Exam", sections: [{ id: "s1" }] }],
        },
        malformedModule,
        { id: "module-b", title: "Module B", items: [{ id: "assignment-1", type: "assignment", title: "Assignment" }] },
      ],
    };

    const modulesMoved = moveModule(manifest, "module-b", -1);
    expect(modulesMoved).toMatchObject({
      futureRoot: { keep: true },
      modules: [
        { id: "module-b" },
        malformedModule,
        { id: "module-a", summary: "Keep summary", futureModule: 7 },
      ],
    });

    const itemsMoved = moveItemReference(manifest, "module-a", "exam-1", -1);
    const movedItems = ((itemsMoved as { modules: Array<{ items: unknown[] }> }).modules[0]!).items;
    expect(movedItems[0]).toEqual((manifest.modules[0] as { items: unknown[] }).items[2]);
    expect(movedItems[1]).toEqual(malformedItem);
    expect(movedItems[2]).toEqual(inlineLesson);
  });

  it("renames only the selected locale while preserving every other field", () => {
    const manifest = {
      schemaVersion: 1,
      kind: "course",
      id: "course-1",
      modules: [{
        id: "module-1",
        title: { vi: "Mô-đun", en: "Module" },
        summary: { en: "Keep" },
        items: [{ id: "lesson-1", type: "lesson", title: { vi: "Bài", en: "Lesson" }, required: true, future: "keep" }],
      }],
    };

    const moduleRenamed = renameModule(manifest, "module-1", "en", "Renamed module");
    const itemRenamed = renameItemReference(moduleRenamed, "module-1", "lesson-1", "vi", "Bài mới");
    expect(itemRenamed).toEqual({
      ...manifest,
      modules: [{
        ...manifest.modules[0],
        title: { vi: "Mô-đun", en: "Renamed module" },
        items: [{ ...manifest.modules[0]!.items[0], title: { vi: "Bài mới", en: "Lesson" } }],
      }],
    });
  });

  it("removes only references and reports last-item and last-module minimums", () => {
    const orphan = { id: "lesson-1", kind: "lesson", blocks: [{ type: "paragraph", content: [{ text: "Retain me" }] }] };
    const workspace = {
      manifest: {
        id: "course-1",
        modules: [
          { id: "module-1", title: "One", items: [{ id: "lesson-1", type: "lesson" }, { id: "lesson-2", type: "lesson" }] },
          { id: "module-2", title: "Two", items: [{ id: "lesson-3", type: "lesson" }] },
        ],
      },
      items: { "lesson-1": orphan },
    };

    const removedItem = removeItemReference(workspace.manifest, "module-1", "lesson-1");
    expect(removedItem.changed).toBe(true);
    expect(removedItem.document).toMatchObject({ modules: [{ items: [{ id: "lesson-2" }] }, { id: "module-2" }] });
    expect(workspace.items["lesson-1"]).toBe(orphan);

    const blockedItem = removeItemReference(removedItem.document, "module-1", "lesson-2");
    expect(blockedItem).toEqual({ changed: false, reason: "last-item", document: removedItem.document });

    const removedModule = removeModule(removedItem.document, "module-1");
    expect(removedModule.changed).toBe(true);
    expect(removedModule.document).toMatchObject({ modules: [{ id: "module-2" }] });
    expect(removeModule(removedModule.document, "module-2")).toEqual({
      changed: false,
      reason: "last-module",
      document: removedModule.document,
    });
  });

  it("adds collision-free stable ids without rewriting existing rows", () => {
    const manifest = {
      id: "course-1",
      modules: [
        { id: "module-1", title: "Existing", items: [{ id: "lesson-1", type: "lesson", title: "Existing item", body: { keep: true } }] },
        { id: "module-2", malformed: true },
      ],
    };

    const addedModule = addModule(manifest, "New module", "New item");
    expect(addedModule.moduleId).toBe("module-3");
    expect(addedModule.itemId).toBe("lesson-2");
    expect(addedModule.document).toMatchObject({
      modules: [
        { id: "module-1", items: [{ id: "lesson-1", body: { keep: true } }] },
        { id: "module-2", malformed: true },
        { id: "module-3", title: "New module", items: [{ id: "lesson-2", type: "lesson", title: "New item" }] },
      ],
    });

    const addedItem = addItemReference(addedModule.document, "module-1", "lesson", "Another item");
    expect(addedItem.itemId).toBe("lesson-3");
    const withItem = addedItem.document as { modules: Array<Record<string, unknown> & { items?: unknown[] }> };
    expect(withItem.modules[0]!.items).toEqual([
      (manifest.modules[0] as { items: unknown[] }).items[0],
      { id: "lesson-3", type: "lesson", title: "Another item" },
    ]);
    expect(withItem.modules.slice(1)).toEqual((addedModule.document as { modules: unknown[] }).modules.slice(1));
  });

  it("does not reuse retained orphan or pending source ids after references are removed", () => {
    const manifest = {
      id: "course-1",
      modules: [
        { id: "module-1", title: "One", items: [{ id: "lesson-1", type: "lesson" }, { id: "lesson-2", type: "lesson" }] },
        { id: "module-2", title: "Two", items: [{ id: "lesson-3", type: "lesson" }] },
      ],
    };
    const reserved = new Set(["lesson-2", "lesson-3", "lesson-4"]);

    const withoutItem = removeItemReference(manifest, "module-1", "lesson-2").document;
    const afterItemRemoval = addItemReference(withoutItem, "module-1", "lesson", "New", reserved);
    expect(afterItemRemoval.itemId).toBe("lesson-5");

    const withoutModule = removeModule(manifest, "module-2").document;
    const afterModuleRemoval = addModule(withoutModule, "New module", "New item", reserved);
    expect(afterModuleRemoval.itemId).toBe("lesson-5");
  });
});
