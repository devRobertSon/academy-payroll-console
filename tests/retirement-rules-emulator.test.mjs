import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { createRetirementStore } from "../src/lib/retirement-store.js";
import { retirementBasis, buildRetirementConfirmation } from "../src/lib/retirement.js";
import { excelSnapshot } from "../src/lib/payroll-excel-state.js";

test("retirement permissions, history and real store transactions", {
  skip: !process.env.FIRESTORE_EMULATOR_HOST && "Requires a loopback Firestore emulator; no production access"
}, async (t) => {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  assert.match(host, /^127\.0\.0\.1:\d+$/);
  const require = createRequire(new URL("../.firebase/teacher-rules-qa/package.json", import.meta.url));
  const { initializeTestEnvironment, assertFails } = require("@firebase/rules-unit-testing");
  const sdk = require("firebase/firestore");
  sdk.setLogLevel("silent");
  const env = await initializeTestEnvironment({ projectId: "demo-retirement-qa", firestore: {
    host: "127.0.0.1", port: Number(host.split(":")[1]), rules: await readFile(new URL("../firestore.rules", import.meta.url), "utf8")
  } });
  const suffix = randomUUID();
  const teacherId = `sample-${suffix}`;
  const id = `2026-09_${teacherId}`;
  const admin = `admin-${suffix}`;
  const otherAdmin = `other-${suffix}`;
  const teacherUid = `teacher-${suffix}`;
  const db = env.authenticatedContext(admin).firestore();
  const teacherDb = env.authenticatedContext(teacherUid).firestore();
  const admin2Db = env.authenticatedContext(otherAdmin).firestore();
  const inactiveDb = env.authenticatedContext(`inactive-${suffix}`).firestore();
  const store = createRetirementStore({ firestoreSdk: sdk, db, auth: { currentUser: { uid: admin } } });
  const store2 = createRetirementStore({ firestoreSdk: sdk, db: admin2Db, auth: { currentUser: { uid: otherAdmin } } });
  const payslip = { teacherId, month: "2026-09", revision: 1, status: "published",
    calculation: { earningLines: [{ subjectName: "Salary", earningCategory: "employeeSalary", amount: 2000000 }], net: 1800000 } };
  const input = { teacherId, month: "2026-09", basis: retirementBasis(payslip.calculation),
    actualAmount: "166667", paidOn: "2026-10-05", reviewed: true, note: "" };
  const recordRef = sdk.doc(db, "retirementContributions", id);
  const settingsRef = sdk.doc(db, "retirementSettings", teacherId);
  const current = async () => { const snap = await sdk.getDoc(recordRef); return snap.exists() ? { id: snap.id, ...snap.data() } : null; };
  const setup = async (fn) => env.withSecurityRulesDisabled((context) => fn(context.firestore()));
  const expected = (record = null) => ({ record, payslip: excelSnapshot(payslip) });
  try {
    await setup(async (owner) => {
      await sdk.setDoc(sdk.doc(owner, "users", admin), { role: "admin", status: "active", teacherId });
      await sdk.setDoc(sdk.doc(owner, "users", otherAdmin), { role: "admin", status: "active" });
      await sdk.setDoc(sdk.doc(owner, "users", `inactive-${suffix}`), { role: "admin", status: "inactive" });
      await sdk.setDoc(sdk.doc(owner, "users", teacherUid), { role: "teacher", status: "active", teacherId });
      await sdk.setDoc(sdk.doc(owner, "teachers", teacherId), { id: teacherId, authUid: admin });
      await sdk.setDoc(sdk.doc(owner, "payslips", id), payslip);
      await sdk.setDoc(sdk.doc(owner, "payrollRuns", "2026-09"), { status: "published", revision: 1 });
    });

    await t.test("only active admins can read or set enrollment, including their own teacher account", async () => {
      await store.saveRetirementSettings(teacherId, true, null);
      assert.equal((await store.loadRetirementData(teacherId)).settings.enabled, true);
      for (const client of [teacherDb, inactiveDb, env.unauthenticatedContext().firestore()]) {
        await assertFails(sdk.getDoc(sdk.doc(client, "retirementSettings", teacherId)));
        await assertFails(sdk.getDocs(sdk.collection(client, "retirementSettings")));
        await assertFails(sdk.setDoc(sdk.doc(client, "retirementSettings", teacherId), { teacherId, enabled: true, updatedAt: sdk.serverTimestamp(), updatedBy: teacherUid }));
      }
      await assert.rejects(store.saveRetirementSettings(teacherId, false, null), /다른 관리자/);
    });

    await t.test("real confirmation atomically saves the snapshot and history without changing pay", async () => {
      await store.confirmRetirementContribution(input, expected(), "Admin One");
      const saved = await current();
      assert.equal(saved.expectedAmount, 166667);
      assert.equal(saved.actualAmount, 166667);
      assert.equal(saved.confirmedName, "Admin One");
      assert.equal(saved.confirmedBy, admin);
      assert.ok(saved.confirmedAt.toMillis() > 0);
      assert.equal((await store.loadRetirementHistory(id)).length, 1);
      assert.deepEqual((await sdk.getDoc(sdk.doc(db, "payslips", id))).data(), payslip);
    });

    await t.test("teachers cannot get, query, write or delete contribution data or history", async () => {
      const saved = await current();
      for (const client of [teacherDb, inactiveDb, env.unauthenticatedContext().firestore()]) {
        const reference = sdk.doc(client, "retirementContributions", id);
        await assertFails(sdk.getDoc(reference));
        await assertFails(sdk.getDocs(sdk.query(sdk.collection(client, "retirementContributions"), sdk.where("teacherId", "==", teacherId))));
        await assertFails(sdk.setDoc(reference, { ...saved, actualAmount: 1 }));
        await assertFails(sdk.deleteDoc(reference));
        await assertFails(sdk.getDoc(sdk.doc(client, "retirementContributions", id, "history", saved.confirmationId)));
      }
    });

    await t.test("another administrator can correct a record and old confirmation remains immutable", async () => {
      const before = await current();
      await store2.confirmRetirementContribution({ ...input, actualAmount: 166670, note: "Bank rounding", correctionReason: "Correct actual amount" }, expected(before), "Admin Two");
      const after = await current();
      assert.equal(after.revision, 2);
      assert.equal(after.confirmedBy, otherAdmin);
      const history = await store.loadRetirementHistory(id);
      assert.deepEqual(history.map((item) => item.actualAmount), [166670, 166667]);
      await assertFails(sdk.updateDoc(sdk.doc(db, "retirementContributions", id, "history", before.confirmationId), { actualAmount: 0 }));
      await assertFails(sdk.deleteDoc(sdk.doc(db, "retirementContributions", id, "history", before.confirmationId)));
      await assertFails(sdk.deleteDoc(recordRef));
    });

    await t.test("stale review and disabled enrollment cannot confirm", async () => {
      await assert.rejects(store.confirmRetirementContribution(input, expected(), "Admin One"), /다른 관리자/);
      const loaded = await store.loadRetirementData(teacherId);
      await store.saveRetirementSettings(teacherId, false, loaded.settings);
      await assert.rejects(store.confirmRetirementContribution({ ...input, correctionReason: "Correction review" }, expected(await current()), "Admin One"), /대상 설정/);
      await store.saveRetirementSettings(teacherId, true, (await store.loadRetirementData(teacherId)).settings);
    });

    await t.test("payroll cancellation, republishing and changed source data invalidate an open review", async () => {
      for (const patch of [{ status: "cancelled" }, { revision: 2 }, { calculation: { ...payslip.calculation, net: 1 } }]) {
        await setup((owner) => sdk.setDoc(sdk.doc(owner, "payslips", id), { ...payslip, ...patch }));
        await assert.rejects(store.confirmRetirementContribution({ ...input, correctionReason: "Correction review" }, expected(await current()), "Admin One"), /급여가 취소되거나 변경/);
      }
      await setup((owner) => sdk.setDoc(sdk.doc(owner, "payslips", id), payslip));
    });

    await t.test("rules reject malformed or history-free writes even for an admin", async () => {
      const previous = await current();
      const draft = buildRetirementConfirmation({ ...input, payslip, previous, correctionReason: "Correction review" });
      const cases = [
        { actualAmount: -1 }, { actualAmount: 0.5 }, { actualAmount: 10000000001 },
        { expectedAmount: 166666 }, { baseAmount: -1 }, { revision: 20 }, { sourceRevision: 2 },
        { confirmedBy: teacherUid }, { confirmedAt: new Date(0) }, { correctionReason: "" },
        { unexpected: true }, { basis: [] }, { basis: Array(201).fill({}) }, { note: "a".repeat(1001) },
        { confirmedName: "" }, { status: "draft" }, { month: "2026-13" }
      ];
      for (const patch of cases) {
        const confirmationId = randomUUID();
        const value = { ...draft, confirmationId, confirmedBy: admin, confirmedName: "Admin", confirmedAt: sdk.serverTimestamp(), ...patch };
        const batch = sdk.writeBatch(db);
        batch.set(recordRef, value);
        batch.set(sdk.doc(db, "retirementContributions", id, "history", confirmationId), value);
        await assertFails(batch.commit());
      }
      await assertFails(sdk.setDoc(recordRef, { ...draft, confirmationId: randomUUID(), confirmedBy: admin, confirmedName: "Admin", confirmedAt: sdk.serverTimestamp() }));
      assert.equal((await current()).revision, previous.revision);
      assert.equal((await store.loadRetirementHistory(id)).length, 2);
    });
  } finally { await env.cleanup(); }
});
