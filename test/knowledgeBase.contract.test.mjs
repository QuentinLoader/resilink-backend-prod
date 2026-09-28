import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const managerSource = await readFile(new URL("../routes/manager.js", import.meta.url), "utf8");
const residentSource = await readFile(new URL("../routes/residentKnowledge.js", import.meta.url), "utf8");

test("manager Knowledge Base GET checks residency access", () => {
  const routeStart = managerSource.indexOf('"/residencies/:id/template"');
  assert.notEqual(routeStart, -1, "manager template route should exist");
  const routeSlice = managerSource.slice(routeStart, routeStart + 3200);
  assert.match(routeSlice, /getManagerDbId\(req\.user\.id\)/);
  assert.match(routeSlice, /managerHasResidencyAccess\(managerDbId, id\)/);
  assert.match(routeSlice, /Residency access denied/);
});

test("manager FAQ CRUD uses explicit residency-scoped routes", () => {
  assert.match(managerSource, /"\/residencies\/:id\/faqs"/);
  const matches = managerSource.match(/"\/residencies\/:id\/faqs\/:faqId"/g) ?? [];
  assert.equal(matches.length, 2, "PATCH and DELETE FAQ routes should exist");
  assert.doesNotMatch(managerSource, /template-items/);
});

test("manager FAQ responses expose publication state", () => {
  assert.match(managerSource, /SELECT id, question, answer, display_order, is_active\s+FROM faqs/);
  assert.match(managerSource, /RETURNING id, question, answer, display_order, is_active/);
});

test("FAQ update and delete remain residency scoped", () => {
  assert.match(managerSource, /UPDATE faqs[\s\S]*?AND residency_id = \$\$\{residencyIdParam\}/);
  assert.match(managerSource, /DELETE FROM faqs[\s\S]*?WHERE id = \$1[\s\S]*?AND residency_id = \$2/);
});

test("resident FAQ list only publishes active FAQ records", () => {
  assert.match(residentSource, /FROM faqs\s+WHERE residency_id = \$1 AND is_active = true/);
});

test("resident template exposes residency name", () => {
  assert.match(residentSource, /SELECT id, name, is_archived\s+FROM residencies/);
  assert.match(residentSource, /residency_name: residency\.name/);
});
