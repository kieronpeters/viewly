/**
 * POST /api/library/backup/import[?preview=1]
 *
 * Accepts the raw JSON text of a backup file as the request body. With
 * `?preview=1` it validates the file and returns the counts an import would
 * produce without writing; without it, the merge runs in one transaction.
 *
 * Success (both modes):
 *
 * ```json
 * { "version": 1, "exportedAt": "…", "counts": { "total": { … }, … } }
 * ```
 *
 * Failures use the shared T07 envelope, always as a 400 for a malformed or
 * incompatible file:
 *
 * ```json
 * { "error": { "code": "VALIDATION_FAILED", "message": "…", "field": "data.notes[2].startSeconds" } }
 * ```
 *
 * The route never builds SQL and never deletes data: validation and merge
 * policy live in the feature module, and the repository applies the plan.
 */
import { NextResponse } from "next/server";

import { previewLibraryBackup, importLibraryBackup } from "@/features/backup/backup-service";
import {
  apiErrorResult,
  jsonError,
  jsonErrorResult,
  logServerError,
  rethrowNextControlFlow,
} from "@/lib/errors";
import { isDomainValidationError } from "@/shared/validation";

const SCOPE = "POST /api/library/backup/import";

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const preview = new URL(request.url).searchParams.get("preview") === "1";
    const text = await request.text();

    const result = preview ? previewLibraryBackup(text) : importLibraryBackup(text);

    return NextResponse.json(result, {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    rethrowNextControlFlow(error);

    if (isDomainValidationError(error)) {
      // A file problem is a client mistake with a precise, authored message;
      // do not map `malformed_payload` to the upstream-service copy used by
      // YouTube routes.
      return jsonErrorResult(
        apiErrorResult(
          "VALIDATION_FAILED",
          error.message,
          error.field === null ? undefined : error.field,
        ),
      );
    }

    logServerError(error, SCOPE);

    return jsonError(error);
  }
}
