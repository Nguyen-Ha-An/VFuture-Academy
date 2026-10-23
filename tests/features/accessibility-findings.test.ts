import { describe, expect, it } from "vitest";

import {
  confirmedKnownYouTubePlayerFindings,
  KNOWN_YOUTUBE_PLAYER_FINDINGS,
  partitionAccessibilityFindings,
  type AccessibilityFinding,
} from "../e2e/support/accessibility";

describe("accessibility finding ownership", () => {
  const youtubeFindings: AccessibilityFinding[] = [
    { id: "aria-allowed-attr", impact: "critical", target: "iframe .ytmVideoInfoVideoTitle" },
    { id: "aria-prohibited-attr", impact: "serious", target: "iframe #movie_player" },
  ];

  it("confirms the findings only for one exact HTTPS YouTube privacy embed", () => {
    expect(confirmedKnownYouTubePlayerFindings([
      "https://www.youtube-nocookie.com/embed/abc123?rel=0",
    ])).toEqual(KNOWN_YOUTUBE_PLAYER_FINDINGS);
  });

  it.each([
    ["no frames", []],
    ["an HTTP YouTube frame", ["http://www.youtube-nocookie.com/embed/abc123"]],
    ["another origin", ["https://example.com/embed/abc123"]],
    ["a non-embed YouTube path", ["https://www.youtube-nocookie.com/watch?v=abc123"]],
    ["an ambiguous additional frame", [
      "https://www.youtube-nocookie.com/embed/abc123",
      "https://example.com/player",
    ]],
  ])("does not confirm generic iframe targets with %s", (_case, frameSources) => {
    const confirmed = confirmedKnownYouTubePlayerFindings(frameSources);
    expect(confirmed).toEqual([]);
    expect(partitionAccessibilityFindings(youtubeFindings, confirmed)).toEqual({
      owned: youtubeFindings,
      thirdParty: [],
    });
  });

  it("separates only the exact known YouTube player nodes after origin confirmation", () => {
    const findings: AccessibilityFinding[] = [
      ...youtubeFindings,
      { id: "aria-allowed-attr", impact: "critical", target: "#owned-heading" },
      { id: "aria-prohibited-attr", impact: "serious", target: "iframe #another-provider" },
    ];

    const confirmed = confirmedKnownYouTubePlayerFindings([
      "https://www.youtube-nocookie.com/embed/abc123",
    ]);
    expect(partitionAccessibilityFindings(findings, confirmed)).toEqual({
      thirdParty: findings.slice(0, 2),
      owned: findings.slice(2),
    });
  });
});
