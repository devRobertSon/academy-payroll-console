import test from "node:test";
import assert from "node:assert/strict";
import { calculatePayroll, resolveRateRule, summarizePayroll } from "../src/lib/payroll.js";
import { demoPolicy } from "../src/data/demo-data.js";
import { csvRowsToObjects, parseCsv } from "../src/lib/csv.js";

test("한 선생님의 근로소득과 사업소득을 분리 계산한 뒤 합산한다", () => {
  const payroll = calculatePayroll([
    { hours: 10, hourlyRate: 50000, treatment: "employee", insuranceCovered: true },
    { hours: 2, hourlyRate: 70000, treatment: "business", insuranceCovered: false }
  ], demoPolicy, { employeeIncomeTax: 10000 });

  assert.equal(payroll.grossByTreatment.employee, 500000);
  assert.equal(payroll.grossByTreatment.business, 140000);
  assert.equal(payroll.insuredBase, 500000);
  assert.equal(payroll.deductions.businessIncomeTax, 4200);
  assert.equal(payroll.deductions.businessLocalTax, 420);
  assert.equal(payroll.gross, 640000);
  assert.equal(payroll.net, payroll.gross - payroll.totalDeductions);
});

test("보험 미적용 근로소득은 보험 기준액에 포함하지 않는다", () => {
  const payroll = calculatePayroll([
    { hours: 10, hourlyRate: 40000, treatment: "employee", insuranceCovered: false }
  ], demoPolicy);

  assert.equal(payroll.insuredBase, 0);
  assert.equal(payroll.deductions.nationalPension, 0);
  assert.equal(payroll.deductions.healthInsurance, 0);
  assert.equal(payroll.deductions.employmentInsurance, 0);
});

test("관리자가 입력한 공제액으로 자동 계산값을 덮어쓸 수 있다", () => {
  const payroll = calculatePayroll([
    { hours: 10, hourlyRate: 40000, treatment: "employee", insuranceCovered: true }
  ], demoPolicy, {
    nationalPension: 12345,
    healthInsurance: 23456,
    longTermCare: 3456,
    employmentInsurance: 4567,
    employeeIncomeTax: 5000,
    employeeLocalTax: 500
  });

  assert.equal(payroll.deductions.nationalPension, 12345);
  assert.equal(payroll.deductions.healthInsurance, 23456);
  assert.equal(payroll.deductions.longTermCare, 3456);
  assert.equal(payroll.deductions.employeeLocalTax, 500);
});

test("과목과 반까지 지정된 가장 구체적인 시급 규칙을 선택한다", () => {
  const rules = [
    { teacherId: "t1", hourlyRate: 30000, effectiveFrom: "2026-01-01" },
    { teacherId: "t1", subjectId: "math", hourlyRate: 40000, effectiveFrom: "2026-01-01" },
    { teacherId: "t1", subjectId: "math", classId: "advanced", hourlyRate: 50000, effectiveFrom: "2026-01-01" }
  ];
  const selected = resolveRateRule(rules, { teacherId: "t1", subjectId: "math", classId: "advanced", workedOn: "2026-08-01" });
  assert.equal(selected.hourlyRate, 50000);
});

test("여러 명의 월 급여 합계를 계산한다", () => {
  const first = calculatePayroll([{ hours: 2, hourlyRate: 50000, treatment: "exempt" }], demoPolicy);
  const second = calculatePayroll([{ hours: 3, hourlyRate: 50000, treatment: "exempt" }], demoPolicy);
  assert.deepEqual(summarizePayroll([first, second]), { gross: 250000, deductions: 0, net: 250000, insuredBase: 0 });
});

test("쉼표와 따옴표가 있는 CSV 수업명을 안전하게 읽는다", () => {
  const rows = parseCsv('workedOn,teacherId,subjectName,hours\r\n2026-08-01,t1,"수학, 심화",2\r\n');
  const objects = csvRowsToObjects(rows);
  assert.equal(objects[0].subjectName, "수학, 심화");
  assert.equal(objects[0].hours, "2");
});
