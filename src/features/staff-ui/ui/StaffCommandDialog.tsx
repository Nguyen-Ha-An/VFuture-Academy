"use client";

import { useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  CheckIcon,
  ClipboardCheckIcon,
  CornerDownRightIcon,
  MonitorIcon,
  MoonIcon,
  PenLineIcon,
  PlusIcon,
  ShieldCheckIcon,
  SunIcon,
  UserPlusIcon,
  type LucideIcon,
} from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import type { WorkspaceTheme } from "@/features/workspace-ui/theme";
import { requestNavigation } from "@/lib/navigation-guard";
import type { Permission } from "@/lib/permissions";
import { routes } from "@/lib/routes";
import type { WorkspaceEntries } from "@/lib/workspace-navigation";
import { STAFF_WORKSPACES, type StaffWorkspace } from "@/lib/workspaces";
import { useStaffNavigation } from "../navigation";
import { commandFilter } from "@/lib/search-text";
import { useStaffTheme } from "../theme-client";

export type StaffCommandDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspace: StaffWorkspace;
  permissions: Permission[];
  entries: WorkspaceEntries;
};

const WORKSPACE_LABEL = { studio: "workspaceStudio", grading: "workspaceGrading", admin: "workspaceAdmin" } as const satisfies Record<StaffWorkspace, string>;
/** Same labels and icons as the sidebar's WorkspaceScopeSwitcher. */
const WORKSPACE_ICON = { studio: PenLineIcon, grading: ClipboardCheckIcon, admin: ShieldCheckIcon } as const satisfies Record<StaffWorkspace, LucideIcon>;

type QuickAction = { key: "newCourse" | "inviteMember" | "gradeNext"; href: string; icon: LucideIcon; permissions: readonly Permission[] };

/** Only actions that exist as routes today; each needs one of its permissions in the active workspace. */
const QUICK_ACTIONS: readonly QuickAction[] = [
  // The courses page carries the existing "New course" dialog.
  { key: "newCourse", href: routes.studio.courses(), icon: PlusIcon, permissions: ["content.create", "course.create"] },
  // `invite=1` is wired to the members page in a later PR; until then it lands on the directory.
  { key: "inviteMember", href: routes.admin.users({ invite: 1 }), icon: UserPlusIcon, permissions: ["membership.manage"] },
  { key: "gradeNext", href: routes.grading.queue(), icon: ClipboardCheckIcon, permissions: ["submission.grade"] },
];

/** Same order as `workspaceThemes`, which the top-bar and user-menu theme radios iterate. */
const THEMES = [
  { theme: "system", key: "themeSystem", icon: MonitorIcon },
  { theme: "dark", key: "themeDark", icon: MoonIcon },
  { theme: "light", key: "themeLight", icon: SunIcon },
] as const satisfies ReadonlyArray<{ theme: WorkspaceTheme; key: string; icon: LucideIcon }>;

function currentTheme(): WorkspaceTheme {
  if (typeof document === "undefined") return "system";
  const value = document.querySelector(".vf-staff")?.getAttribute("data-theme");
  return value === "light" || value === "dark" ? value : "system";
}

/**
 * The cmdk half of the staff command menu. Loaded lazily by StaffCommandMenu so
 * cmdk never ships in the initial shell chunk.
 */
export function StaffCommandDialog({ open, onOpenChange, workspace, permissions, entries }: StaffCommandDialogProps) {
  const t = useTranslations("staffUi.shell.command");
  const common = useTranslations("common");
  const router = useRouter();
  const pathname = usePathname();
  const navigation = useStaffNavigation(workspace, permissions);
  const [initialTheme] = useState<WorkspaceTheme>(currentTheme);
  // Stays in step with the top-bar and user-menu theme controls while the palette is mounted.
  const [theme, setTheme] = useStaffTheme(initialTheme);

  const keywords = (key: string) => (t.has(`keywords.${key}`) ? t(`keywords.${key}`) : "");

  // Child sections (Library → Resources, Projects…) are listed under their parent so they are searchable.
  const goItems = navigation.groups.flatMap((group) => group.items).flatMap((item) => [
    { value: `nav:${item.key}`, href: item.href, label: item.label, icon: item.icon, keywords: keywords(item.key), child: false },
    ...(item.sections ?? []).map((section) => ({
      value: `nav:${item.key}:${section.key}`,
      href: section.href,
      label: section.label,
      icon: section.icon,
      keywords: `${keywords(section.key)} ${item.label}`,
      child: true,
    })),
  ]);

  // The switcher's list: every enterable workspace, the current one marked; none with only one.
  const enterable = STAFF_WORKSPACES.flatMap((candidate) => {
    const href = entries[candidate];
    return href ? [{ workspace: candidate, href }] : [];
  });
  const workspaceItems = enterable.length >= 2 ? enterable : [];
  const actions = QUICK_ACTIONS.filter((action) => action.permissions.some((permission) => permissions.includes(permission)));

  async function go(href: string) {
    onOpenChange(false);
    if (href === pathname) return;
    // The unsaved-changes guard only intercepts link clicks and form submits, so ask it explicitly.
    if (!(await requestNavigation())) return;
    router.push(href);
  }

  function chooseTheme(next: WorkspaceTheme) {
    setTheme(next); // applyStaffTheme: cookie + data-theme on the .vf-staff root

    onOpenChange(false);
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("title")}
      description={t("description")}
      closeLabel={common("close")}
      className="top-[15svh] translate-y-0 sm:max-w-lg"
      commandProps={{ filter: commandFilter, loop: true, vimBindings: false, className: "[&_[cmdk-item]]:py-1.5" }}
    >
      <CommandInput placeholder={t("input")} wrapperClassName="pr-12" />
      {/* Groups are divided by a top hairline instead of separators: a role=separator child is not allowed in a listbox (axe aria-required-children). */}
      <CommandList label={t("results")} className="max-h-[min(24rem,60svh)] scroll-py-1 pb-1 [&_[cmdk-group]:not([hidden])~[cmdk-group]:not([hidden])]:border-t [&_[cmdk-group]:not([hidden])~[cmdk-group]:not([hidden])]:border-border">
        <CommandEmpty className="leading-[1.4]">{t("empty")}</CommandEmpty>
        {goItems.length ? (
          <CommandGroup heading={t("groups.goTo")}>
            {goItems.map((item) => (
              <PaletteItem key={item.value} value={item.value} keywords={[item.label, item.keywords]} onSelect={() => void go(item.href)}>
                {item.child ? <CornerDownRightIcon aria-hidden="true" className="ml-1 size-3.5" /> : null}
                <item.icon aria-hidden="true" />
                <span className="truncate">{item.label}</span>
              </PaletteItem>
            ))}
          </CommandGroup>
        ) : null}
        {workspaceItems.length ? (
          <>
            <CommandGroup heading={common("workspaces")}>
              {workspaceItems.map(({ workspace: target, href }) => {
                const Icon = WORKSPACE_ICON[target];
                const label = common(WORKSPACE_LABEL[target]);
                return (
                  <PaletteItem key={target} value={`workspace:${target}`} keywords={[label, keywords(target)]} onSelect={() => void go(href)}>
                    <Icon aria-hidden="true" />
                    <span className="truncate">{label}</span>
                    {target === workspace ? <CurrentMark label={t("theme.current")} /> : null}
                  </PaletteItem>
                );
              })}
            </CommandGroup>
          </>
        ) : null}
        {actions.length ? (
          <>
            <CommandGroup heading={t("groups.actions")}>
              {actions.map((action) => (
                <PaletteItem key={action.key} value={`action:${action.key}`} keywords={[t(`actions.${action.key}`), keywords(action.key)]} onSelect={() => void go(action.href)}>
                  <action.icon aria-hidden="true" />
                  <span className="truncate">{t(`actions.${action.key}`)}</span>
                </PaletteItem>
              ))}
            </CommandGroup>
          </>
        ) : null}
        <CommandGroup heading={t("groups.preferences")}>
          {THEMES.map((option) => (
            <PaletteItem key={option.theme} value={`theme:${option.theme}`} keywords={[t(`theme.${option.theme}`), keywords(option.key)]} onSelect={() => chooseTheme(option.theme)}>
              <option.icon aria-hidden="true" />
              <span className="truncate">{t(`theme.${option.theme}`)}</span>
              {theme === option.theme ? <CurrentMark label={t("theme.current")} /> : null}
            </PaletteItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}

function CurrentMark({ label }: { label: string }) {
  return (
    <span className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground">
      <CheckIcon aria-hidden="true" className="size-3.5" />
      <span className="sr-only">{label}</span>
    </span>
  );
}

function PaletteItem({ value, keywords, onSelect, children }: { value: string; keywords: string[]; onSelect: () => void; children: ReactNode }) {
  return (
    <CommandItem value={value} keywords={keywords.filter(Boolean)} onSelect={onSelect} className="min-h-8 rounded-md py-1.5 text-sm font-medium leading-[1.4]">
      {children}
    </CommandItem>
  );
}
