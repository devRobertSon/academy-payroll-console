import test from "node:test";
import assert from "node:assert/strict";
import {
  artifactRevision,
  currentArtifactForRevision,
  matchingTeachersForAccessRequest,
  nextPayrollRevision,
  payslipId,
  payslipVersionId,
  provisionalTeacherForAccessRequest,
  teacherDeletionBlockers,
  teacherDeletionCleanupReferences,
  validateTeacherAccessApproval,
  validateTeacherDeletion
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

test("선생님 삭제는 등록 이메일 확인이 일치해야 한다", () => {
  assert.equal(validateTeacherDeletion(teacher, " Teacher@Example.com ", {}), true);
  assert.throws(
    () => validateTeacherDeletion(teacher, "other@example.com", {}),
    /Google 이메일을 정확히 입력/
  );
});

test("수업시간과 미확정 급여 기록만 있으면 삭제할 수 있다", () => {
  const workspaceData = {
    monthlyWorkInputs: {
      "2026-08:teacher-1": { id: "2026-08_teacher-1", teacherId: "teacher-1", month: "2026-08" }
    },
    overrides: {
      "2026-08:teacher-1": { id: "2026-08_teacher-1", teacherId: "teacher-1", month: "2026-08" }
    },
    adminNotifications: [
      { id: "work-hours_2026-08_teacher-1", teacherId: "teacher-1", month: "2026-08" }
    ],
    payrollRuns: [{ month: "2026-08", status: "draft" }]
  };

  assert.deepEqual(teacherDeletionBlockers(workspaceData, "teacher-1"), []);
  assert.deepEqual(teacherDeletionCleanupReferences(workspaceData, "teacher-1"), [
    { key: "monthlyWorkInputs", collection: "teacherMonthlyInputs", id: "2026-08_teacher-1" },
    { key: "overrides", collection: "payrollOverrides", id: "2026-08_teacher-1" },
    { key: "adminNotifications", collection: "adminNotifications", id: "work-hours_2026-08_teacher-1" }
  ]);
  assert.equal(validateTeacherDeletion(teacher, teacher.email, workspaceData), true);
});

test("확정 급여와 명세서 기록이 있는 선생님은 삭제하지 않고 비활성화한다", () => {
  const workspaceData = {
    monthlyWorkInputs: {
      "2026-08:teacher-1": { id: "2026-08_teacher-1", teacherId: "teacher-1", month: "2026-08" },
      "2026-07:teacher-1": { id: "2026-07_teacher-1", teacherId: "teacher-1", month: "2026-07" }
    },
    payrollRuns: [
      { month: "2026-08", status: "published" },
      { month: "2026-07", status: "cancelled" }
    ],
    payslips: [{ teacherId: "teacher-1", month: "2026-07", status: "published" }],
    payslipVersions: [{ teacherId: "teacher-1", month: "2026-07", revision: 1 }]
  };

  assert.deepEqual(teacherDeletionBlockers(workspaceData, "teacher-1"), [
    { key: "approvedPayrolls", label: "확정 급여", count: 2 },
    { key: "payslips", label: "현재 급여명세서", count: 1 },
    { key: "payslipVersions", label: "급여명세서 발행 이력", count: 1 }
  ]);
  assert.throws(
    () => validateTeacherDeletion(teacher, teacher.email, workspaceData),
    /계정을 비활성화/
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

test("미등록 승인 요청은 자기정보 입력 전용 임시 선생님으로 만들 수 있다", () => {
  const provisional = provisionalTeacherForAccessRequest({
    ...request,
    displayName: "신규 강사"
  });

  assert.equal(provisional.id, "teacher-auth-uid-1");
  assert.equal(provisional.email, "teacher@example.com");
  assert.equal(provisional.profileCompleted, false);
  assert.deepEqual(provisional.businessRates, []);
  assert.equal(validateTeacherAccessApproval(request, provisional), true);
});

test("임시 선생님 이름에서 숫자와 기호를 제거한다", () => {
  const provisional = provisionalTeacherForAccessRequest({
    ...request,
    displayName: "Teacher 123!"
  });

  assert.equal(provisional.name, "Teacher");
});
