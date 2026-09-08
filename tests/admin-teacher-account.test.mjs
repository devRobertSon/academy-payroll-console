import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { assertTeacherAccountLink, linkedTeacherForUser, teacherAccountUpdate } from "../src/lib/teacher-account.js";

const source = await readFile(new URL("../src/lib/firebase-store.js", import.meta.url), "utf8");
const app = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
const rules = await readFile(new URL("../firestore.rules", import.meta.url), "utf8");
const removeField = Symbol("deleteField");
const teacher = { id: "teacher-owner", authUid: "owner", name: "급여 담당자", email: "owner@example.invalid", status: "active" };
const admin = { role: "admin", status: "active", teacherId: teacher.id, displayName: "관리자", email: teacher.email, custom: "keep" };

function operation(name, records = {}, uid = "owner") {
  const database = structuredClone(records);
  const writes = [];
  let committed = false;
  const snapshot = (path) => ({ exists: () => !!database[path], data: () => structuredClone(database[path]) });
  const sdk = {
    doc: (_db, collection, id) => `${collection}/${id}`,
    serverTimestamp: () => "server-time",
    deleteField: () => removeField,
    runTransaction: async (_db, callback) => {
      let writing = false;
      const transaction = {
        get: async (path) => { assert.equal(writing, false, "All transaction reads precede writes"); return snapshot(path); },
        set: (path, data, options) => { writing = true; writes.push({ type: "set", path, data, merge: options?.merge }); },
        update: (path, data) => { writing = true; writes.push({ type: "update", path, data }); },
        delete: (path) => { writing = true; writes.push({ type: "delete", path }); }
      };
      const result = await callback(transaction);
      for (const write of writes) {
        if (write.type === "delete") delete database[write.path];
        else {
          if (write.type === "update") assert.ok(database[write.path], "update requires an existing document");
          const value = write.type === "update" || write.merge ? { ...database[write.path] } : {};
          for (const [key, field] of Object.entries(write.data)) {
            if (field === removeField) delete value[key];
            else value[key] = field;
          }
          database[write.path] = value;
        }
      }
      committed = true;
      return result;
    }
  };
  const start = source.indexOf(`  async function ${name}(`);
  const end = source.indexOf("\n  async function ", start + 1);
  assert.ok(start > 0 && end > start);
  const run = vm.runInNewContext(`${source.slice(start, end)}\n${name}`, {
    firestoreSdk: sdk, db: {}, auth: { currentUser: { uid, email: teacher.email } },
    crypto: { randomUUID: () => "audit-id" }, assertTeacherAccountLink, teacherAccountUpdate
  });
  return { run, database, writes, committed: () => committed };
}

test("겸용 계정은 양방향 UID 연결과 활성 급여 대상이 있을 때만 본인 화면을 연다", () => {
  const user = { uid: "owner", ...admin };
  assert.equal(linkedTeacherForUser(user, [teacher], { activeOnly: true }), teacher);
  for (const invalid of [{ ...user, teacherId: "other" }, { ...user, uid: "other" }, { ...user, status: "inactive" }]) {
    assert.equal(linkedTeacherForUser(invalid, [teacher], { activeOnly: true }), null);
  }
  const inactive = { ...teacher, status: "inactive" };
  assert.equal(linkedTeacherForUser(user, [inactive], { activeOnly: true }), null);
  assert.equal(linkedTeacherForUser(user, [inactive]), inactive);
});

test("관리자 계정 갱신에는 권한·상태·이메일·이름 변경을 포함하지 않는다", () => {
  assert.deepEqual(teacherAccountUpdate(admin, { ...teacher, status: "inactive" }, "owner"), { teacherId: teacher.id });
});

for (const status of ["active", "inactive"]) {
  test(`선생님 ${status} 수정으로 관리자 권한이나 계정 상태를 덮어쓰지 않는다`, async () => {
    const store = operation("updateTeacher", { "teachers/teacher-owner": teacher, "users/owner": admin });
    await store.run({ ...teacher, name: "변경 이름", status });
    for (const key of ["role", "status", "displayName", "email", "custom"]) assert.equal(store.database["users/owner"][key], admin[key]);
    assert.equal(store.database["teachers/teacher-owner"].status, status);
    assert.equal(store.committed(), true);
  });
}

test("일반 선생님의 비활성화는 기존대로 선생님 로그인을 중단한다", async () => {
  const store = operation("updateTeacher", { "teachers/teacher-owner": teacher, "users/owner": { ...admin, role: "teacher" } });
  await store.run({ ...teacher, status: "inactive" });
  assert.equal(store.database["users/owner"].role, "teacher");
  assert.equal(store.database["users/owner"].status, "inactive");
});

test("선생님 삭제는 관리자 문서와 승인 요청을 보존하고 급여 연결만 제거한다", async () => {
  const store = operation("deleteTeacher", {
    "teachers/teacher-owner": teacher, "users/owner": admin,
    "accessRequests/owner": { status: "approved" }, "teacherMonthlyInputs/draft": { teacherId: teacher.id }
  });
  await store.run(teacher, [{ collection: "teacherMonthlyInputs", id: "draft" }]);
  assert.equal(store.database["teachers/teacher-owner"], undefined);
  assert.equal(store.database["teacherMonthlyInputs/draft"], undefined);
  assert.equal(store.database["users/owner"].role, "admin");
  assert.equal(store.database["users/owner"].status, "active");
  assert.equal(store.database["users/owner"].teacherId, undefined);
  assert.equal(store.database["accessRequests/owner"].status, "approved");
  assert.equal(store.database["auditLogs/audit-id"].action, "TEACHER_DELETED");
});

test("일반 선생님 삭제는 선생님 계정·승인 요청을 함께 삭제한다", async () => {
  const store = operation("deleteTeacher", { "teachers/teacher-owner": teacher, "users/owner": { ...admin, role: "teacher" }, "accessRequests/owner": {} });
  await store.run(teacher);
  assert.equal(store.database["users/owner"], undefined);
  assert.equal(store.database["accessRequests/owner"], undefined);
});

test("등록 정보 수정·삭제 때 다른 선생님에 연결된 계정을 건드리지 않는다", async () => {
  for (const name of ["updateTeacher", "deleteTeacher"]) {
    const store = operation(name, { "teachers/teacher-owner": teacher, "users/owner": { ...admin, teacherId: "other-teacher" } });
    await assert.rejects(store.run(teacher), /다른 선생님/);
    assert.equal(store.committed(), false);
  }
});

test("화면을 연 뒤 UID 연결이 바뀌었으면 수정·삭제를 중단한다", async () => {
  for (const name of ["updateTeacher", "deleteTeacher"]) {
    const store = operation(name, { "teachers/teacher-owner": { ...teacher, authUid: "other" }, "users/owner": admin });
    await assert.rejects(store.run(teacher), /연결 상태/);
    assert.equal(store.committed(), false);
  }
});

for (const createTeacher of [false, true]) {
  test(`관리자 본인 급여 ${createTeacher ? "신규 등록" : "기존 연결"}은 권한을 보존한다`, async () => {
    const account = { ...admin };
    delete account.teacherId;
    const draft = { ...teacher, authUid: null };
    const store = operation("linkAdminTeacher", { "users/owner": account, ...(!createTeacher ? { "teachers/teacher-owner": draft } : {}) });
    const result = await store.run(draft, { createTeacher });
    assert.equal(result.authUid, "owner");
    assert.equal(store.database["users/owner"].teacherId, teacher.id);
    assert.equal(store.database["users/owner"].role, "admin");
    assert.equal(store.database["users/owner"].status, "active");
    assert.equal(store.database["users/owner"].custom, "keep");
    assert.equal(store.database["auditLogs/audit-id"].action, "ADMIN_TEACHER_LINKED");
  });
}

test("중복 신규 등록·타인 이메일·다른 UID·비활성 선생님 연결을 거부한다", async () => {
  const account = { ...admin, teacherId: null };
  for (const [draft, options] of [
    [teacher, { createTeacher: true }],
    [{ ...teacher, email: "someone@example.invalid" }, {}],
    [{ ...teacher, authUid: "other" }, {}],
    [{ ...teacher, status: "inactive" }, {}]
  ]) {
    const store = operation("linkAdminTeacher", { "users/owner": account, "teachers/teacher-owner": draft });
    await assert.rejects(store.run(draft, options));
    assert.equal(store.committed(), false);
  }
});

test("이미 다른 급여가 연결됐거나 관리자 아닌 계정은 본인 관리자 급여 등록을 거부한다", async () => {
  for (const account of [{ ...admin, teacherId: "other" }, { ...admin, role: "teacher" }, { ...admin, status: "inactive" }]) {
    const store = operation("linkAdminTeacher", { "users/owner": account, "teachers/teacher-owner": teacher });
    await assert.rejects(store.run(teacher));
    assert.equal(store.committed(), false);
  }
});

test("이전 승인 요청으로 관리자를 연결해도 권한과 상태를 바꾸지 않는다", async () => {
  const store = operation("approveTeacherAccess", {
    "users/owner": { ...admin, teacherId: null, status: "inactive" },
    "teachers/teacher-owner": { ...teacher, authUid: null },
    "accessRequests/owner": { status: "pending", email: teacher.email }
  });
  await store.run({ uid: "owner", email: teacher.email }, teacher);
  assert.equal(store.database["users/owner"].role, "admin");
  assert.equal(store.database["users/owner"].status, "inactive");
  assert.equal(store.database["accessRequests/owner"].status, "approved");
});

test("일반 신규 승인과 이미 처리된 요청 차단은 유지한다", async () => {
  const store = operation("approveTeacherAccess", { "accessRequests/owner": { status: "pending", email: teacher.email } });
  await store.run({ uid: "owner", email: teacher.email }, teacher, { createTeacher: true });
  assert.equal(store.database["users/owner"].role, "teacher");
  assert.equal(store.database["teachers/teacher-owner"].authUid, "owner");
  const done = operation("approveTeacherAccess", store.database);
  await assert.rejects(done.run({ uid: "owner", email: teacher.email }, teacher), /이미 처리/);
});

test("본인 화면은 계정 role을 바꾸지 않고 화면 상태만 전환한다", () => {
  const start = app.indexOf("async function switchWorkspaceMode(");
  const switching = app.slice(start, app.indexOf("function setPage", start));
  assert.match(switching, /state\.workspaceMode = mode/);
  assert.doesNotMatch(switching, /state\.user\.role\s*=/);
  assert.match(switching, /restoreSession/);
  assert.match(app, /const teacherId = isTeacherWorkspace\(\) \? state\.user\.teacherId : state\.selectedTeacherId/);
  assert.match(app, /if \(isTeacherWorkspace\(\) && selectedDocument && run\.status === "published"\)/);
  assert.match(app, /if \(isTeacherWorkspace\(\)\) return null/);
});

test("규칙은 관리자 역할·상태를 보호하고 본인 선생님 연결을 검증한다", () => {
  assert.match(rules, /allow delete: if isAdmin\(\) && resource\.data\.role != 'admin'/);
  assert.match(rules, /request\.resource\.data\.role == 'admin'\s*&& request\.resource\.data\.status == resource\.data\.status/);
  const capability = rules.slice(rules.indexOf("function canSubmitOwnTeacherData"), rules.indexOf("function isOwnTeacher"));
  assert.match(capability, /account\(\)\.role in \['teacher', 'admin'\]/);
  assert.match(capability, /account\(\)\.get\('teacherId', null\) is string/);
  assert.match(capability, /\.data\.authUid == request\.auth\.uid/);
  assert.match(capability, /\.data\.status == 'active'/);
  for (const collection of ["expenseReceipts", "payslipReceipts"]) {
    const match = rules.slice(rules.indexOf(`match /${collection}/`));
    assert.match(match.slice(0, match.indexOf("allow update")), /allow create: if canSubmitOwnTeacherData\(\)/);
    assert.match(match, /request\.resource\.data\.teacherUid == request\.auth\.uid/);
    assert.match(match, /request\.resource\.data\.teacherId == account\(\)\.teacherId/);
  }
});

test("본인 명세서 화면에는 미발행 초안·취소본·다른 선생님을 표시하지 않는다", () => {
  const start = app.indexOf("function payrollForTeacher(");
  const end = app.indexOf("\nfunction ", start + 1);
  for (const payslips of [[], [{ id: "2026-09_teacher-owner", status: "cancelled" }]]) {
    const getPayroll = vm.runInNewContext(`${app.slice(start, end)}\npayrollForTeacher`, {
      isTeacherWorkspace: () => true,
      appConfig: { demoMode: false },
      state: { user: { teacherId: teacher.id }, data: { payslips } },
      payslipId: (month, id) => `${month}_${id}`
    });
    assert.equal(getPayroll(teacher.id, "2026-09"), null);
    assert.equal(getPayroll("other-teacher", "2026-09"), null);
  }
});
