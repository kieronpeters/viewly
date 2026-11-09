"use server";

/**
 * Server Actions for the personal library (T33/T34).
 *
 * `toggleFavourite` and `toggleWatchLater` are the mutations this feature
 * exposes. Each receives the display snapshot the caller just rendered,
 * validates it, toggles the row with the idempotent repository operations and
 * revalidates the routes that read the saved state.
 *
 * ## Why the database modules are imported inside the action
 *
 * A Server Action module is imported by Client Components for its action
 * reference. A top-level `import "@/lib/db/client"` would therefore execute the
 * `server-only` guard and load the native SQLite driver whenever the module is
 * evaluated outside Next's server graph (for example in Vitest, where dozens of
 * component tests render `VideoCard`). Loading the connection lazily keeps the
 * action inert at import time and the client graph free of database code.
 *
 * ## Revalidation
 *
 * Both reads of a saved-video state ship in these tickets: `/library` (the
 * saved lists) and `/watch/[videoId]` (the controls' initial state).
 * `revalidatePath` is called with the concrete paths after the write, so the
 * action's own response carries a fresh RSC payload for the current route.
 * `/library` is a literal path; the watch path is built from the id that was
 * just validated.
 */
import { revalidatePath } from "next/cache";

import {
  parseFavouriteSnapshot,
  toggleFavouriteInRepository,
  type FavouriteSnapshot,
  type FavouriteToggleResult,
} from "./favourite-toggle";
import {
  parseWatchLaterSnapshot,
  toggleWatchLaterInRepository,
  type WatchLaterSnapshot,
  type WatchLaterToggleResult,
} from "./watch-later-toggle";

/** Route that lists saved videos; T37 extends it with the other tabs. */
const LIBRARY_PATH = "/library";

/**
 * Toggles a video in the local favourites list.
 *
 * - Adding is idempotent: a duplicate save keeps the stored snapshot and returns
 *   `{ favourited: true }`.
 * - Removing is idempotent: a repeat remove is a no-op that returns
 *   `{ favourited: false }`.
 * - Invalid input throws a `DomainValidationError` before any write happens.
 *
 * The client never supplies a user or board identity: there is exactly one local
 * library, so the only thing the caller chooses is which video to save.
 */
export async function toggleFavourite(input: FavouriteSnapshot): Promise<FavouriteToggleResult> {
  const snapshot = parseFavouriteSnapshot(input);

  const [{ getDb }, { createLibraryRepository }] = await Promise.all([
    import("@/lib/db/client"),
    import("@/lib/db/repositories/library.repository"),
  ]);

  const repository = createLibraryRepository(getDb());
  const result = toggleFavouriteInRepository(repository, snapshot, new Date());

  revalidatePath(LIBRARY_PATH);
  revalidatePath(`/watch/${snapshot.videoId}`);

  return result;
}

/**
 * Toggles a video in the local watch-later queue.
 *
 * The contract mirrors {@link toggleFavourite}: adding and removing are both
 * idempotent, invalid input throws before any write, and the return value is the
 * state that is now stored rather than the row that was written.
 */
export async function toggleWatchLater(input: WatchLaterSnapshot): Promise<WatchLaterToggleResult> {
  const snapshot = parseWatchLaterSnapshot(input);

  const [{ getDb }, { createLibraryRepository }] = await Promise.all([
    import("@/lib/db/client"),
    import("@/lib/db/repositories/library.repository"),
  ]);

  const repository = createLibraryRepository(getDb());
  const result = toggleWatchLaterInRepository(repository, snapshot, new Date());

  revalidatePath(LIBRARY_PATH);
  revalidatePath(`/watch/${snapshot.videoId}`);

  return result;
}
