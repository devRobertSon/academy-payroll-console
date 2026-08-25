import test from "node:test";
import assert from "node:assert/strict";
import {
  buildBusinessHours,
  businessHoursFromWorkLines,
  mergeMonthlyWorkInput,
  monthlyWorkInputId,
  normalizeMonthlyHours
} from "../src/lib/teacher-self-service.js";

const rates = [
  { id: "math", subjectName: "수학", hourlyRate: 50000 },
  { id: "essay", subjectName: "논술", hourlyRate: 70000 }
];

test("월별 수업시간 문서 ID와 허용 시수를 정규화한다", () => {
  assert.equal(monthlyWorkInputId("2026-08", "teacher-01"), "2026-08_teacher-01");
  assert.equal(normalizeMonthlyHours(-1), 0);
  assert.equal(normalizeMonthlyHours("12.5"), 12.5);
  assert.equal(normalizeMonthlyHours(900), 744);
});

test("관리자가 등록한 시급에는 선생님 입력 시수만 결합한다", () => {
  const merged = mergeMonthlyWorkInput(rates, {
    employeeGrossPay: 3000000,
    transportTrips: 20,
    businessWorkLines: [
      { rateId: "math", subjectName: "변조 과목", hourlyRate: 1, hours: 99 },
      { id: "admin-special", subjectName: "관리자 추가 지급", hourlyRate: 100000, hours: 1 }
    ]
  }, {
    employeeWorkHours: 40,
    businessHours: { math: 10, essay: 2, unknown: 500 }
  });

  assert.equal(merged.employeeGrossPay, 3000000);
  assert.equal(merged.transportTrips, 20);
  assert.deepEqual(merged.businessWorkLines.slice(0, 2), [
    { ...rates[0], rateId: "math", hours: 10 },
    { ...rates[1], rateId: "essay", hours: 2 }
  ]);
  assert.equal(merged.businessWorkLines[2].id, "admin-special");
});

test("사업소득 시간 객체는 등록된 과목 ID만 저장한다", () => {
  assert.deepEqual(buildBusinessHours(rates, { math: 5, essay: 3, unknown: 100 }), { math: 5, essay: 3 });
  assert.deepEqual(businessHoursFromWorkLines(rates, [{ rateId: "math", hours: 8 }]), { math: 8, essay: 0 });
});

