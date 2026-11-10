import { describe, expect, it } from "vitest";

import {
  extractChapters,
  MINIMUM_CHAPTER_COUNT,
  splitDescription,
  type DescriptionToken,
} from "./description-timestamps";

function timestampsOf(tokens: readonly DescriptionToken[]) {
  return tokens.flatMap((token) =>
    token.type === "timestamp" ? [{ text: token.text, seconds: token.seconds }] : [],
  );
}

function reconstruct(tokens: readonly DescriptionToken[]): string {
  return tokens.map((token) => token.text).join("");
}

describe("splitDescription timestamps", () => {
  it("parses m:ss and h:mm:ss into seconds", () => {
    expect(
      timestampsOf(splitDescription("Start at 0:00, demo at 12:34, encore at 1:02:03.")),
    ).toEqual([
      { text: "0:00", seconds: 0 },
      { text: "12:34", seconds: 754 },
      { text: "1:02:03", seconds: 3_723 },
    ]);
  });

  it("preserves the original description character for character", () => {
    const text = "0:00 Intro\n12:34 https://example.com/docs\n1:02:03 End";
    const tokens = splitDescription(text);

    expect(reconstruct(tokens)).toBe(text);
    expect(tokens.every((token) => token.text !== "")).toBe(true);
  });

  it("emits timestamps and text in document order", () => {
    expect(splitDescription("Intro 0:05 then 0:10")).toEqual([
      { type: "text", text: "Intro " },
      { type: "timestamp", text: "0:05", seconds: 5 },
      { type: "text", text: " then " },
      { type: "timestamp", text: "0:10", seconds: 10 },
    ]);
  });

  it("keeps the source padding in the token text", () => {
    // The description text must not change visually; only chapters normalize.
    expect(timestampsOf(splitDescription("00:05"))).toEqual([{ text: "00:05", seconds: 5 }]);
  });

  it("accepts timestamps glued to non-Latin text", () => {
    expect(timestampsOf(splitDescription("0:00イントロ"))).toEqual([{ text: "0:00", seconds: 0 }]);
  });

  it("rejects clock times, ratios and longer colon chains", () => {
    const text = "5:00pm 1:2 1:60 12:345 1:02:03:04 v1:20 1.02:30 1920:12";
    const tokens = splitDescription(text);

    expect(timestampsOf(tokens)).toEqual([]);
    expect(reconstruct(tokens)).toBe(text);
  });

  it("never treats a timestamp inside a URL as a timestamp", () => {
    const text = "https://example.com/watch?t=1:02 and https://example.com/0:30";
    const tokens = splitDescription(text);

    expect(timestampsOf(tokens)).toEqual([]);
    expect(tokens).toEqual([
      { type: "link", text: "https://example.com/watch?t=1:02", href: text.split(" and ")[0] },
      { type: "text", text: " and " },
      { type: "link", text: "https://example.com/0:30", href: "https://example.com/0:30" },
    ]);
  });

  it("leaves unsafe schemes as text next to a parsed timestamp", () => {
    const text = "javascript:alert(1) 0:10 data:text/html,<b>x</b>";
    const tokens = splitDescription(text);

    expect(tokens.filter((token) => token.type === "link")).toEqual([]);
    expect(timestampsOf(tokens)).toEqual([{ text: "0:10", seconds: 10 }]);
    expect(reconstruct(tokens)).toBe(text);
  });

  it("returns a single text token when there is nothing to special-case", () => {
    expect(splitDescription("No timestamps or URLs here.")).toEqual([
      { type: "text", text: "No timestamps or URLs here." },
    ]);
  });
});

describe("extractChapters", () => {
  it("returns chapters ordered by time, not by document order", () => {
    const chapters = extractChapters("12:34 Demo\n0:00 Intro\n1:02:03 Encore");

    expect(chapters).toEqual([
      { seconds: 0, timestamp: "0:00", title: "Intro" },
      { seconds: 754, timestamp: "12:34", title: "Demo" },
      { seconds: 3_723, timestamp: "1:02:03", title: "Encore" },
    ]);
  });

  it("strips a separator between the timestamp and the title", () => {
    const chapters = extractChapters("0:00 - Intro\n12:34 — Setup\n20:00 | Demo");

    expect(chapters.map((chapter) => chapter.title)).toEqual(["Intro", "Setup", "Demo"]);
  });

  it("keeps a bare timestamp as an untitled chapter", () => {
    expect(extractChapters("0:00\n12:34")).toEqual([
      { seconds: 0, timestamp: "0:00", title: "" },
      { seconds: 754, timestamp: "12:34", title: "" },
    ]);
  });

  it("cuts a title at the next timestamp on the same line", () => {
    const chapters = extractChapters("0:00 Intro 0:30 Middle 1:00 End");

    expect(chapters).toEqual([
      { seconds: 0, timestamp: "0:00", title: "Intro" },
      { seconds: 30, timestamp: "0:30", title: "Middle" },
      { seconds: 60, timestamp: "1:00", title: "End" },
    ]);
  });

  it("collapses repeated timestamps to their first mention", () => {
    const chapters = extractChapters("0:00 Intro\n12:34 Demo\n0:00 Intro again");

    expect(chapters).toHaveLength(2);
    expect(chapters[0]).toEqual({ seconds: 0, timestamp: "0:00", title: "Intro" });
  });

  it("ignores timestamps that are part of a URL", () => {
    expect(extractChapters("https://example.com/watch?t=1:02")).toEqual([]);
  });

  it("returns no chapters when there are no timestamps", () => {
    expect(extractChapters("A description with no chapter marks.")).toEqual([]);
    expect(extractChapters("")).toEqual([]);
  });

  it("needs at least two timestamps for a meaningful list", () => {
    expect(MINIMUM_CHAPTER_COUNT).toBe(2);
    expect(extractChapters("0:00 Intro")).toHaveLength(1);
  });
});
