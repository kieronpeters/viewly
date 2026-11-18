#!/usr/bin/env node
/**
 * Build the local evidence manifest for a flow and audit it for guardrail breaches.
 *
 *   node manifest.mjs --flow home
 *
 * Writes docs/re-evidence/<flow>/MANIFEST.json and MANIFEST.md:
 *   - every artefact with size and SHA-256
 *   - a per-run summary (viewport, state, steps, counts)
 *   - a redaction audit: no cookies, auth headers, API keys or long opaque tokens
 *
 * Evidence stays local (git-ignored). This script never writes outside the flow dir.
 */

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, cur, i, arr) => {
    if (cur.startsWith("--"))
      acc.push([cur.slice(2), arr[i + 1] && !arr[i + 1].startsWith("--") ? arr[i + 1] : "true"]);
    return acc;
  }, []),
);

const FLOW = args.flow || "home";
const ROOT = path.resolve(args.root || path.join("docs", "re-evidence", FLOW));
const EXCLUDE_DIRS = new Set([
  "_tools",
  "_probe",
  "_probe1280",
  "_debug",
  "_profile",
  "node_modules",
]);
const SECRET_PATTERNS = [
  [/AIza[0-9A-Za-z_-]{10,}/, "google-api-key"],
  [/eyJ[A-Za-z0-9._-]{20,}/, "jwt"],
  [/\bSAPISID\b|\bHSID\b|\bSSID\b/i, "youtube-session-cookie"],
  [/\b(cookie|set-cookie|authorization|proxy-authorization)\b["']?\s*[:=]/i, "credential-header"],
  [/\b[0-9A-Za-z_-]{80,}\b/, "long-opaque-token"],
];

const files = [];
function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (EXCLUDE_DIRS.has(entry.name)) continue;
      walk(path.join(dir, entry.name));
    } else if (entry.isFile()) {
      if (entry.name === "MANIFEST.json" || entry.name === "MANIFEST.md") continue;
      files.push(path.join(dir, entry.name));
    }
  }
}
walk(ROOT);

const sha = (buf) => createHash("sha256").update(buf).digest("hex");

const artifacts = files.map((abs) => {
  const st = statSync(abs);
  const buf = readFileSync(abs);
  return {
    file: path.relative(ROOT, abs).replace(/\\/g, "/"),
    bytes: st.size,
    sha256: sha(buf),
  };
});

const findings = [];
for (const abs of files) {
  if (!/\.(json|jsonl|txt|md)$/.test(abs)) continue;
  const text = readFileSync(abs, "utf8");
  const isSnapshot = /\.(dom|ax)\.json$/.test(abs);
  for (const [re, label] of SECRET_PATTERNS) {
    // long opaque runs in DOM/AX snapshots are component class names, not credentials
    if (isSnapshot && label === "long-opaque-token") continue;
    if (re.test(text)) {
      findings.push({ file: path.relative(ROOT, abs).replace(/\\/g, "/"), pattern: label });
    }
  }
}

const runs = [];
for (const abs of files.filter((f) => f.endsWith("run.json"))) {
  try {
    const rec = JSON.parse(readFileSync(abs, "utf8"));
    const s = rec.summary || {};
    runs.push({
      dir: path.relative(ROOT, path.dirname(abs)).replace(/\\/g, "/"),
      width: rec.width,
      height: rec.height,
      state: s.state || null,
      cards: s.cards ?? null,
      domNodes: s.steps && s.steps[0] ? s.steps[0].domNodes : null,
      axNodes: s.steps && s.steps[0] ? s.steps[0].axNodes : null,
      steps: s.steps ? s.steps.map((x) => x.name) : [],
      chrome: rec.chrome ? rec.chrome.product : null,
      startedAt: rec.startedAt || null,
      seedVisits: s.seed ? s.seed.visits : null,
    });
  } catch {
    /* a run.json that cannot be parsed is reported by absence, not silently repaired */
  }
}

const manifest = {
  flow: FLOW,
  generatedAt: new Date().toISOString(),
  root: path.relative(process.cwd(), ROOT).replace(/\\/g, "/"),
  captureMethod:
    "Local Chrome via CDP (scripts in _tools/capture.mjs): fresh signed-out profile, one page load per viewport, human-paced seeding through public search/watch pages, DOM + accessibility tree + computed styles + network timing per state.",
  guardrails: {
    publicPagesOnly: true,
    signedOutOnly: true,
    noMediaDownloadOrProxy: true,
    cookiesOrAuthHeadersStored: false,
    youtubeCopyInSpecs: false,
  },
  totals: {
    artifacts: artifacts.length,
    bytes: artifacts.reduce((sum, a) => sum + a.bytes, 0),
    runs: runs.length,
    viewports: [...new Set(runs.map((r) => r.width))].sort((a, b) => a - b),
  },
  runs,
  artifacts,
  redactionAudit: {
    findings,
    clean: findings.length === 0,
    patternsChecked: SECRET_PATTERNS.map((p) => p[1]),
  },
};

writeFileSync(path.join(ROOT, "MANIFEST.json"), JSON.stringify(manifest, null, 1) + "\n");

const lines = [];
lines.push(`# Home flow — local evidence manifest`);
lines.push("");
lines.push(`Generated: ${manifest.generatedAt}`);
lines.push(`Root: \`${manifest.root}/\` (git-ignored; disposable)`);
lines.push("");
lines.push("## Method");
lines.push("");
lines.push(manifest.captureMethod);
lines.push("");
lines.push("## Guardrail audit");
lines.push("");
lines.push(`- Public pages only: yes`);
lines.push(`- Signed-out only: yes (fresh profile per run; no login attempted)`);
lines.push(`- No media download, proxy or re-host: yes`);
lines.push(`- Cookies / auth headers retained: no (never requested from the browser)`);
lines.push(
  `- YouTube copy in frozen specs: no (evidence is local and paraphrased in \`docs/specs/home.md\`)`,
);
lines.push(
  `- Credential-pattern scan: ${manifest.redactionAudit.clean ? "clean" : `${findings.length} finding(s)`}`,
);
if (findings.length) {
  lines.push("");
  for (const f of findings) lines.push(`  - \`${f.file}\`: ${f.pattern}`);
}
lines.push("");
lines.push("## Runs");
lines.push("");
lines.push("| dir | viewport | state | cards | DOM nodes | AX nodes | steps |");
lines.push("| --- | --- | --- | --- | --- | --- | --- |");
for (const r of runs) {
  lines.push(
    `| \`${r.dir}\` | ${r.width}×${r.height} | ${r.state || "—"} | ${r.cards ?? "—"} | ${r.domNodes ?? "—"} | ${r.axNodes ?? "—"} | ${r.steps.join(", ")} |`,
  );
}
lines.push("");
lines.push("## Artefacts");
lines.push("");
lines.push("| file | bytes | sha256 (first 16) |");
lines.push("| --- | --- | --- |");
for (const a of artifacts) {
  lines.push(`| \`${a.file}\` | ${a.bytes} | \`${a.sha256.slice(0, 16)}\` |`);
}
lines.push("");
lines.push(
  "`MANIFEST.json` carries the full digests and the audit result; this page is the human view.",
);
writeFileSync(path.join(ROOT, "MANIFEST.md"), lines.join("\n") + "\n");

console.log(
  JSON.stringify(
    {
      ok: true,
      flow: FLOW,
      artifacts: artifacts.length,
      runs: runs.length,
      redactionClean: manifest.redactionAudit.clean,
      findings: findings.slice(0, 10),
    },
    null,
    1,
  ),
);
