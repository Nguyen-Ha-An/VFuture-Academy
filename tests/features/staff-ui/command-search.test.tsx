import { describe, expect, it } from "vitest";
import { commandFilter, matchesSearch, normalizeSearchText, searchScore } from "@/features/staff-ui/search";

describe("staff command search", () => {
  it("normalizes Vietnamese text: NFD marks stripped, đ/Đ folded, lowercased, spaces collapsed", () => {
    expect(normalizeSearchText("  Duyệt   nội dung ")).toBe("duyet noi dung");
    expect(normalizeSearchText("Đăng xuất")).toBe("dang xuat");
    expect(normalizeSearchText("đường dẫn")).toBe("duong dan");
    // Precomposed and decomposed input normalize to the same string.
    expect(normalizeSearchText("Khoá học".normalize("NFD"))).toBe(normalizeSearchText("Khoá học".normalize("NFC")));
  });

  it("matches with and without diacritics", () => {
    expect(matchesSearch("duyet", ["Duyệt nội dung"])).toBe(true);
    expect(matchesSearch("dang", ["Đăng"])).toBe(true);
    expect(matchesSearch("Đăng", ["dang bai"])).toBe(true);
    expect(matchesSearch("DUYỆT", ["Duyệt nội dung"])).toBe(true);
    expect(matchesSearch("khoa hoc", ["Khoá học"])).toBe(true);
    expect(matchesSearch("xyz", ["Duyệt nội dung"])).toBe(false);
  });

  it("requires every token and searches keywords as well as the label", () => {
    expect(matchesSearch("noi duyet", ["Duyệt nội dung"])).toBe(true);
    expect(matchesSearch("duyet khoa", ["Duyệt nội dung"])).toBe(false);
    expect(matchesSearch("review", ["Hàng đợi duyệt", "Review queue"])).toBe(true);
    expect(matchesSearch("hang doi", ["Review queue", "Hàng đợi duyệt"])).toBe(true);
  });

  it("ranks label prefixes above word starts above substrings, and an empty query matches all", () => {
    expect(searchScore("", ["Anything"])).toBe(1);
    expect(searchScore("hang", ["Hàng đợi duyệt"])).toBe(1);
    expect(searchScore("duyet", ["Hàng đợi duyệt"])).toBe(0.75);
    expect(searchScore("uyet", ["Hàng đợi duyệt"])).toBe(0.5);
    expect(searchScore("hang", [])).toBe(0);
  });

  it("works as a cmdk filter that ignores the opaque item value", () => {
    expect(commandFilter("nav:reviews", "duyet", ["Hàng đợi duyệt"])).toBeGreaterThan(0);
    expect(commandFilter("nav:reviews", "reviews")).toBe(0);
    expect(commandFilter("nav:reviews", "nav", ["Hàng đợi duyệt"])).toBe(0);
  });
});
