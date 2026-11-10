/**
 * GET /api/library/backup
 *
 * Downloads the local library as a versioned JSON file:
 *
 * ```json
 * { "format": "viewly-library-backup", "version": 1, "exportedAt": "…", "data": { … } }
 * ```
 *
 * The response is never cached and never contains a secret: see
 * `src/features/backup/backup.ts` for the exact shape and ordering guarantees.
 *
 * `connection()` is awaited before the synchronous `better-sqlite3` read so
 * Cache Components renders this route at request time instead of trying to
 * prerender the database contents into the build output.
 */
import { NextResponse, connection } from "next/server";

import { exportLibraryBackup } from "@/features/backup/backup-service";
import { jsonError, logServerError, rethrowNextControlFlow } from "@/lib/errors";

const SCOPE = "GET /api/library/backup";

export async function GET(): Promise<NextResponse> {
  try {
    await connection();

    const backup = exportLibraryBackup();
    const filename = `viewly-library-${backup.exportedAt.slice(0, 10)}.json`;

    return new NextResponse(`${JSON.stringify(backup, null, 2)}\n`, {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    rethrowNextControlFlow(error);
    logServerError(error, SCOPE);

    return jsonError(error);
  }
}
