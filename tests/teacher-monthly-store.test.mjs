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
  assert.ok(store.writes[0].options.mergeFields.includes("tuitionInput"));
  assert.equal(store.writes[1].reference, `adminNotifications/${workHoursNotificationId(input.month, input.teacherId)}`);
  assert.equal(store.committed(), true);
});

test("비율제의 전체 학원비·0원·입력 대기와 이전 제출 형식을 저장한다", async () => {
  for (const tuitionInput of [
    { rateId: "share", tuitionAmount: null },
    { rateId: "share", tuitionAmount: 0 },
    { rateId: "share", tuitionAmount: 5000000 },
    { rateId: "share", groups: [{ studentCount: 10, tuitionPerStudent: 300000 }] }
  ]) {
    const store = storeOperation("saveTeacherMonthlyInput", "saveExpenseReceipt");
    await store.operation({ ...input, tuitionInput });
    assert.equal(store.writes[0].data.tuitionInput, tuitionInput);
    assert.equal(store.committed(), true);
  }
});

test("관리자 저장도 학원비가 없으면 필드를 제거하고 있는 제출값은 보존한다", async () => {
  for (const tuitionInput of [null, { rateId: "share", tuitionAmount: 5000000 }, { rateId: "share", groups: [{ studentCount: 5, tuitionPerStudent: 400000 }] }]) {
    const store = storeOperation("saveAdminMonthlyPayroll", "publishPayrollRun");
    await store.operation({ id: input.id, businessWorkLines: [] }, { ...input, tuitionInput });
    assert.equal(store.writes[1].data.tuitionInput, tuitionInput ?? removeField);
    assert.ok(store.writes[1].options.mergeFields.includes("tuitionInput"));
    assert.equal(store.committed(), true);
  }
});

test("선생님과 관리자 저장은 tuitionInput 맵 전체를 교체해 이전 groups와 섞지 않는다", async () => {
  for (const operation of ["saveTeacherMonthlyInput", "saveAdminMonthlyPayroll"]) {
    const store = storeOperation(operation, operation === "saveTeacherMonthlyInput" ? "saveExpenseReceipt" : "publishPayrollRun");
    const tuitionInput = { rateId: "share", tuitionAmount: 5000000 };
    const monthlyInput = { ...input, tuitionInput };
    if (operation === "saveTeacherMonthlyInput") await store.operation(monthlyInput);
    else await store.operation({ id: input.id, businessWorkLines: [] }, monthlyInput);
    const write = store.writes.find((item) => item.reference.startsWith("teacherMonthlyInputs/"));
    assert.deepEqual([...write.options.mergeFields].sort(), Object.keys(write.data).sort());
    assert.ok(write.options.mergeFields.every((field) => !field.includes(".")));
    const old = { tuitionInput: { rateId: "share", groups: [] }, unrelated: "preserve" };
    for (const field of write.options.mergeFields) old[field] = write.data[field];
    assert.deepEqual(old.tuitionInput, tuitionInput);
    assert.equal(old.unrelated, "preserve");
    assert.equal("groups" in old.tuitionInput, false);
  }
});
