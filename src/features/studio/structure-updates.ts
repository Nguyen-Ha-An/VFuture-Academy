export type StructureBlockReason = "last-module" | "last-item" | "not-found";

export type StructureRemoval = {
  document: unknown;
  changed: boolean;
  reason?: StructureBlockReason;
};

export type AddedModule = {
  document: unknown;
  moduleId: string | null;
  itemId: string | null;
};

export type AddedItemReference = {
  document: unknown;
  itemId: string | null;
};

type ItemKind = "lesson" | "exam" | "assignment";
type Direction = -1 | 1;

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function moduleRows(manifest: unknown): unknown[] | null {
  const modules = object(manifest)?.modules;
  return Array.isArray(modules) ? modules : null;
}

function recognizedModuleIndexes(modules: readonly unknown[]): number[] {
  return modules.flatMap((value, index) => {
    const row = object(value);
    return row && typeof row.id === "string" && Array.isArray(row.items) ? [index] : [];
  });
}

function recognizedItemIndexes(items: readonly unknown[]): number[] {
  return items.flatMap((value, index) => {
    const row = object(value);
    return row
      && typeof row.id === "string"
      && ["lesson", "exam", "assignment"].includes(String(row.type))
      ? [index]
      : [];
  });
}

function uniqueId(prefix: string, ids: ReadonlySet<string>): string {
  let number = 1;
  while (ids.has(`${prefix}-${number}`)) number += 1;
  return `${prefix}-${number}`;
}

function allIds(manifest: unknown, reservedItemIds: Iterable<string> = []): { modules: Set<string>; items: Set<string> } {
  const moduleIds = new Set<string>();
  const itemIds = new Set<string>(reservedItemIds);
  for (const value of moduleRows(manifest) ?? []) {
    const courseModule = object(value);
    if (typeof courseModule?.id === "string") moduleIds.add(courseModule.id);
    for (const itemValue of Array.isArray(courseModule?.items) ? courseModule.items : []) {
      const item = object(itemValue);
      if (typeof item?.id === "string") itemIds.add(item.id);
    }
  }
  return { modules: moduleIds, items: itemIds };
}

function localizedTitle(current: unknown, locale: "vi" | "en", title: string): unknown {
  if (typeof current === "string") return title;
  const map = object(current);
  return map ? { ...map, [locale]: title } : { [locale]: title };
}

function changedRoot(manifest: unknown): Record<string, unknown> | null {
  const root = object(manifest);
  return root ? structuredClone(root) : null;
}

export function moveModule(manifest: unknown, moduleId: string, direction: Direction): unknown {
  const sourceModules = moduleRows(manifest);
  if (!sourceModules) return manifest;
  const recognized = recognizedModuleIndexes(sourceModules);
  const currentPosition = recognized.findIndex((index) => object(sourceModules[index])?.id === moduleId);
  const targetPosition = currentPosition + direction;
  if (currentPosition < 0 || targetPosition < 0 || targetPosition >= recognized.length) return manifest;

  const root = changedRoot(manifest)!;
  const modules = root.modules as unknown[];
  const currentIndex = recognized[currentPosition]!;
  const targetIndex = recognized[targetPosition]!;
  [modules[currentIndex], modules[targetIndex]] = [modules[targetIndex], modules[currentIndex]];
  return root;
}

export function moveItemReference(
  manifest: unknown,
  moduleId: string,
  itemId: string,
  direction: Direction,
): unknown {
  const sourceModules = moduleRows(manifest);
  if (!sourceModules) return manifest;
  const moduleIndex = sourceModules.findIndex((value) => {
    const row = object(value);
    return row?.id === moduleId && Array.isArray(row.items);
  });
  const sourceItems = object(sourceModules[moduleIndex])?.items;
  if (moduleIndex < 0 || !Array.isArray(sourceItems)) return manifest;
  const recognized = recognizedItemIndexes(sourceItems);
  const currentPosition = recognized.findIndex((index) => object(sourceItems[index])?.id === itemId);
  const targetPosition = currentPosition + direction;
  if (currentPosition < 0 || targetPosition < 0 || targetPosition >= recognized.length) return manifest;

  const root = changedRoot(manifest)!;
  const courseModule = object((root.modules as unknown[])[moduleIndex])!;
  const items = courseModule.items as unknown[];
  const currentIndex = recognized[currentPosition]!;
  const targetIndex = recognized[targetPosition]!;
  [items[currentIndex], items[targetIndex]] = [items[targetIndex], items[currentIndex]];
  return root;
}

export function renameModule(
  manifest: unknown,
  moduleId: string,
  locale: "vi" | "en",
  title: string,
): unknown {
  const sourceModules = moduleRows(manifest);
  const moduleIndex = sourceModules?.findIndex((value) => object(value)?.id === moduleId) ?? -1;
  if (moduleIndex < 0) return manifest;
  const root = changedRoot(manifest)!;
  const courseModule = object((root.modules as unknown[])[moduleIndex]);
  if (!courseModule) return manifest;
  courseModule.title = localizedTitle(courseModule.title, locale, title);
  return root;
}

export function renameItemReference(
  manifest: unknown,
  moduleId: string,
  itemId: string,
  locale: "vi" | "en",
  title: string,
): unknown {
  const sourceModules = moduleRows(manifest);
  const moduleIndex = sourceModules?.findIndex((value) => object(value)?.id === moduleId) ?? -1;
  const sourceItems = object(sourceModules?.[moduleIndex])?.items;
  const itemIndex = Array.isArray(sourceItems)
    ? sourceItems.findIndex((value) => object(value)?.id === itemId)
    : -1;
  if (moduleIndex < 0 || itemIndex < 0) return manifest;
  const root = changedRoot(manifest)!;
  const courseModule = object((root.modules as unknown[])[moduleIndex])!;
  const item = object((courseModule.items as unknown[])[itemIndex]);
  if (!item) return manifest;
  item.title = localizedTitle(item.title, locale, title);
  return root;
}

export function removeModule(manifest: unknown, moduleId: string): StructureRemoval {
  const sourceModules = moduleRows(manifest);
  const moduleIndex = sourceModules?.findIndex((value) => object(value)?.id === moduleId) ?? -1;
  if (!sourceModules || moduleIndex < 0) return { document: manifest, changed: false, reason: "not-found" };
  if (sourceModules.length <= 1) return { document: manifest, changed: false, reason: "last-module" };
  const root = changedRoot(manifest)!;
  (root.modules as unknown[]).splice(moduleIndex, 1);
  return { document: root, changed: true };
}

export function removeItemReference(manifest: unknown, moduleId: string, itemId: string): StructureRemoval {
  const sourceModules = moduleRows(manifest);
  const moduleIndex = sourceModules?.findIndex((value) => object(value)?.id === moduleId) ?? -1;
  const sourceItems = object(sourceModules?.[moduleIndex])?.items;
  const itemIndex = Array.isArray(sourceItems)
    ? sourceItems.findIndex((value) => object(value)?.id === itemId)
    : -1;
  if (moduleIndex < 0 || !Array.isArray(sourceItems) || itemIndex < 0) {
    return { document: manifest, changed: false, reason: "not-found" };
  }
  if (sourceItems.length <= 1) return { document: manifest, changed: false, reason: "last-item" };
  const root = changedRoot(manifest)!;
  const courseModule = object((root.modules as unknown[])[moduleIndex])!;
  (courseModule.items as unknown[]).splice(itemIndex, 1);
  return { document: root, changed: true };
}

export function addModule(
  manifest: unknown,
  title: string,
  itemTitle: string,
  reservedItemIds: Iterable<string> = [],
): AddedModule {
  const sourceModules = moduleRows(manifest);
  if (!sourceModules) return { document: manifest, moduleId: null, itemId: null };
  const ids = allIds(manifest, reservedItemIds);
  const moduleId = uniqueId("module", ids.modules);
  const itemId = uniqueId("lesson", ids.items);
  const root = changedRoot(manifest)!;
  (root.modules as unknown[]).push({
    id: moduleId,
    title,
    items: [{ id: itemId, type: "lesson", title: itemTitle }],
  });
  return { document: root, moduleId, itemId };
}

export function addItemReference(
  manifest: unknown,
  moduleId: string,
  kind: ItemKind,
  title: string,
  reservedItemIds: Iterable<string> = [],
): AddedItemReference {
  const sourceModules = moduleRows(manifest);
  const moduleIndex = sourceModules?.findIndex((value) => {
    const row = object(value);
    return row?.id === moduleId && Array.isArray(row.items);
  }) ?? -1;
  if (moduleIndex < 0) return { document: manifest, itemId: null };
  const itemId = uniqueId(kind, allIds(manifest, reservedItemIds).items);
  const root = changedRoot(manifest)!;
  const courseModule = object((root.modules as unknown[])[moduleIndex])!;
  (courseModule.items as unknown[]).push({ id: itemId, type: kind, title });
  return { document: root, itemId };
}
