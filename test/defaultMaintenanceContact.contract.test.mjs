import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const managerSource = await readFile(new URL("../routes/manager.js", import.meta.url), "utf8");
const residentSource = await readFile(new URL("../routes/resident.js", import.meta.url), "utf8");
const residentMaintenanceSource = await readFile(new URL("../routes/resident.maintenance.js", import.meta.url), "utf8");
const artisanSource = await readFile(new URL("../routes/artisan.js", import.meta.url), "utf8");
const migrationSource = await readFile(
  new URL("../migrations/20260928_default_maintenance_contact.sql", import.meta.url),
  "utf8"
);

test("migration adds a nullable default maintenance contact and only safe single-link backfill", () => {
  assert.match(migrationSource, /ADD COLUMN IF NOT EXISTS default_artisan_id UUID NULL/);
  assert.match(migrationSource, /REFERENCES artisans\(id\)/);
  assert.match(migrationSource, /ON DELETE SET NULL/);
  assert.match(migrationSource, /HAVING COUNT\(\*\) = 1/);
  assert.match(migrationSource, /UPDATE maintenance_requests m/);
  assert.match(migrationSource, /r\.default_artisan_id IS NOT NULL/);
  assert.match(migrationSource, /m\.artisan_id IS NULL/);
  assert.match(migrationSource, /NOT IN \('completed', 'cancelled'\)/);
});

test("manager residency list exposes the default maintenance contact", () => {
  assert.match(managerSource, /r\.default_artisan_id/);
  assert.match(managerSource, /da\.name AS default_artisan_name/);
  assert.match(managerSource, /da\.access_code AS default_artisan_access_code/);
});

test("manager can set the residency default and unassigned active jobs inherit it", () => {
  const routeStart = managerSource.indexOf('"/residencies/:id/default-artisan"');
  assert.notEqual(routeStart, -1);
  const routeSlice = managerSource.slice(routeStart, routeStart + 6000);

  assert.match(routeSlice, /INSERT INTO residency_artisans/);
  assert.match(routeSlice, /SET default_artisan_id = \$1/);
  assert.match(routeSlice, /UPDATE maintenance_requests/);
  assert.match(routeSlice, /artisan_id IS NULL/);
  assert.match(routeSlice, /status = CASE WHEN status = 'pending' OR status IS NULL THEN 'claimed'/);
  assert.match(routeSlice, /auto_assigned_count/);
});

test("new resident maintenance requests inherit the residency default contact", () => {
  assert.match(residentSource, /default_artisan_id/);
  assert.match(residentSource, /artisan_id,/);
  assert.match(residentSource, /CASE WHEN \$11::uuid IS NULL THEN 'pending' ELSE 'claimed' END/);

  assert.match(residentMaintenanceSource, /residencies\.default_artisan_id/);
  assert.match(residentMaintenanceSource, /artisan_id,/);
  assert.match(residentMaintenanceSource, /CASE WHEN \$7::uuid IS NULL THEN 'pending' ELSE 'claimed' END/);
});

test("artisan portal only returns jobs explicitly assigned to that artisan", () => {
  const jobsStart = artisanSource.indexOf('router.get("/:accessCode/jobs"');
  assert.notEqual(jobsStart, -1);
  const jobsSlice = artisanSource.slice(jobsStart, jobsStart + 2500);

  assert.match(jobsSlice, /WHERE m\.artisan_id = \$1/);
  assert.doesNotMatch(jobsSlice, /JOIN residency_artisans ra/);
});

test("default contact cannot be removed until another default is selected", () => {
  const routeStart = managerSource.indexOf('"/residencies/:residencyId/artisans/:artisanId"');
  assert.notEqual(routeStart, -1);
  const routeSlice = managerSource.slice(routeStart, routeStart + 2200);

  assert.match(routeSlice, /default_artisan_id/);
  assert.match(routeSlice, /DEFAULT_MAINTENANCE_CONTACT/);
});

test("ticket-level artisan override remains supported but only for a linked residency artisan", () => {
  const routeStart = managerSource.indexOf('"/maintenance/:id/assign-artisan"');
  assert.notEqual(routeStart, -1);
  const routeSlice = managerSource.slice(routeStart, routeStart + 4800);

  assert.match(routeSlice, /JOIN manager_residencies/);
  assert.match(routeSlice, /FROM residency_artisans/);
  assert.match(routeSlice, /ARTISAN_NOT_LINKED/);
  assert.match(routeSlice, /SET[\s\S]*artisan_id = \$1/);
});
