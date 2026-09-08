import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { WORK_HOURS_NOTIFICATION_TYPE, workHoursNotificationId } from "../src/lib/admin-notifications.js";

const source = await readFile(new URL("../src/lib/firebase-store.js", import.meta.url), "utf8");
const removeField = Symbol("deleteField");
const input = { id: "2026-09_teacher", teacherId: "teacher", teacherUid: "uid", month: "2026-09", employeeWorkHours: 0, businessHours: { hourly: 10 } };

function storeOperation(name, nextName) {
  const writes = [];
  let committed = false;
  const batch = { set: (reference, data, options) => writes.push({ reference, data, options }), commit: async () => { committed = true; } };
  const firestoreSdk = {
    writeBatch: () => batch,
    serverTimestamp: () => "server-time",
    deleteField: () => removeField,
    doc: (_db, collection, id) => `${collection}/${id}`
  };
  const start = source.indexOf(`  async function ${name}(`);
  const end = source.indexOf(`  async function ${nextName}(`, start);
  assert.ok(start >= 0 && end > start);
  const operation = vm.runInNewContext(`${source.slice(start, end)}\n${name}`, {
    firestoreSdk, db: {}, auth: { currentUser: { uid: "uid" } }, WORK_HOURS_NOTIFICATION_TYPE, workHoursNotificationId
  });
  return { operation, writes, committed: () => committed };
}

test("시급 전용 제출에는 새 학원비 필드를 남기지 않고 기존 시수와 알림을 저장한다", async () => {
  const store = storeOperation("saveTeacherMonthlyInput", "saveExpenseReceipt");
  await store.operation({ ...input, tuitionInput: null });
  assert.equal(store.writes[0].data.tuitionInput, removeField);
  assert.equal(store.writes[0].data.businessHours.hourly, 10);
  assert.equal(store.writes[0].options.merge, true);
  assert.equal(store.writes[1].reference, `adminNotifications/${workHoursNotificationId(input.month, input.teacherId)}`);
  assert.equal(store.committed(), true);
});

test("비율제의 담당 학생 내역과 명시적 입력 대기를 제출한다", async () => {
  for (const groups of [[], [{ studentCount: 10, tuitionPerStudent: 300000 }]]) {
    const store = storeOperation("saveTeacherMonthlyInput", "saveExpenseReceipt");
    const tuitionInput = { rateId: "share", groups };
    await store.operation({ ...input, tuitionInput });
    assert.equal(store.writes[0].data.tuitionInput, tuitionInput);
    assert.equal(store.committed(), true);
  }
});

test("관리자 저장도 학생 내역이 없으면 필드를 제거하고 있는 제출값은 보존한다", async () => {
  for (const tuitionInput of [null, { rateId: "share", groups: [{ studentCount: 5, tuitionPerStudent: 400000 }] }]) {
    const store = storeOperation("saveAdminMonthlyPayroll", "publishPayrollRun");
    await store.operation({ id: input.id, businessWorkLines: [] }, { ...input, tuitionInput });
    assert.equal(store.writes[1].data.tuitionInput, tuitionInput ?? removeField);
    assert.equal(store.writes[1].options.merge, true);
    assert.equal(store.committed(), true);
  }
});
