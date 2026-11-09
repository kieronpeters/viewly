/**
 * API error conventions shared by every route handler.
 *
 * The envelope is stable so clients (and later YouTube/library routes) can parse
 * one shape:
 *
 *   { error: { code, message, field? } }
 *
 * Only safe, authored text reaches the browser. Server detail (stack, upstream
 * message, configuration hints) stays in the server log, correlated by the short
 * request id returned from `logServerError`.
 *
 * Usage in a route handler:
 *
 *   try {
 *     ...
 *   } catch (error) {
 *     logServerError(error, "GET /api/search"); // id is printed in the log line
 *     return jsonError(error);
 *   }
 */

import { NextResponse } from "next/server";

import { isEnvConfigurationError } from "@/lib/env";
import { isDomainValidationError } from "@/shared/validation";

/** Stable, machine-readable codes. Adding a code is a breaking API change. */
export type ApiErrorCode =
  | "VALIDATION_FAILED"
  | "NOT_FOUND"
  | "RATE_LIMITED"
  | "UNAVAILABLE"
  | "UPSTREAM_ERROR"
  | "CONFIGURATION_ERROR"
  | "INTERNAL_ERROR";

/** HTTP status for each code. Routes must not invent their own mapping. */
export const API_ERROR_STATUS = {
  VALIDATION_FAILED: 400,
  NOT_FOUND: 404,
  RATE_LIMITED: 429,
  UNAVAILABLE: 503,
  UPSTREAM_ERROR: 502,
  CONFIGURATION_ERROR: 500,
  INTERNAL_ERROR: 500,
} as const satisfies Record<ApiErrorCode, number>;

export interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    message: string;
    /** Logical input field that failed validation, when known. */
    field?: string;
  };
}

export interface ApiErrorResult {
  status: number;
  body: ApiErrorBody;
}

/**
 * Browser-safe copy for failures whose real cause must not be disclosed.
 * These strings never interpolate configuration names or values.
 */
const CONFIGURATION_ERROR_MESSAGE =
  "The server is missing required configuration. Please try again later.";

const UPSTREAM_MALFORMED_PAYLOAD_MESSAGE =
  "The upstream service returned an unexpected response. Please try again later.";

const INTERNAL_ERROR_MESSAGE = "Something went wrong on the server. Please try again later.";

/**
 * Builds an envelope for a code chosen by control flow rather than by a thrown
 * error (for example a `null` lookup -> NOT_FOUND, or a failed upstream call ->
 * UPSTREAM_ERROR). `message` must be authored copy, never raw input.
 */
export function apiErrorResult(
  code: ApiErrorCode,
  message: string,
  field?: string,
): ApiErrorResult {
  return {
    status: API_ERROR_STATUS[code],
    body: {
      error: field === undefined ? { code, message } : { code, message, field },
    },
  };
}

/**
 * Pure mapping from a thrown value to an HTTP result. No logging, no I/O.
 *
 * - `DomainValidationError` -> 400 VALIDATION_FAILED, with its field and its
 *   authored message (those messages never echo user input). The exception is
 *   code `malformed_payload`, which the normalizers raise when an *upstream*
 *   body is malformed: that is a 502 UPSTREAM_ERROR with generic copy, because
 *   the caller sent nothing wrong and the original text can quote the payload.
 * - `EnvConfigurationError` -> 500 CONFIGURATION_ERROR, with generic copy. The
 *   original message names the env var, so it is never forwarded.
 * - Anything else -> 500 INTERNAL_ERROR, with generic copy. A thrown string is
 *   not echoed either.
 *
 * No branch includes a stack, a cause, or the thrown value's own text for
 * non-validation errors.
 */
export function mapErrorToResponse(error: unknown): ApiErrorResult {
  if (isDomainValidationError(error)) {
    if (error.code === "malformed_payload") {
      return apiErrorResult("UPSTREAM_ERROR", UPSTREAM_MALFORMED_PAYLOAD_MESSAGE);
    }

    return apiErrorResult(
      "VALIDATION_FAILED",
      error.message,
      error.field === null ? undefined : error.field,
    );
  }

  if (isEnvConfigurationError(error)) {
    return apiErrorResult("CONFIGURATION_ERROR", CONFIGURATION_ERROR_MESSAGE);
  }

  return apiErrorResult("INTERNAL_ERROR", INTERNAL_ERROR_MESSAGE);
}

/** Thin route-handler wrapper around `mapErrorToResponse`. */
export function jsonError(error: unknown): NextResponse<ApiErrorBody> {
  return jsonErrorResult(mapErrorToResponse(error));
}

/** Same wrapper for envelopes built with `apiErrorResult`. */
export function jsonErrorResult(result: ApiErrorResult): NextResponse<ApiErrorBody> {
  return NextResponse.json(result.body, { status: result.status });
}

/** Extra, safe-to-log metadata. Never put request bodies or secrets here. */
export interface ErrorLogContext {
  /** Where it failed, e.g. "GET /api/search". Never include query strings. */
  scope: string;
  /** Small identifiers only (codes, entity ids). Values are redacted before logging. */
  details?: Record<string, string | number | boolean | null>;
}

/** Longest slice of any single logged value; keeps one failure to one log line. */
const MAX_MESSAGE_LENGTH = 500;
const MAX_STACK_LENGTH = 4000;

/** Google API keys are the one secret shape this app handles. */
const GOOGLE_API_KEY_PATTERN = /\bAIza[0-9A-Za-z_-]{20,}\b/g;

/** Credentials carried in query strings (`?key=...`), key/value pairs, or bearer headers. */
const QUERY_SECRET_PATTERN = /([?&](?:key|api_key|apikey|access_token)=)[^&\s"'<>]+/gi;
const BEARER_PATTERN = /(\bBearer\s+)[A-Za-z0-9._~+/=-]+/gi;
const KEY_VALUE_PATTERN = /(["']?(?:api[_-]?key|secret|token)["']?\s*[:=]\s*["']?)[^"',\s}]+/gi;

/**
 * Strips credential-shaped substrings, then the currently configured YouTube key
 * if it appears verbatim. This is belt-and-braces: callers should never pass raw
 * upstream URLs, but an upstream error message might already contain one.
 */
function redactSecrets(text: string): string {
  let redacted = text
    .replace(GOOGLE_API_KEY_PATTERN, "[REDACTED_API_KEY]")
    .replace(QUERY_SECRET_PATTERN, "$1[REDACTED]")
    .replace(BEARER_PATTERN, "$1[REDACTED]")
    .replace(KEY_VALUE_PATTERN, "$1[REDACTED]");

  const configuredKey =
    typeof process === "undefined" ? "" : (process.env.YOUTUBE_API_KEY ?? "").trim();
  if (configuredKey.length >= 8 && redacted.includes(configuredKey)) {
    redacted = redacted.split(configuredKey).join("[REDACTED_API_KEY]");
  }

  return redacted;
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength)}…`;
}

/** Short correlation id, not a secret. Falls back when `randomUUID` is absent. */
function createRequestId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (typeof uuid === "string") {
    return uuid.replaceAll("-", "").slice(0, 12);
  }

  return `${Date.now().toString(16)}${Math.random().toString(16).slice(2, 8)}`.slice(0, 12);
}

/**
 * Logs a redacted server-side description and returns a short request id that
 * can be quoted in the bug report / matched against the log line.
 *
 * Logged: request id, scope, error name, redacted + truncated message, truncated
 * stack for real `Error` instances, and the caller-supplied scalar details.
 * Never logged: the thrown value when it is not an `Error`, API keys or other
 * credential-shaped strings, request bodies, environment values.
 */
export function logServerError(error: unknown, context: ErrorLogContext | string): string {
  const requestId = createRequestId();
  const { scope, details: rawDetails } = typeof context === "string" ? { scope: context } : context;

  const details: Record<string, string | number | boolean | null> = { scope };
  for (const [key, value] of Object.entries(rawDetails ?? {})) {
    if (key === "__proto__" || key === "constructor" || key === "prototype") {
      continue;
    }

    details[key] =
      typeof value === "string" ? truncate(redactSecrets(value), MAX_MESSAGE_LENGTH) : value;
  }

  if (error instanceof Error) {
    console.error(`[api-error ${requestId}] ${error.name}`, {
      ...details,
      message: truncate(redactSecrets(error.message), MAX_MESSAGE_LENGTH),
      stack:
        error.stack === undefined
          ? undefined
          : truncate(redactSecrets(error.stack), MAX_STACK_LENGTH),
    });
  } else {
    // Do not log the value itself: a thrown string can be a request body or a secret.
    console.error(`[api-error ${requestId}] NonErrorThrown`, {
      ...details,
      thrownType: typeof error,
    });
  }

  return requestId;
}
