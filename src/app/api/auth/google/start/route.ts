import { NextResponse } from "next/server";

import { beginAuthorization, readGoogleConfig } from "@/lib/auth/google";

/** Starts the Google consent flow. */
export async function GET(request: Request): Promise<Response> {
  const config = readGoogleConfig();

  if (!config) {
    return NextResponse.redirect(new URL("/you?auth=not-configured", request.url));
  }

  const { url } = await beginAuthorization(config);

  return NextResponse.redirect(url);
}
