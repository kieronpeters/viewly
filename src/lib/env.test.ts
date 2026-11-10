import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `server-only` deliberately throws when imported outside a Server Component
// graph; Vitest is not one, so the marker module is mocked here.
vi.mock("server-only", () => ({}));

import { EnvConfigurationError, getYoutubeApiKey } from "@/lib/env";

const ORIGINAL_KEY = process.env.YOUTUBE_API_KEY;

/** Placeholder used only to prove trimming; not a credential. */
const FAKE_KEY = "test-key-not-a-real-secret";

function setKey(value: string | undefined): void {
  if (value === undefined) {
    delete process.env.YOUTUBE_API_KEY;
  } else {
    process.env.YOUTUBE_API_KEY = value;
  }
}

function readThrownError(): EnvConfigurationError {
  try {
    getYoutubeApiKey();
  } catch (error) {
    if (!(error instanceof EnvConfigurationError)) {
      throw error;
    }

    return error;
  }

  throw new Error("Expected getYoutubeApiKey() to throw, but it returned a key.");
}

beforeEach(() => {
  setKey(undefined);
});

afterEach(() => {
  setKey(ORIGINAL_KEY);
});

describe("getYoutubeApiKey", () => {
  it("throws a typed error with a stable code when the key is missing", () => {
    const error = readThrownError();

    expect(error.name).toBe("EnvConfigurationError");
    expect(error.code).toBe("missing_youtube_api_key");
    expect(error.message).toContain("YOUTUBE_API_KEY");
    expect(error.message).toContain(".env.local");
    expect(error.message).toContain("NEXT_PUBLIC_");
  });

  it("rejects a whitespace-only value", () => {
    setKey("   \t  ");

    const error = readThrownError();

    expect(error.code).toBe("missing_youtube_api_key");
    expect(error.message).toContain(".env.local");
  });

  it("returns a valid key trimmed", () => {
    setKey(`  ${FAKE_KEY}  `);

    expect(getYoutubeApiKey()).toBe(FAKE_KEY);
  });

  it("rejects the .env.example placeholder without echoing it", () => {
    setKey("  YOUR_API_KEY_HERE  ");

    const error = readThrownError();

    expect(error.code).toBe("missing_youtube_api_key");
    expect(error.message).toContain("YOUTUBE_API_KEY");
    expect(error.message).toContain(".env.local");
    expect(error.message).not.toContain("YOUR_API_KEY_HERE");
  });
});
