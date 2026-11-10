import { describe, expect, it } from "vitest";

import { getPaletteCommands } from "./command-palette-commands";

describe("getPaletteCommands", () => {
  it("lists every required destination in display order when the query is empty", () => {
    const titles = getPaletteCommands("").map((command) => command.title);

    expect(titles).toEqual([
      "Home",
      "Search",
      "Library",
      "Favourites",
      "Watch later",
      "History",
      "Playlists",
      "Stats",
      "About",
      "Copy current page link",
    ]);
  });

  it("uses the canonical library tab URLs", () => {
    const hrefs = new Map(
      getPaletteCommands("").map((command) => [command.title, command.href] as const),
    );

    expect(hrefs.get("Library")).toBe("/library");
    expect(hrefs.get("Favourites")).toBe("/library");
    expect(hrefs.get("Watch later")).toBe("/library?tab=watch-later");
    expect(hrefs.get("History")).toBe("/library?tab=history");
    expect(hrefs.get("Playlists")).toBe("/library?tab=playlists");
    expect(hrefs.get("Stats")).toBe("/library/stats");
    expect(hrefs.get("About")).toBe("/about");
  });

  it("scores titles above keywords and excludes non-matches", () => {
    const results = getPaletteCommands("history");

    expect(results[0].title).toBe("History");
    expect(results.map((command) => command.title)).not.toContain("Home");
    expect(results.map((command) => command.title)).toContain("Stats");
  });

  it("matches keywords and multi-word fuzzy queries", () => {
    expect(getPaletteCommands("queue")[0].title).toBe("Watch later");
    expect(getPaletteCommands("hm")[0].title).toBe("Home");
    expect(getPaletteCommands("lib wat")[0].title).toBe("Watch later");
    expect(getPaletteCommands("watch-later")[0].title).toBe("Watch later");
  });

  it("adds a search command for arbitrary text and keeps exact pages ahead of it", () => {
    const arbitrary = getPaletteCommands("cats");

    expect(arbitrary[0].title).toBe("Search for “cats”");
    expect(arbitrary[0].href).toBe("/search?q=cats");
    expect(getPaletteCommands("home")[0].title).toBe("Home");
    expect(getPaletteCommands("stats")[0].title).toBe("Stats");
  });

  it("makes the Search destination query-aware instead of dropping typed text", () => {
    const results = getPaletteCommands("sea");

    expect(results[0].title).toBe("Search");
    expect(results[0].href).toBe("/search?q=sea");
    expect(results.map((command) => command.title)).not.toContain("Search for “sea”");

    expect(getPaletteCommands("search")[0].href).toBe("/search");
  });
});
