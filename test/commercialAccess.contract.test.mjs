import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  deriveManagerAccessState,
  buildManagerFeatures,
  hasOperationalAccess
} from "../utils/planTrial.js";

const managerSource = await readFile(new URL("../routes/manager.js", import.meta.url), "utf8");
const managerMaintenanceSource = await readFile(new URL("../routes/manager.maintenance.js", import.meta.url), "utf8");
const residentSource = await readFile(new URL("../routes/resident.js", import.meta.url), "utf8");
const residentKnowledgeSource = await readFile(new URL("../routes/residentKnowledge.js", import.meta.url), "utf8");
const adminSource = await readFile(new URL("../routes/admin.js", import.meta.url), "utf8");
const publicSource = await readFile(new URL("../routes/public.js", import.meta.url), "utf8");

test("commercial states resolve to TRIAL, PRO, EXPIRED and SUSPENDED", () => {
  assert.equal(
    deriveManagerAccessState({
      planCode: "FREE",
      trialEndsAt: new Date(Date.now() + 86_400_000)
    }),
    "TRIAL"
  );
  assert.equal(
    deriveManagerAccessState({
      planCode: "PRO",
      trialEndsAt: new Date(Date.now() - 86_400_000)
    }),
    "PRO"
  );
  assert.equal(
    deriveManagerAccessState({
      planCode: "FREE",
      trialEndsAt: new Date(Date.now() - 86_400_000)
    }),
    "EXPIRED"
  );
  assert.equal(
    deriveManagerAccessState({
      planCode: "SUSPENDED",
      trialEndsAt: new Date(Date.now() + 86_400_000)
    }),
    "SUSPENDED"
  );
});

test("only Trial and Pro have operational access", () => {
  assert.equal(hasOperationalAccess("TRIAL"), true);
  assert.equal(hasOperationalAccess("PRO"), true);
  assert.equal(hasOperationalAccess("EXPIRED"), false);
  assert.equal(hasOperationalAccess("SUSPENDED"), false);
});

test("Trial and Pro expose the same full feature set", () => {
  for (const state of ["TRIAL", "PRO"]) {
    const features = buildManagerFeatures({ accessState: state });
    for (const value of Object.values(features)) {
      assert.equal(value, true);
    }
  }
});

test("Expired and Suspended expose no operational features", () => {
  for (const state of ["EXPIRED", "SUSPENDED"]) {
    const features = buildManagerFeatures({ accessState: state });
    for (const value of Object.values(features)) {
      assert.equal(value, false);
    }
  }
});

test("manager operational routes are protected after account endpoints", () => {
  const accountIndex = managerSource.indexOf('router.get("/account"');
  const gateIndex = managerSource.indexOf(
    "router.use(authenticateUser, requireManagerOperationalAccess)"
  );
  const residenciesIndex = managerSource.indexOf('router.get("/residencies"');

  assert.ok(accountIndex >= 0);
  assert.ok(gateIndex > accountIndex);
  assert.ok(residenciesIndex > gateIndex);
  assert.match(
    managerMaintenanceSource,
    /router\.use\(authenticateUser, requireManagerOperationalAccess\)/
  );
});

test("resident portal and maintenance routes enforce residency commercial access", () => {
  assert.match(residentSource, /requireResidencyOperationalAccess\(residency\.id, res\)/);
  assert.match(
    residentKnowledgeSource,
    /requireResidencyOperationalAccess\(residency\.id, res\)/
  );
  assert.match(
    residentKnowledgeSource,
    /requireResidencyOperationalAccess\(id, res\)/
  );
});

test("new manager registration starts the 30-day trial", () => {
  assert.match(publicSource, /startManagerTrialIfEligible\(managerDbId, client\)/);
  assert.match(publicSource, /30-day full-access trial/);
});

test("AddVision admin API is locked to the admin middleware and supports four states", () => {
  assert.match(adminSource, /router\.use\(authenticateUser, requireAddVisionAdmin\)/);
  assert.match(adminSource, /TRIAL/);
  assert.match(adminSource, /PRO/);
  assert.match(adminSource, /EXPIRED/);
  assert.match(adminSource, /SUSPENDED/);
  assert.match(adminSource, /trial_notify_7d_sent_at/);
  assert.match(adminSource, /trial_notify_1d_sent_at/);
  assert.match(adminSource, /trial_expired_notified_at/);
});
