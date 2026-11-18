import "server-only";

/**
 * The owner of local library activity: the signed-in Google account id, or
 * `local` when signed out. Every write and read that should stay separate per
 * account resolves the owner here.
 *
 * Dynamic import keeps this safe outside a request scope (tests, scripts), where
 * cookies are unavailable and everything belongs to `local`.
 */
export async function currentOwner(): Promise<string> {
  try {
    const { getSessionAccount } = await import("@/lib/auth/google");
    const account = await getSessionAccount();

    return account?.id ?? "local";
  } catch {
    return "local";
  }
}
