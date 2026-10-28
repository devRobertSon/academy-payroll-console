import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";

const app = await readFile(new URL("../src/app.js", import.meta.url), "utf8");

function sourceFor(name) {
  const start = app.search(new RegExp(`(?:async )?function ${name}\\(`));
  assert.ok(start >= 0, name);
  const rest = app.slice(start);
  const end = rest.search(/\r?\n(?:async )?function /);
  return end < 0 ? rest : rest.slice(0, end);
}

function fixedDate(clock) {
  return class extends Date {
    constructor(...args) { super(...(args.length ? args : [clock.now])); }
  };
}

function workspace({ demoMode = false, loaded = {} } = {}) {
  const clock = { now: "2026-10-28T00:00:00Z" };
  const state = {
    month: "2026-09", selectedPayslipMonth: "2026-09", retirementMonth: "2026-09",
    data: { teachers: [] }, store: { loadWorkspace: async () => loaded }
  };
  const rendered = [];
  const context = {
    state, appConfig: { demoMode }, Date: fixedDate(clock), URL,
    mergeBuiltInTaxPolicies: (items) => items, mergeBuiltInInsurancePolicies: (items) => items,
    teacherById: (id) => state.data.teachers.find((teacher) => teacher.id === id),
    elements: { login: {}, workspace: {}, assistantEntry: {} },
    document: { querySelector: () => ({}) },
    window: { location: { href: "https://payroll.example.invalid/" } },
    initializeAssistant() {}, closeAssistant() {}, roleLabel: (role) => role,
    render: () => rendered.push({ month: state.month, view: state.view }),
    unreadAdminNotificationItems: () => []
  };
  const api = runInNewContext(`${["currentCalendarMonth", "hydrateFirebaseData", "openWorkspace"].map(sourceFor).join("\n")}
    ({ hydrateFirebaseData, openWorkspace })`, context);
  return { ...api, state, clock, rendered };
}

test("calendar month follows Seoul time at month, year and leap-year boundaries", () => {
  for (const [now, expected] of [
    ["2026-09-30T14:59:59Z", "2026-09"],
    ["2026-09-30T15:00:00Z", "2026-10"],
    ["2026-10-28T00:00:00Z", "2026-10"],
    ["2026-12-31T15:00:00Z", "2027-01"],
    ["2028-02-29T15:00:00Z", "2028-03"]
  ]) {
    const currentMonth = runInNewContext(`${sourceFor("currentCalendarMonth")}\ncurrentCalendarMonth`, {
      Date: fixedDate({ now })
    });
    assert.equal(currentMonth(), expected, now);
  }
});

for (const role of ["admin", "teacher"]) {
  for (const savedMonth of [null, "2026-09", "2027-01"]) {
    test(`${role} opens this month regardless of saved month ${savedMonth}`, async () => {
      const loaded = {
        teachers: [{ id: "demo", profileCompleted: true }],
        payrollRuns: savedMonth ? [{ month: savedMonth, status: "published" }] : [],
        teacherMonthlyInputs: savedMonth ? [{ month: savedMonth, teacherId: "demo" }] : []
      };
      const before = structuredClone(loaded);
      const session = workspace({ loaded });
      await session.openWorkspace({ role, name: "Demo", teacherId: "demo" });
      assert.deepEqual(session.rendered, [{ month: "2026-10", view: role === "admin" ? "dashboard" : "workHours" }]);
      assert.equal(session.state.selectedPayslipMonth, "2026-10");
      assert.equal(session.state.retirementMonth, "2026-10");
      assert.deepEqual(loaded, before);
    });
  }

  test(`${role} data refresh preserves a manually selected month`, () => {
    const session = workspace();
    session.state.user = { role };
    for (const month of ["2026-08", "2026-10", "2026-12"]) {
      session.state.month = month;
      session.hydrateFirebaseData({
        payrollRuns: [{ month: "2026-09" }],
        teacherMonthlyInputs: [{ month: "2027-01", teacherId: "demo" }]
      });
      assert.equal(session.state.month, month);
      assert.equal(session.state.data.monthlyWorkInputs["2027-01:demo"].month, "2027-01");
    }
  });
}

for (const demoMode of [false, true]) {
  test(`reopening a ${demoMode ? "demo" : "live"} workspace resets a stale month after a calendar rollover`, async () => {
    const session = workspace({ demoMode });
    const user = { role: "admin", name: "Demo" };
    await session.openWorkspace(user);
    session.state.month = "2026-08";
    session.clock.now = "2026-10-31T15:00:00Z";
    await session.openWorkspace(user);
    assert.equal(session.state.month, "2026-11");
    assert.equal(session.rendered.at(-1).month, "2026-11");
  });
}

test("new teacher profile onboarding is preserved", async () => {
  const session = workspace({ loaded: { teachers: [{ id: "demo", profileCompleted: false }] } });
  await session.openWorkspace({ role: "teacher", name: "Demo", teacherId: "demo" });
  assert.deepEqual(session.rendered, [{ month: "2026-10", view: "profile" }]);
});
