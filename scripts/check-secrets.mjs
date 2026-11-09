#!/usr/bin/env node
/**
 * Client-bundle secret leak check (T08).
 *
 * Scans the production client output (`.next/static`) for:
 *
 *   1. the literal string `YOUTUBE_API_KEY` — the variable name must never be
 *      referenced by browser code; and
 *   2. the value of `SECRET_SENTINEL` — a fake key injected into the build so a
 *      leak would be observable without ever using a real credential.
 *
 * Exits non-zero and names every offending file when either needle is found.
 * Prints a pass line with the number of files scanned when the output is clean.
 *
 * Dependency-free by design: only `node:fs` and `node:path`. Safe to run in CI
 * without any secret configured; a missing `SECRET_SENTINEL` skips only the
 * sentinel scan and is reported as such.
 *
 * Usage:
 *   SECRET_SENTINEL=AIzaSySENTINEL_DO_NOT_USE_000000000 node scripts/check-secrets.mjs
 *   # or: npm run check:secrets
 *
 * Windows/PowerShell:
 *   $env:SECRET_SENTINEL='AIzaSySENTINEL_DO_NOT_USE_000000000'; npm run check:secrets
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const staticDir = join(projectRoot, ".next", "static");

/** Never acceptable in the browser bundle, whatever the key's value is. */
const VARIABLE_NAME_NEEDLE = "YOUTUBE_API_KEY";

/** Fake value injected at build time; scanned only when provided. */
const sentinel = (process.env.SECRET_SENTINEL ?? "").trim();

/** Recursively collects every regular file under `directory`. */
function collectFiles(directory) {
  /** @type {string[]} */
  const files = [];

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...collectFiles(entryPath));
    } else if (entry.isFile()) {
      files.push(entryPath);
    }
  }

  return files;
}

/** Reports a finding; the caller counts it. */
function reportFinding(file, label) {
  console.error(`FAIL: found ${label} in ${relative(projectRoot, file)}`);
}

if (!statSync(staticDir, { throwIfNoEntry: false })?.isDirectory()) {
  console.error(
    `FAIL: ${relative(projectRoot, staticDir)} does not exist. Run "npm run build" first.`,
  );
  process.exit(1);
}

console.log(`check-secrets: scanning ${relative(projectRoot, staticDir)}`);

if (sentinel.length === 0) {
  console.warn("check-secrets: SECRET_SENTINEL is not set — sentinel-value scan SKIPPED.");
} else if (sentinel.toLowerCase() === VARIABLE_NAME_NEEDLE.toLowerCase()) {
  console.error("FAIL: SECRET_SENTINEL must not be the variable name itself.");
  process.exit(1);
}

const files = collectFiles(staticDir);
const nameNeedle = Buffer.from(VARIABLE_NAME_NEEDLE, "utf8");
const valueNeedle = sentinel.length > 0 ? Buffer.from(sentinel, "utf8") : undefined;

let failures = 0;
let bytesScanned = 0;

for (const file of files) {
  let contents;

  try {
    contents = readFileSync(file);
  } catch (error) {
    console.error(`FAIL: could not read ${relative(projectRoot, file)}: ${error.message}`);
    failures += 1;
    continue;
  }

  bytesScanned += contents.byteLength;

  if (contents.includes(nameNeedle)) {
    reportFinding(file, `"${VARIABLE_NAME_NEEDLE}"`);
    failures += 1;
  }

  if (valueNeedle !== undefined && contents.includes(valueNeedle)) {
    reportFinding(file, "the SECRET_SENTINEL value");
    failures += 1;
  }
}

if (failures > 0) {
  console.error(
    `check-secrets: FAILED — ${failures} finding(s) across ${files.length} file(s) in ` +
      `${relative(projectRoot, staticDir)}.`,
  );
  process.exit(1);
}

console.log(
  `check-secrets: PASS — scanned ${files.length} file(s) (${bytesScanned} bytes) in ` +
    `${relative(projectRoot, staticDir)}; neither "${VARIABLE_NAME_NEEDLE}" nor ` +
    (valueNeedle === undefined
      ? "the sentinel (skipped, SECRET_SENTINEL unset)"
      : "the SECRET_SENTINEL value") +
    " is present.",
);
