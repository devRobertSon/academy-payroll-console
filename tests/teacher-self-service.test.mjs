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
  { id: "rate-a", hourlyRate: 50000 },
  { id: "rate-b", hourlyRate: 70000 }
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
      { rateId: "rate-a", hourlyRate: 1, hours: 99 },
      { id: "admin-special", hourlyRate: 100000, hours: 1 }
    ]
  }, {
    employeeWorkHours: 40,
    businessHours: { "rate-a": 10, "rate-b": 2, unknown: 500 }
  });

  assert.equal(merged.employeeGrossPay, 3000000);
  assert.equal(merged.transportTrips, 20);
  assert.deepEqual(merged.businessWorkLines.slice(0, 2), [
    { ...rates[0], rateId: "rate-a", hours: 10 },
    { ...rates[1], rateId: "rate-b", hours: 2 }
  ]);
  assert.equal(merged.businessWorkLines[2].id, "admin-special");
});

test("사업소득 시간 객체는 등록된 시급 항목 ID만 저장한다", () => {
  assert.deepEqual(buildBusinessHours(rates, { "rate-a": 5, "rate-b": 3, unknown: 100 }), { "rate-a": 5, "rate-b": 3 });
  assert.deepEqual(businessHoursFromWorkLines(rates, [{ rateId: "rate-a", hours: 8 }]), { "rate-a": 8, "rate-b": 0 });
});

