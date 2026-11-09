import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// env.ts imports the `server-only` marker, which throws outside a Server
// Component graph. Vitest is not one, so the marker is mocked here.
vi.mock("server-only", () => ({}));

import { EnvConfigurationError } from "@/lib/env";
import {
  API_ERROR_STATUS,
  apiErrorResult,
  jsonError,
  jsonErrorResult,
  logServerError,
  mapErrorToResponse,
} from "@/lib/errors";
import { assertSearchQuery, assertVideoId, DomainValidationError } from "@/shared/validation";

/** Credential-shaped fake: never a real key, only used to prove redaction. */
const FAKE_KEY = "AIzaSyFAKE-key-for-redaction-tests-000";
const ORIGINAL_KEY = process.env.YOUTUBE_API_KEY;

function catchThrown(run: () => void): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }

  throw new Error("Expected the callback to throw.");
}

function setKey(value: string | undefined): void {
  if (value === undefined) {
    delete process.env.YOUTUBE_API_KEY;
  } else {
    process.env.YOUTUBE_API_KEY = value;
  }
}

beforeEach(() => {
  setKey(FAKE_KEY);
});

afterEach(() => {
  setKey(ORIGINAL_KEY);
  vi.restoreAllMocks();
});

describe("API_ERROR_STATUS", () => {
  it("keeps the existing code to status mapping", () => {
    expect(API_ERROR_STATUS.VALIDATION_FAILED).toBe(400);
    expect(API_ERROR_STATUS.NOT_FOUND).toBe(404);
    expect(API_ERROR_STATUS.UPSTREAM_ERROR).toBe(502);
    expect(API_ERROR_STATUS.CONFIGURATION_ERROR).toBe(500);
    expect(API_ERROR_STATUS.INTERNAL_ERROR).toBe(500);
  });

  it("maps RATE_LIMITED to 429 and UNAVAILABLE to 503", () => {
    expect(API_ERROR_STATUS.RATE_LIMITED).toBe(429);
    expect(API_ERROR_STATUS.UNAVAILABLE).toBe(503);
  });

  it("builds envelopes with the new codes and their statuses", async () => {
    const limited = apiErrorResult("RATE_LIMITED", "Quota exceeded.");
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe("RATE_LIMITED");

    const unavailable = apiErrorResult("UNAVAILABLE", "Try again later.");
    expect(unavailable.status).toBe(503);
    expect(unavailable.body.error.code).toBe("UNAVAILABLE");

    const response = jsonErrorResult(unavailable);
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: { code: "UNAVAILABLE", message: "Try again later." },
    });
  });
});

describe("mapErrorToResponse", () => {
  it("maps a DomainValidationError to 400 with its field and authored message", () => {
    const error = catchThrown(() => assertVideoId("too-short"));
    expect(error).toBeInstanceOf(DomainValidationError);

    const { status, body } = mapErrorToResponse(error);

    expect(status).toBe(400);
    expect(status).toBe(API_ERROR_STATUS.VALIDATION_FAILED);
    expect(body.error.code).toBe("VALIDATION_FAILED");
    expect(body.error.field).toBe("videoId");
    expect(body.error.message).toContain("Video id");
    expect(Object.keys(body.error).sort()).toEqual(["code", "field", "message"]);
  });

  it("maps a malformed_payload DomainValidationError to 502 UPSTREAM_ERROR", () => {
    // Thrown by the normalizers when an upstream body is unusable, not by input
    // validation; the hostile message proves payload text is never forwarded.
    const error = new DomainValidationError(
      "malformed_payload",
      'Video response must contain an items array. got: {"items":"user-supplied-body"}',
    );

    const { status, body } = mapErrorToResponse(error);

    expect(status).toBe(502);
    expect(status).toBe(API_ERROR_STATUS.UPSTREAM_ERROR);
    expect(body.error.code).toBe("UPSTREAM_ERROR");
    expect(body.error).not.toHaveProperty("field");
    expect(body.error.message).not.toContain("items");
    expect(body.error.message).not.toContain("user-supplied-body");
    expect(JSON.stringify(body)).not.toContain("user-supplied-body");
  });

  it("keeps input validation codes at 400 with their field", () => {
    const error = catchThrown(() => assertSearchQuery("   "));

    const { status, body } = mapErrorToResponse(error);

    expect(status).toBe(400);
    expect(status).toBe(API_ERROR_STATUS.VALIDATION_FAILED);
    expect(body.error.code).toBe("VALIDATION_FAILED");
    expect(body.error.field).toBe("searchQuery");
    expect(body.error.message).toBe("Search query must not be empty.");
  });

  it("maps an EnvConfigurationError to a generic 500 without the key or env name", () => {
    // Deliberately hostile message: the mapper must not forward it.
    const error = new EnvConfigurationError(
      "missing_youtube_api_key",
      `YOUTUBE_API_KEY is set to ${FAKE_KEY} in .env.local`,
    );

    const { status, body } = mapErrorToResponse(error);

    expect(status).toBe(500);
    expect(body.error.code).toBe("CONFIGURATION_ERROR");
    expect(body.error.message).not.toContain(FAKE_KEY);
    expect(body.error.message).not.toContain("YOUTUBE_API_KEY");
    expect(body.error.message).not.toContain(".env.local");
    expect(body.error).not.toHaveProperty("field");
  });

  it("maps an unknown Error to a generic 500 without its message or stack", () => {
    const error = new Error("SQLITE_BUSY: /home/victoria/secret/db.sqlite");

    const { status, body } = mapErrorToResponse(error);

    expect(status).toBe(500);
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(body.error.message).not.toContain("SQLITE_BUSY");
    expect(body.error.message).not.toContain("db.sqlite");
    expect(body.error).not.toHaveProperty("stack");
    expect(JSON.stringify(body)).not.toContain("    at ");
  });

  it("maps a thrown string to a generic 500 without echoing it", () => {
    const thrown = '{"token":"user-supplied-body"}';

    const { status, body } = mapErrorToResponse(thrown);

    expect(status).toBe(500);
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(body.error.message).not.toContain("user-supplied-body");
    expect(body.error.message).not.toContain("token");
    expect(JSON.stringify(body)).not.toContain("user-supplied-body");
  });
});

describe("jsonError", () => {
  it("serializes the mapper result with the matching HTTP status", async () => {
    const response = jsonError(
      new DomainValidationError("invalid_type", "Video id must be a string.", {
        field: "videoId",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "VALIDATION_FAILED",
        message: "Video id must be a string.",
        field: "videoId",
      },
    });
  });
});

describe("logServerError", () => {
  function readLog(spy: { mock: { calls: unknown[][] } }): string {
    return spy.mock.calls
      .map((args: unknown[]) =>
        args.map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg))).join(" "),
      )
      .join("\n");
  }

  it("returns a short request id and logs it with a redacted message", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    const requestId = logServerError(
      new Error(
        `Upstream failed: https://youtube.googleapis.com/youtube/v3/search?key=${FAKE_KEY}`,
      ),
      "GET /api/search",
    );

    expect(requestId).toMatch(/^[0-9a-f]{12}$/);

    const logged = readLog(spy);
    expect(logged).toContain(requestId);
    expect(logged).toContain("GET /api/search");
    expect(logged).toContain("[REDACTED");
    expect(logged).not.toContain(FAKE_KEY);
  });

  it("never logs a thrown value that is not an Error", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    logServerError(`request body: {"token":"${FAKE_KEY}"}`, { scope: "POST /api/library" });

    const logged = readLog(spy);
    expect(logged).toContain("POST /api/library");
    expect(logged).toContain("NonErrorThrown");
    expect(logged).not.toContain(FAKE_KEY);
    expect(logged).not.toContain("request body");
  });
});
