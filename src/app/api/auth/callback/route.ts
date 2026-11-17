import { NextResponse } from "next/server";

import {
  exchangeCode,
  fetchUserInfo,
  readAuthAttempt,
  readGoogleConfig,
  saveAccount,
  setSession,
} from "@/lib/auth/google";

/** Exchanges the authorization code, stores the account and opens a session. */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const config = readGoogleConfig();

  if (!config) {
    return NextResponse.redirect(new URL("/you?auth=not-configured", url.origin));
  }

  const code = url.searchParams.get("code");
  const returnedState = url.searchParams.get("state");
  const { state, verifier } = await readAuthAttempt();

  if (!code || !verifier || !state || returnedState !== state) {
    return NextResponse.redirect(new URL("/you?auth=failed", url.origin));
  }

  try {
    const tokens = await exchangeCode(config, code, verifier);
    const account = await fetchUserInfo(tokens.access_token);

    saveAccount(account, {
      refreshToken: tokens.refresh_token ?? null,
      accessToken: tokens.access_token,
      expiresIn: tokens.expires_in,
    });
    await setSession(account.id, config.secret);

    return NextResponse.redirect(new URL("/you", url.origin));
  } catch {
    return NextResponse.redirect(new URL("/you?auth=failed", url.origin));
  }
}
