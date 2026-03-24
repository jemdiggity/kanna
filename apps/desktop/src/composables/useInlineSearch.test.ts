import { describe, it, expect } from "bun:test";
import { ref } from "vue";
import { useInlineSearch, type DecorationItem } from "./useInlineSearch";

describe("useInlineSearch", () => {
  describe("match finding", () => {
    it("finds all case-insensitive matches", () => {
      const rawText = ref("Hello hello HELLO world");
      const { query, matchCount } = useInlineSearch(rawText);
      query.value = "hello";
      expect(matchCount.value).toBe(3);
    });

    it("returns zero matches for empty query", () => {
      const rawText = ref("Hello world");
      const { query, matchCount } = useInlineSearch(rawText);
      query.value = "";
      expect(matchCount.value).toBe(0);
    });

    it("returns zero matches when no text matches", () => {
      const rawText = ref("Hello world");
      const { query, matchCount } = useInlineSearch(rawText);
      query.value = "xyz";
      expect(matchCount.value).toBe(0);
    });

    it("handles special regex characters in query", () => {
      const rawText = ref("price is $100 (USD)");
      const { query, matchCount } = useInlineSearch(rawText);
      query.value = "$100 (USD)";
      expect(matchCount.value).toBe(1);
    });
  });

  describe("decorations", () => {
    it("produces decorations with correct offsets", () => {
      const rawText = ref("foo bar foo");
      const { query, decorations } = useInlineSearch(rawText);
      query.value = "foo";
      expect(decorations.value).toHaveLength(2);
      expect(decorations.value[0]).toEqual({
        start: 0, end: 3,
        properties: { class: "search-hl-active" },
      });
      expect(decorations.value[1]).toEqual({
        start: 8, end: 11,
        properties: { class: "search-hl" },
      });
    });

    it("returns empty decorations for empty query", () => {
      const rawText = ref("foo bar");
      const { decorations } = useInlineSearch(rawText);
      expect(decorations.value).toEqual([]);
    });

    it("active match uses search-hl-active, others use search-hl (mutually exclusive)", () => {
      const rawText = ref("aa aa aa");
      const { query, decorations } = useInlineSearch(rawText);
      query.value = "aa";
      const activeCount = decorations.value.filter(
        (d: DecorationItem) => d.properties.class === "search-hl-active"
      ).length;
      expect(activeCount).toBe(1);
      const inactiveCount = decorations.value.filter(
        (d: DecorationItem) => d.properties.class === "search-hl"
      ).length;
      expect(inactiveCount).toBe(2);
    });
  });
});
