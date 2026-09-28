import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const managerSource = await readFile(new URL("../routes/manager.js", import.meta.url), "utf8");
const residentSource = await readFile(new URL("../routes/residentKnowledge.js", import.meta.url), "utf8");

function routeSlices(routeLiteral, span = 2600) {
  const slices = [];
  let from = 0;

  while (true) {
    const index = managerSource.indexOf(routeLiteral, from);
    if (index === -1) break;
    slices.push(managerSource.slice(index, index + span));
    from = index + routeLiteral.length;
  }

  return slices;
}

test("manager Knowledge Base GET checks residency access", () => {
  const routeStart = managerSource.indexOf('"/residencies/:id/template"');
  assert.notEqual(routeStart, -1, "manager template route should exist");
  const routeSlice = managerSource.slice(routeStart, routeStart + 3200);
  assert.match(routeSlice, /getManagerDbId\(req\.user\.id\)/);
  assert.match(routeSlice, /managerHasResidencyAccess\(managerDbId, id\)/);
  assert.match(routeSlice, /Residency access denied/);
});

test("manager FAQ CRUD uses explicit residency-scoped routes", () => {
  assert.equal(routeSlices('"/residencies/:id/faqs"').length, 1);
  assert.equal(routeSlices('"/residencies/:id/faqs/:faqId"').length, 2);
  assert.doesNotMatch(managerSource, /template-items/);
});

test("B04 exposes explicit typed CRUD routes for all remaining KB sections", () => {
  assert.equal(routeSlices('"/residencies/:id/rules"').length, 1);
  assert.equal(routeSlices('"/residencies/:id/rules/:ruleId"').length, 2);

  assert.equal(routeSlices('"/residencies/:id/emergency-contacts"').length, 1);
  assert.equal(routeSlices('"/residencies/:id/emergency-contacts/:contactId"').length, 2);

  assert.equal(routeSlices('"/residencies/:id/info-items"').length, 1);
  assert.equal(routeSlices('"/residencies/:id/info-items/:infoItemId"').length, 2);

  assert.equal(routeSlices('"/residencies/:id/announcements"').length, 1);
  assert.equal(routeSlices('"/residencies/:id/announcements/:announcementId"').length, 2);
});

test("all B04 typed mutation routes enforce manager residency access", () => {
  const routes = [
    '"/residencies/:id/rules"',
    '"/residencies/:id/rules/:ruleId"',
    '"/residencies/:id/emergency-contacts"',
    '"/residencies/:id/emergency-contacts/:contactId"',
    '"/residencies/:id/info-items"',
    '"/residencies/:id/info-items/:infoItemId"',
    '"/residencies/:id/announcements"',
    '"/residencies/:id/announcements/:announcementId"',
  ];

  for (const route of routes) {
    const slices = routeSlices(route);
    assert.ok(slices.length > 0, `route missing: ${route}`);
    for (const slice of slices) {
      assert.match(
        slice,
        /requireManagerResidencyAccessForRequest\(req, res, id\)/,
        `route does not enforce residency access: ${route}`
      );
    }
  }
});

test("manager KB response exposes publication state for every section", () => {
  assert.match(managerSource, /SELECT id, title, description, display_order, is_active\s+FROM rules/);
  assert.match(managerSource, /SELECT id, question, answer, display_order, is_active\s+FROM faqs/);
  assert.match(managerSource, /SELECT id, name, phone, email, description, is_active\s+FROM emergency_contacts/);
  assert.match(managerSource, /SELECT id, category, title, content, display_order, is_active\s+FROM info_items/);
  assert.match(managerSource, /SELECT id, title, message, start_date, end_date, is_active\s+FROM announcements/);
});

test("typed KB updates and deletes remain scoped to the selected residency", () => {
  for (const table of ["rules", "emergency_contacts", "info_items", "announcements"]) {
    assert.match(
      managerSource,
      new RegExp(`UPDATE ${table}[\\s\\S]*?AND residency_id = \\\$\\$\\{residencyIdParam\\}`)
    );
    assert.match(
      managerSource,
      new RegExp(`DELETE FROM ${table}[\\s\\S]*?WHERE id = \\\$1[\\s\\S]*?AND residency_id = \\\$2`)
    );
  }
});

test("resident Knowledge Base only publishes active records from every section", () => {
  for (const table of ["rules", "faqs", "emergency_contacts", "info_items"]) {
    assert.match(
      residentSource,
      new RegExp(`FROM ${table}\\s+WHERE residency_id = \\\$1 AND is_active = true`)
    );
  }

  assert.match(
    residentSource,
    /FROM announcements[\s\S]*?WHERE residency_id = \$1[\s\S]*?AND is_active = true/
  );
});

test("announcement publication windows are enforced for resident lists and search", () => {
  const startMatches =
    residentSource.match(/start_date IS NULL OR start_date <= CURRENT_DATE/g) ?? [];
  const endMatches =
    residentSource.match(/end_date IS NULL OR end_date >= CURRENT_DATE/g) ?? [];

  assert.equal(startMatches.length, 4);
  assert.equal(endMatches.length, 4);
});

test("announcement date changes are validated before the update query", () => {
  const routeStart = managerSource.indexOf('"/residencies/:id/announcements/:announcementId"');
  assert.notEqual(routeStart, -1);
  const patchSlice = managerSource.slice(routeStart, routeStart + 5200);

  const selectIndex = patchSlice.indexOf("SELECT start_date, end_date");
  const updateIndex = patchSlice.indexOf("UPDATE announcements");
  const validationIndex = patchSlice.indexOf("end_date cannot be before start_date");

  assert.ok(selectIndex >= 0, "existing announcement dates should be loaded");
  assert.ok(validationIndex > selectIndex, "date validation should occur after existing dates are loaded");
  assert.ok(updateIndex > validationIndex, "date validation must happen before UPDATE");
});

test("resident template exposes residency name", () => {
  assert.match(residentSource, /SELECT id, name, is_archived\s+FROM residencies/);
  assert.match(residentSource, /residency_name: residency\.name/);
});
