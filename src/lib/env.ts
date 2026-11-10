/**
 * Server-side environment configuration.
 *
 * The module imports "server-only", so importing it from a Client Component is a
 * build-time error and the YouTube API key can never reach the browser bundle.
 *
 * Values are read lazily at call time rather than at module load: `next build`
 * runs without secrets, and a missing key must fail where the key is used, not
 * when the module graph is evaluated. Error messages name the variable and the
 * file to edit; they never contain the value itself.
 */

import "server-only";

/** Name of the environment variable holding the YouTube Data API v3 key. */
export const YOUTUBE_API_KEY_ENV_VAR = "YOUTUBE_API_KEY";

/** Stable, machine-readable failure codes. Callers may branch on these. */
export type EnvConfigurationCode = "missing_youtube_api_key";

/** Values shipped in `.env.example` that are not real credentials. */
const PLACEHOLDER_API_KEYS: ReadonlySet<string> = new Set([
  "your-api-key",
  "your-api-key-here",
  "your_api_key_here",
  "your-youtube-api-key",
  "your_youtube_api_key",
  "youtube-api-key",
  "api-key",
  "placeholder",
  "change-me",
  "changeme",
]);

export class EnvConfigurationError extends Error {
  readonly code: EnvConfigurationCode;

  constructor(code: EnvConfigurationCode, message: string) {
    super(message);
    this.name = "EnvConfigurationError";
    this.code = code;
  }
}

/** Narrowing helper so callers do not need `instanceof` checks inline. */
export function isEnvConfigurationError(value: unknown): value is EnvConfigurationError {
  return value instanceof EnvConfigurationError;
}

/**
 * Returns the YouTube Data API key, trimmed.
 *
 * @throws {EnvConfigurationError} with code "missing_youtube_api_key" when the
 * variable is unset, blank or still a placeholder. The message is safe to log:
 * it never includes the configured value.
 */
export function getYoutubeApiKey(): string {
  const value = (process.env.YOUTUBE_API_KEY ?? "").trim();

  if (value.length === 0) {
    throw new EnvConfigurationError(
      "missing_youtube_api_key",
      `${YOUTUBE_API_KEY_ENV_VAR} is missing. Add it to .env.local in the project root; ` +
        "it is server-side only and must not be prefixed with NEXT_PUBLIC_.",
    );
  }

  if (PLACEHOLDER_API_KEYS.has(value.toLowerCase())) {
    throw new EnvConfigurationError(
      "missing_youtube_api_key",
      `${YOUTUBE_API_KEY_ENV_VAR} still holds the placeholder from .env.example. ` +
        "Set a real YouTube Data API v3 key in .env.local; it is server-side only.",
    );
  }

  return value;
}
