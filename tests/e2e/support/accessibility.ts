import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";

import { expect } from "./fixtures";

const WCAG_AA_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

export type AccessibilityFinding = {
  id: string;
  impact: string | null;
  target: string;
};

export const KNOWN_YOUTUBE_PLAYER_FINDINGS = [
  { id: "aria-allowed-attr", target: "iframe .ytmVideoInfoVideoTitle" },
  { id: "aria-prohibited-attr", target: "iframe #movie_player" },
] as const;

export function confirmedKnownYouTubePlayerFindings(
  frameSources: string[],
): ReadonlyArray<Pick<AccessibilityFinding, "id" | "target">> {
  if (frameSources.length !== 1) return [];
  try {
    const source = new URL(frameSources[0]);
    const isExactOrigin = source.origin === "https://www.youtube-nocookie.com" && !source.username && !source.password;
    const isEmbedPath = /^\/embed\/[\w-]{3,20}\/?$/.test(source.pathname);
    return isExactOrigin && isEmbedPath ? KNOWN_YOUTUBE_PLAYER_FINDINGS : [];
  } catch {
    return [];
  }
}

export function partitionAccessibilityFindings(
  findings: AccessibilityFinding[],
  knownThirdPartyFindings: ReadonlyArray<Pick<AccessibilityFinding, "id" | "target">>,
): { owned: AccessibilityFinding[]; thirdParty: AccessibilityFinding[] } {
  const isKnownThirdPartyFinding = (finding: AccessibilityFinding) => knownThirdPartyFindings.some(
    (known) => known.id === finding.id && known.target === finding.target,
  );
  return {
    owned: findings.filter((finding) => !isKnownThirdPartyFinding(finding)),
    thirdParty: findings.filter(isKnownThirdPartyFinding),
  };
}

async function wcagFindings(page: Page): Promise<AccessibilityFinding[]> {
  const results = await new AxeBuilder({ page }).withTags(WCAG_AA_TAGS).analyze();
  return results.violations.flatMap(({ id, impact, nodes }) => nodes.map((node) => ({
    id,
    impact: impact ?? null,
    target: node.target.join(" "),
  })));
}

export async function expectNoWcagViolations(page: Page): Promise<void> {
  expect(await wcagFindings(page)).toEqual([]);
}

export async function expectNoOwnedWcagViolations(
  page: Page,
): Promise<AccessibilityFinding[]> {
  const frameSources = await page.locator("iframe").evaluateAll((frames) => frames.map(
    (frame) => (frame as HTMLIFrameElement).src,
  ));
  const { owned, thirdParty } = partitionAccessibilityFindings(
    await wcagFindings(page),
    confirmedKnownYouTubePlayerFindings(frameSources),
  );
  expect(owned).toEqual([]);
  return thirdParty;
}
