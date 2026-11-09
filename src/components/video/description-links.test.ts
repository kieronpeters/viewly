import { describe, expect, it } from "vitest";

import { splitDescriptionLinks, type DescriptionSegment } from "./description-links";

interface ExpectedLink {
  /** Anchor text: exactly the slice of the input that was linkified. */
  readonly text: string;
  /** Normalized `href`, as produced by `URL`. */
  readonly href: string;
}

interface LinkCase {
  readonly name: string;
  readonly text: string;
  /** Links expected, in document order. */
  readonly links: readonly ExpectedLink[];
}

/**
 * Table of description strings and the links they must produce. The invariants
 * that apply to every row are asserted once, below: the output reconstructs the
 * input exactly and every link is an absolute `http`/`https` URL.
 */
const LINK_CASES: readonly LinkCase[] = [
  {
    name: "plain text with no links",
    text: "Just a plain description with no URLs at all.",
    links: [],
  },
  {
    name: "empty text",
    text: "",
    links: [],
  },
  {
    name: "valid http URL",
    text: "Watch on http://example.com today.",
    links: [{ text: "http://example.com", href: "http://example.com/" }],
  },
  {
    name: "valid https URL with path, query and fragment",
    text: "https://example.com/watch?v=abc#t=10",
    links: [
      {
        text: "https://example.com/watch?v=abc#t=10",
        href: "https://example.com/watch?v=abc#t=10",
      },
    ],
  },
  {
    name: "uppercase scheme and host are normalized in the href only",
    text: "HTTPS://EXAMPLE.COM/Path",
    links: [{ text: "HTTPS://EXAMPLE.COM/Path", href: "https://example.com/Path" }],
  },
  {
    name: "unicode around and inside the URL",
    text: "日本語 https://example.com/日本語 と English",
    links: [
      {
        text: "https://example.com/日本語",
        href: "https://example.com/%E6%97%A5%E6%9C%AC%E8%AA%9E",
      },
    ],
  },
  {
    name: "multiple links in one description",
    text: "a https://one.example/x b http://two.example/c d",
    links: [
      { text: "https://one.example/x", href: "https://one.example/x" },
      { text: "http://two.example/c", href: "http://two.example/c" },
    ],
  },
  {
    name: "trailing sentence punctuation stays out of the link",
    text: "Docs: https://example.com/docs.",
    links: [{ text: "https://example.com/docs", href: "https://example.com/docs" }],
  },
  {
    name: "trailing comma and exclamation stay out of the links",
    text: "See https://example.com/a, then https://example.com/b!",
    links: [
      { text: "https://example.com/a", href: "https://example.com/a" },
      { text: "https://example.com/b", href: "https://example.com/b" },
    ],
  },
  {
    name: "unbalanced closing parenthesis is dropped",
    text: "(see https://example.com/a)",
    links: [{ text: "https://example.com/a", href: "https://example.com/a" }],
  },
  {
    name: "unbalanced closing bracket before a full stop is dropped",
    text: "[https://example.com/a].",
    links: [{ text: "https://example.com/a", href: "https://example.com/a" }],
  },
  {
    name: "balanced parentheses inside the URL are kept",
    text: "https://en.wikipedia.org/wiki/Foo_(bar)",
    links: [
      {
        text: "https://en.wikipedia.org/wiki/Foo_(bar)",
        href: "https://en.wikipedia.org/wiki/Foo_(bar)",
      },
    ],
  },
  {
    name: "full-width closing parenthesis around a URL is dropped",
    text: "（https://example.com）",
    links: [{ text: "https://example.com", href: "https://example.com/" }],
  },
  {
    name: "full-width closing brackets around URLs are dropped",
    text: "「https://example.com」 【https://example.com】 《https://example.com》 〈https://example.com〉",
    links: [
      { text: "https://example.com", href: "https://example.com/" },
      { text: "https://example.com", href: "https://example.com/" },
      { text: "https://example.com", href: "https://example.com/" },
      { text: "https://example.com", href: "https://example.com/" },
    ],
  },
  {
    name: "full-width comma after the host stays out of the host",
    text: "https://example.com、こちら",
    links: [{ text: "https://example.com", href: "https://example.com/" }],
  },
  {
    name: "full-width comma and full stop stay out of the links",
    text: "https://example.com、次は https://example.com。",
    links: [
      { text: "https://example.com", href: "https://example.com/" },
      { text: "https://example.com", href: "https://example.com/" },
    ],
  },
  {
    name: "full-width exclamation, question, colon and semicolon stay out of the links",
    text: "https://example.com！ https://example.com？ https://example.com： https://example.com；",
    links: [
      { text: "https://example.com", href: "https://example.com/" },
      { text: "https://example.com", href: "https://example.com/" },
      { text: "https://example.com", href: "https://example.com/" },
      { text: "https://example.com", href: "https://example.com/" },
    ],
  },
  {
    name: "mixed ASCII and full-width punctuation around URLs",
    text: "［https://example.com/a］. と (https://example.com/b）。",
    links: [
      { text: "https://example.com/a", href: "https://example.com/a" },
      { text: "https://example.com/b", href: "https://example.com/b" },
    ],
  },
  {
    name: "balanced full-width brackets and ASCII commas inside the path are kept",
    text: "https://example.com/a（b） and https://example.com/a,b",
    links: [
      {
        text: "https://example.com/a（b）",
        href: "https://example.com/a%EF%BC%88b%EF%BC%89",
      },
      { text: "https://example.com/a,b", href: "https://example.com/a,b" },
    ],
  },
  {
    name: "javascript: stays text",
    text: "javascript:alert(1)",
    links: [],
  },
  {
    name: "javascript: next to a safe link stays text",
    text: "javascript:alert(1) https://example.com ftp://files.example/x",
    links: [{ text: "https://example.com", href: "https://example.com/" }],
  },
  {
    name: "a line break ends the URL so javascript: stays text",
    text: "https://example.com\njavascript:alert(1)",
    links: [{ text: "https://example.com", href: "https://example.com/" }],
  },
  {
    name: "data: stays text",
    text: "data:text/html,<b>hi</b>",
    links: [],
  },
  {
    name: "ftp: stays text",
    text: "ftp://example.com/file.txt",
    links: [],
  },
  {
    name: "file: stays text",
    text: "file:///etc/passwd",
    links: [],
  },
  {
    name: "scheme-relative URL stays text",
    text: "//example.com/path",
    links: [],
  },
  {
    name: "bare scheme without a host stays text",
    text: "https:// and http://",
    links: [],
  },
  {
    name: "single-slash typo stays text",
    text: "http:/example.com",
    links: [],
  },
  {
    name: "scheme followed only by a query stays text",
    text: "https://?q=1",
    links: [],
  },
  {
    name: "scheme followed only by a fragment stays text",
    text: "https://#section",
    links: [],
  },
  {
    name: "unbalanced IPv6 host stays text",
    text: "http://[::1",
    links: [],
  },
  {
    name: "IPv6 host with a port is a link",
    text: "http://[::1]:8080/",
    links: [{ text: "http://[::1]:8080/", href: "http://[::1]:8080/" }],
  },
];

function linksOf(segments: readonly DescriptionSegment[]): ExpectedLink[] {
  return segments.flatMap((segment) =>
    segment.type === "link" ? [{ text: segment.text, href: segment.href }] : [],
  );
}

/** Concatenating every segment's text must give back the input byte for byte. */
function reconstruct(segments: readonly DescriptionSegment[]): string {
  return segments.map((segment) => segment.text).join("");
}

describe("splitDescriptionLinks", () => {
  describe.each(LINK_CASES.map((testCase) => [testCase.name, testCase] as const))(
    "%s",
    (_name, { text, links }) => {
      it("extracts exactly the expected links", () => {
        expect(linksOf(splitDescriptionLinks(text))).toEqual(links);
      });

      it("preserves the original text", () => {
        const segments = splitDescriptionLinks(text);

        expect(reconstruct(segments)).toBe(text);
        expect(segments.every((segment) => segment.text !== "")).toBe(true);
      });

      it("only ever links absolute http and https URLs", () => {
        for (const segment of splitDescriptionLinks(text)) {
          if (segment.type !== "link") {
            continue;
          }

          const { protocol } = new URL(segment.href);

          expect(["http:", "https:"]).toContain(protocol);
          expect(segment.href.toLowerCase()).not.toContain("javascript:");
          expect(segment.href.toLowerCase()).not.toContain("data:");
          expect(segment.text).not.toBe("");
        }
      });
    },
  );

  it("keeps trailing punctuation as a separate text segment after the link", () => {
    expect(splitDescriptionLinks("Docs: https://example.com/docs.")).toEqual([
      { type: "text", text: "Docs: " },
      { type: "link", text: "https://example.com/docs", href: "https://example.com/docs" },
      { type: "text", text: "." },
    ]);
  });

  it("alternates text and link segments for multiple links", () => {
    expect(splitDescriptionLinks("a https://one.example b http://two.example")).toEqual([
      { type: "text", text: "a " },
      { type: "link", text: "https://one.example", href: "https://one.example/" },
      { type: "text", text: " b " },
      { type: "link", text: "http://two.example", href: "http://two.example/" },
    ]);
  });

  it("leaves text with no links as a single text segment", () => {
    expect(splitDescriptionLinks("javascript:alert(1)")).toEqual([
      { type: "text", text: "javascript:alert(1)" },
    ]);
  });

  it("emits no segments for empty text", () => {
    expect(splitDescriptionLinks("")).toEqual([]);
  });

  it("does not leak regular-expression state between calls", () => {
    const text = "https://one.example and https://two.example";

    expect(splitDescriptionLinks(text)).toEqual(splitDescriptionLinks(text));
    expect(linksOf(splitDescriptionLinks(text))).toHaveLength(2);
  });

  it("treats dot-only hosts as text once trailing dots are trimmed", () => {
    // `new URL("https://.")` alone would succeed with the host ".", but the
    // trailing-dot trim runs first and leaves `https://`, which cannot be
    // parsed. Nothing without a real host reaches an href.
    expect(linksOf(splitDescriptionLinks("https://."))).toEqual([]);
    expect(linksOf(splitDescriptionLinks("http://.."))).toEqual([]);
  });

  it("trims full-width CJK closing punctuation from the end of a URL", () => {
    expect(splitDescriptionLinks("（https://example.com）")).toEqual([
      { type: "text", text: "（" },
      { type: "link", text: "https://example.com", href: "https://example.com/" },
      { type: "text", text: "）" },
    ]);
  });

  it("never re-parses the host with full-width punctuation inside it", () => {
    // `URL` folds these through IDNA (`）` → `)`, `、` → `,`, `。` → `.`), which
    // used to yield hosts such as `example.com)` or an `xn--` variant of the
    // trailing words. The host must stay exactly `example.com` in every case.
    const inputs = [
      "https://example.com）",
      "https://example.com」",
      "https://example.com】",
      "https://example.com》",
      "https://example.com〉",
      "https://example.com〕",
      "https://example.com］",
      "https://example.com｝",
      "https://example.com、こちら",
      "https://example.com。こちら",
      "https://example.com，",
      "https://example.com．",
      "https://example.com！",
      "https://example.com？",
      "https://example.com：",
      "https://example.com；",
    ];

    for (const input of inputs) {
      const links = linksOf(splitDescriptionLinks(input));

      expect(links, input).toHaveLength(1);
      expect(new URL(links[0].href).hostname, input).toBe("example.com");
    }
  });
});
