import { NextResponse } from "next/server";

import { clearSession, deleteAccount, getSessionAccount } from "@/lib/auth/google";

/** Deletes the stored account (including its refresh token) and clears the cookie. */
export async function POST(request: Request): Promise<Response> {
  const account = await getSessionAccount();

  if (account) {
    deleteAccount(account.id);
  }

  await clearSession();

  return NextResponse.redirect(new URL("/", request.url), 303);
}
