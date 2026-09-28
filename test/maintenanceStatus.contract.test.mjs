import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../routes/manager.maintenance.js", import.meta.url), "utf8");
const managerSource = await readFile(new URL("../routes/manager.js", import.meta.url), "utf8");

test("manager maintenance transitions accept assigned and legacy scheduled requests", () => {
  assert.match(source, /claimed:\s*\["in_progress", "cancelled"\]/);
  assert.match(source, /scheduled:\s*\["in_progress", "cancelled"\]/);
  assert.doesNotMatch(source, /pending:\s*\[[^\]]*"scheduled"/);
});

test("manager start transition records started_at once", () => {
  assert.match(
    source,
    /WHEN \$1 = 'in_progress' THEN COALESCE\(started_at, NOW\(\)\)/
  );
});

test("manager complete transition records completed_at once", () => {
  assert.match(
    source,
    /WHEN \$1 = 'completed' THEN COALESCE\(completed_at, NOW\(\)\)/
  );
});

test("completed and cancelled requests remain terminal", () => {
  assert.match(source, /completed:\s*\[\]/);
  assert.match(source, /cancelled:\s*\[\]/);
});

test("residency maintenance feed includes cancelled requests for the conditional Cancelled tab", () => {
  const routeStart = managerSource.indexOf('"/residencies/:id/maintenance"');
  assert.notEqual(routeStart, -1);
  const routeSlice = managerSource.slice(routeStart, routeStart + 2200);
  assert.doesNotMatch(routeSlice, /m\.status\s*!=\s*'cancelled'/);
  assert.doesNotMatch(routeSlice, /m\.status\s*<>\s*'cancelled'/);
});
