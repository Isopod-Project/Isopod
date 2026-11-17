// Runs `npm audit` in the current folder (the frontend) and fails on high or critical advisories,
// except those listed, and not yet expired, in .npm-audit-ignore.json.
// npm audit has no ignore list of its own; this mirrors .trivyignore.yaml for the image scan.
// Anything unexpected (npm failing, an odd report, a malformed ignore entry) fails the check.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const FAILING = new Set(["high", "critical"]);
const GHSA_RE = /GHSA(-[23456789cfghjmpqrvwx]{4}){3}/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isRealDate(text) {
  if (!DATE_RE.test(text)) return false;
  const date = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text;
}

/** Check the ignore file's entries. Returns { entries, errors }. */
export function parseIgnoreList(data) {
  const errors = [];
  const entries = [];
  if (!data || !Array.isArray(data.advisories)) {
    return { entries, errors: ["ignore file must have an \"advisories\" array"] };
  }
  data.advisories.forEach((entry, i) => {
    const where = `advisories[${i}]`;
    if (!entry || typeof entry !== "object") return errors.push(`${where} is not an object`);
    if (typeof entry.id !== "string" || !GHSA_RE.test(entry.id) || entry.id.match(GHSA_RE)[0] !== entry.id) {
      errors.push(`${where}.id must be a GHSA id`);
    }
    for (const field of ["package", "reason"]) {
      if (typeof entry[field] !== "string" || !entry[field].trim()) errors.push(`${where}.${field} is required`);
    }
    if (typeof entry.expires !== "string" || !isRealDate(entry.expires)) {
      errors.push(`${where}.expires must be a real date as YYYY-MM-DD`);
    }
    entries.push(entry);
  });
  return { entries, errors };
}

/**
 * Decide the outcome for an `npm audit --json` report.
 * Returns { failures: string[], notes: string[] }; any failure fails the check.
 */
export function evaluate(report, ignoreEntries, today) {
  const failures = [];
  const notes = [];
  if (!report || typeof report !== "object") return { failures: ["npm audit report is not an object"], notes };
  if (report.error) {
    return { failures: [`npm audit failed: ${report.error.summary || JSON.stringify(report.error)}`], notes };
  }
  if (report.auditReportVersion !== 2 || !report.vulnerabilities || typeof report.vulnerabilities !== "object"
      || !report.metadata?.vulnerabilities) {
    return { failures: ["unsupported npm audit report format (expected auditReportVersion 2)"], notes };
  }

  const active = new Map();
  for (const entry of ignoreEntries) {
    if (entry.expires < today) {
      notes.push(`Ignore entry for ${entry.id} expired on ${entry.expires}; it no longer applies.`);
    } else {
      active.set(entry.id, entry);
    }
  }

  const vulns = report.vulnerabilities;
  // A package entry either carries advisories (objects in `via`) or points at the vulnerable
  // packages it depends on (strings). Every flagged entry must lead back to a real advisory.
  const resolved = new Set(Object.keys(vulns).filter((name) => vulns[name].via?.some((v) => v && typeof v === "object")));
  let grew = true;
  while (grew) {
    grew = false;
    for (const [name, vuln] of Object.entries(vulns)) {
      if (!resolved.has(name) && vuln.via?.some((v) => typeof v === "string" && resolved.has(v))) {
        resolved.add(name);
        grew = true;
      }
    }
  }

  const seen = new Set();
  for (const [name, vuln] of Object.entries(vulns)) {
    if (!Array.isArray(vuln.via)) {
      failures.push(`${name}: report entry has no "via" list`);
      continue;
    }
    if (FAILING.has(vuln.severity) && !resolved.has(name)) {
      failures.push(`${name}: flagged ${vuln.severity} but no advisory behind it`);
    }
    for (const via of vuln.via) {
      if (!via || typeof via !== "object" || !FAILING.has(via.severity)) continue;
      const id = typeof via.url === "string" ? via.url.match(GHSA_RE)?.[0] : undefined;
      const key = `${id || via.url || via.source}|${via.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const entry = id && active.get(id);
      if (entry && entry.package === via.name) {
        notes.push(`Ignoring ${id} (${via.name}) until ${entry.expires}.`);
      } else {
        failures.push(`${via.severity.toUpperCase()} ${via.name} ${via.range}: ${via.title} (${id || via.url || "no advisory id"})`);
      }
    }
  }
  return { failures, notes };
}

function runAudit() {
  const result = spawnSync("npm", ["audit", "--json"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    shell: process.platform === "win32",
  });
  // npm audit exits 0 when clean and 1 when it finds something; anything else is a failure to run.
  if (result.error || result.signal || ![0, 1].includes(result.status)) {
    const why = result.error?.message || result.signal || `exit code ${result.status}`;
    throw new Error(`npm audit did not run (${why}).\n${result.stderr || ""}`);
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error(`npm audit printed no valid JSON.\n${result.stderr || ""}`);
  }
}

function main() {
  const ignorePath = resolve(".npm-audit-ignore.json");
  if (!existsSync(ignorePath)) {
    throw new Error(`${ignorePath} not found. Run this from the frontend folder.`);
  }
  const { entries, errors } = parseIgnoreList(JSON.parse(readFileSync(ignorePath, "utf8")));
  if (errors.length) throw new Error(`Invalid .npm-audit-ignore.json:\n  ${errors.join("\n  ")}`);

  const { failures, notes } = evaluate(runAudit(), entries, new Date().toISOString().slice(0, 10));
  notes.forEach((note) => console.log(note));
  if (failures.length) {
    failures.forEach((failure) => console.error(failure));
    console.error(`\n${failures.length} problem(s). Run \`npm audit\` for details.`);
    process.exit(1);
  }
  console.log("No unignored high or critical advisories.");
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
