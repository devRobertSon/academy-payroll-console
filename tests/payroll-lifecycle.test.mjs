import test from "node:test";
import assert from "node:assert/strict";
import {
  artifactRevision,
  currentArtifactForRevision,
  matchingTeachersForAccessRequest,
  nextPayrollRevision,
  payslipId,
  payslipVersionId,
  validateTeacherAccessApproval
} from "../src/lib/payroll-lifecycle.js";

const request = {
  uid: "auth-uid-1",
  email: "Teacher@Example.com",
  status: "pending"
};

const teacher = {
  id: "teacher-1",
  email: "teacher@example.com",
  status: "active",
  authUid: null
};

test("접근 요청은 같은 이메일의 활성 미연결 선생님만 승인 후보가 된다", () => {
  const teachers = [
    teacher,
    { ...teacher, id: "inactive", status: "inactive" },
    { ...teacher, id: "linked", authUid: "other-uid" },
    { ...teacher, id: "different", email: "other@example.com" }
  ];

  assert.deepEqual(matchingTeachersForAccessRequest(request, teachers).map((item) => item.id), ["teacher-1"]);
  assert.equal(validateTeacherAccessApproval(request, teacher), true);
});

test("이메일이 다른 Google 계정 연결은 거부한다", () => {
  assert.throws(
    () => validateTeacherAccessApproval(request, { ...teacher, email: "other@example.com" }),
    /이메일이 일치하지 않습니다/
  );
});

test("최초 발행은 1차이고 취소 후 재발행은 다음 차수다", () => {
  assert.equal(nextPayrollRevision({ status: "draft" }), 1);
  assert.equal(nextPayrollRevision({ status: "cancelled", revision: 1 }), 2);
  assert.equal(nextPayrollRevision({ status: "cancelled", revision: 4 }), 5);
});

test("현재 차수의 열람·발송 이력만 선택한다", () => {
  const items = [
    { teacherId: "teacher-1", month: "2026-08", revision: 1, viewedAt: "2026-08-10T00:00:00Z" },
    { teacherId: "teacher-1", month: "2026-08", revision: 2, viewedAt: "2026-08-11T00:00:00Z" },
    { teacherId: "teacher-1", month: "2026-08", revision: 2, viewedAt: "2026-08-12T00:00:00Z" }
  ];

  assert.equal(artifactRevision({}), 1);
  assert.equal(currentArtifactForRevision(items, "teacher-1", "2026-08", 2).viewedAt, "2026-08-12T00:00:00Z");
});

test("현재 명세서와 불변 버전 문서 ID를 구분한다", () => {
  assert.equal(payslipId("2026-08", "teacher-1"), "2026-08_teacher-1");
  assert.equal(payslipId("2026-08", "teacher-1", "employee"), "2026-08_teacher-1_employee");
  assert.equal(payslipId("2026-08", "teacher-1", "business"), "2026-08_teacher-1_business");
  assert.equal(payslipVersionId("2026-08", "teacher-1", 3), "2026-08_teacher-1_v3");
  assert.equal(payslipVersionId("2026-08", "teacher-1", 3, "employee"), "2026-08_teacher-1_employee_v3");
  assert.equal(payslipVersionId("2026-08", "teacher-1", 3, "business"), "2026-08_teacher-1_business_v3");
});
