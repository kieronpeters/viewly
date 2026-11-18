#!/usr/bin/env node
/**
 * Sanitise stored evidence in place: remove payload-bearing data: URIs and advertising
 * tracking identifiers that are not needed to reproduce a behaviour.
 *
 *   node sanitize.mjs --flow home
 *
 * Only rewrites JSON/JSONL/TXT files under docs/re-evidence/<flow>/. Idempotent.
 */

import { readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import path from "node:path";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, cur, i, arr) => {
    if (cur.startsWith("--"))
      acc.push([cur.slice(2), arr[i + 1] && !arr[i + 1].startsWith("--") ? arr[i + 1] : "true"]);
    return acc;
  }, []),
);

const FLOW = args.flow || "home";
const ROOT = path.resolve("docs", "re-evidence", FLOW);
const SKIP = new Set(["_tools", "_probe", "_probe1280", "_debug"]);

const RULES = [
  {
    name: "data-uri-payload",
    re: /data:([a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+);base64,[A-Za-z0-9+/=%\s]{40,}/g,
    to: (_m, mime) => `data:${mime};base64,<redacted>`,
  },
  {
    name: "mangled-data-uri",
    re: /null([a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+);base64,[A-Za-z0-9+/=%\s]{40,}/g,
    to: (_m, mime) => `data:${mime};base64,<redacted>`,
  },
  {
    name: "ad-tracking-param",
    re: /\b(dc_dbm_token|dc_trk_aid|dc_trk_cid|dc_exteid|dc_rdid|dc_lat|dc_rui|dc_av|dc_sk|dc_ctype|dc_ref|dc_eps|ord)=([^&"'\s;]+)/g,
    to: (_m, key) => `${key}=<redacted>`,
  },
  {
    name: "ad-tracking-generic",
    re: /\b(dc_[a-z_]+|eps|cid|adurl)=([^&"'\s;]+)/g,
    to: (_m, key) => `${key}=<redacted>`,
  },
  {
    name: "image-proxy-path",
    re: /(https?:\/\/(?:lh\d+\.googleusercontent\.com|yt3\.ggpht\.com|i\.ytimg\.com|img\.youtube\.com|yt4\.ggpht\.com)\/[^"\s\\]+)/g,
    to: (url) => {
      try {
        return new URL(url).origin + "/<redacted-path>";
      } catch {
        return "<redacted-image-url>";
      }
    },
  },
  {
    name: "media-signature-param",
    re: /([?&](?:sig|lsig|n|expire|ei|ip|ns|mt|spc|siu|vprv|svpuc|mh|mn|ms)=)[^&"'\s]+/g,
    to: (_m, key) => `${key}=<redacted>`,
  },
];

const files = [];
function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP.has(entry.name)) continue;
      walk(path.join(dir, entry.name));
    } else if (/\.(json|jsonl|txt)$/.test(entry.name)) {
      files.push(path.join(dir, entry.name));
    }
  }
}
walk(ROOT);

const report = { files: 0, changed: 0, replacements: {} };
for (const abs of files) {
  report.files++;
  const before = readFileSync(abs, "utf8");
  let after = before;
  for (const rule of RULES) {
    let hits = 0;
    after = after.replace(rule.re, (...m) => {
      hits++;
      return rule.to(...m);
    });
    if (hits) report.replacements[rule.name] = (report.replacements[rule.name] || 0) + hits;
  }
  if (after !== before) {
    writeFileSync(abs, after);
    report.changed++;
  }
}

console.log(
  JSON.stringify(
    { ok: true, flow: FLOW, root: path.relative(process.cwd(), ROOT), ...report },
    null,
    1,
  ),
);
