// Tests for the npm audit gate. Run with: node --test scripts/check-npm-audit.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";

import { evaluate, parseIgnoreList } from "./check-npm-audit.mjs";

const TODAY = "2026-11-17";
const PICO = "GHSA-fc5q-39xc-vjpf";

function advisory(name, id, severity = "high") {
  return { name, severity, range: "<=4.0.7", title: `${name} bug`, url: `https://github.com/advisories/${id}`, source: 1 };
}

function report(vulnerabilities) {
  return { auditReportVersion: 2, vulnerabilities, metadata: { vulnerabilities: {} } };
}

// picomatch carries the advisory; vite only points at it, as npm reports transitive packages.
const picoReport = () => report({
  picomatch: { severity: "high", via: [advisory("picomatch", PICO)] },
  vite: { severity: "high", via: ["picomatch"] },
});

const entry = (overrides = {}) => ({ id: PICO, package: "picomatch", reason: "no fix", expires: "2026-12-31", ...overrides });

test("an ignored advisory and the packages depending on it pass", () => {
  const { failures, notes } = evaluate(picoReport(), [entry()], TODAY);
  assert.deepEqual(failures, []);
  assert.equal(notes.length, 1);
});

test("an expired entry no longer applies", () => {
  const { failures } = evaluate(picoReport(), [entry({ expires: "2026-11-16" })], TODAY);
  assert.equal(failures.length, 1);
});

test("an entry still applies on its expiry day", () => {
  assert.deepEqual(evaluate(picoReport(), [entry({ expires: TODAY })], TODAY).failures, []);
});

test("an entry for the right id but another package does not apply", () => {
  assert.equal(evaluate(picoReport(), [entry({ package: "minimatch" })], TODAY).failures.length, 1);
});

test("an unrelated high or critical advisory fails", () => {
  const r = picoReport();
  r.vulnerabilities.lodash = { severity: "critical", via: [advisory("lodash", "GHSA-29mw-wpgm-hmr9", "critical")] };
  const { failures } = evaluate(r, [entry()], TODAY);
  assert.equal(failures.length, 1);
  assert.match(failures[0], /lodash/);
});

test("moderate advisories don't fail", () => {
  const r = report({ minimatch: { severity: "moderate", via: [advisory("minimatch", "GHSA-g3hv-75wg-m249", "moderate")] } });
  assert.deepEqual(evaluate(r, [], TODAY).failures, []);
});

test("a flagged package pointing at nothing real fails", () => {
  const r = report({ vite: { severity: "high", via: ["picomatch"] } });
  assert.equal(evaluate(r, [entry()], TODAY).failures.length, 1);
});

test("an advisory without a GHSA id can't be ignored", () => {
  const r = report({ picomatch: { severity: "high", via: [{ ...advisory("picomatch", PICO), url: undefined }] } });
  assert.equal(evaluate(r, [entry()], TODAY).failures.length, 1);
});

test("malformed or unexpected reports fail", () => {
  assert.equal(evaluate({}, [], TODAY).failures.length, 1);
  assert.equal(evaluate(null, [], TODAY).failures.length, 1);
  assert.equal(evaluate({ auditReportVersion: 1, advisories: {} }, [], TODAY).failures.length, 1);
  assert.equal(evaluate({ error: { summary: "network down" } }, [], TODAY).failures.length, 1);
  assert.equal(evaluate(report({ vite: { severity: "high" } }), [], TODAY).failures.length, 1);
});

test("a clean report passes", () => {
  assert.deepEqual(evaluate(report({}), [], TODAY).failures, []);
});

test("ignore entries must be complete with a real expiry date", () => {
  assert.deepEqual(parseIgnoreList({ advisories: [entry()] }).errors, []);
  for (const bad of [
    entry({ expires: undefined }),
    entry({ expires: "tomorrow" }),
    entry({ expires: "12/31/2026" }),
    entry({ expires: "2026-02-30" }),
    entry({ reason: " " }),
    entry({ package: undefined }),
    entry({ id: "CVE-2026-1" }),
  ]) {
    assert.equal(parseIgnoreList({ advisories: [bad] }).errors.length, 1, JSON.stringify(bad));
  }
  assert.equal(parseIgnoreList({}).errors.length, 1);
});
