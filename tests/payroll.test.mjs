import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateEmploymentIncomeTax,
  calculatePayroll,
  parseEmploymentTaxTableRows,
  resolveEffectivePolicy,
  resolveRateRule,
  summarizePayroll
} from "../src/lib/payroll.js";
import { demoPolicy } from "../src/data/demo-data.js";
import { ntsTaxPolicy2024 } from "../src/data/nts-tax-policy.js";
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

test("국세청 간이세액표 공식 예시와 자녀 공제를 적용한다", () => {
  const profile = { dependentCount: 4, children8To20: 2, withholdingRatio: 1 };
  const tax = calculateEmploymentIncomeTax(3500000, ntsTaxPolicy2024.employment, profile);
  assert.equal(tax, 20180);
  assert.equal(calculateEmploymentIncomeTax(3500000, ntsTaxPolicy2024.employment, { ...profile, withholdingRatio: 0.8 }), 16140);
  assert.equal(calculateEmploymentIncomeTax(3500000, ntsTaxPolicy2024.employment, { ...profile, withholdingRatio: 1.2 }), 24210);
  const payroll = calculatePayroll([
    { hours: 1, hourlyRate: 3500000, treatment: "employee", insuranceCovered: false }
  ], demoPolicy, {}, profile);
  assert.equal(payroll.deductions.employeeIncomeTax, 20180);
  assert.equal(payroll.deductions.employeeLocalTax, 2018);
});

test("월 1천만원 초과 근로소득은 별표 2 고액 급여 산식을 적용한다", () => {
  const tax = calculateEmploymentIncomeTax(14000000, ntsTaxPolicy2024.employment, {
    dependentCount: 1,
    children8To20: 0,
    withholdingRatio: 1
  });
  assert.equal(tax, 2904400);
});

test("사업소득은 소득세 3%와 그 세액의 10%인 지방소득세를 계산한다", () => {
  const payroll = calculatePayroll([
    { hours: 1, hourlyRate: 1000000, treatment: "business", insuranceCovered: false }
  ], demoPolicy);
  assert.equal(payroll.deductions.businessIncomeTax, 30000);
  assert.equal(payroll.deductions.businessLocalTax, 3000);
});

test("일시적 강의 기타소득은 필요경비와 건별 과세최저한을 적용한다", () => {
  const threshold = calculatePayroll([
    { hours: 1, hourlyRate: 125000, treatment: "other", otherIncomeCategory: "temporaryLecture" }
  ], demoPolicy);
  assert.equal(threshold.otherIncomeTaxableAmount, 50000);
  assert.equal(threshold.deductions.otherIncomeTax, 0);
  assert.equal(threshold.deductions.otherLocalTax, 0);

  const taxable = calculatePayroll([
    { hours: 1, hourlyRate: 200000, treatment: "other", otherIncomeCategory: "temporaryLecture" }
  ], demoPolicy);
  assert.equal(taxable.otherIncomeTaxableAmount, 80000);
  assert.equal(taxable.deductions.otherIncomeTax, 16000);
  assert.equal(taxable.deductions.otherLocalTax, 1600);
});

test("기타소득 과세최저한은 관리자가 지정한 지급 건별로 계산한다", () => {
  const combined = calculatePayroll([
    { hours: 1, hourlyRate: 70000, treatment: "other", otherPaymentGroup: "same" },
    { hours: 1, hourlyRate: 70000, treatment: "other", otherPaymentGroup: "same" }
  ], demoPolicy);
  const separate = calculatePayroll([
    { hours: 1, hourlyRate: 70000, treatment: "other", otherPaymentGroup: "first" },
    { hours: 1, hourlyRate: 70000, treatment: "other", otherPaymentGroup: "second" }
  ], demoPolicy);
  assert.equal(combined.deductions.otherIncomeTax, 11200);
  assert.equal(separate.deductions.otherIncomeTax, 0);
});

test("시행일이 가장 최근인 유효 세금 정책을 선택한다", () => {
  const policies = [
    { version: "old", effectiveFrom: "2024-01-01" },
    { version: "new", effectiveFrom: "2026-01-01" }
  ];
  assert.equal(resolveEffectivePolicy(policies, "2025-12").version, "old");
  assert.equal(resolveEffectivePolicy(policies, "2026-08").version, "new");
});

test("간이세액표 CSV는 연속 구간과 1천만원 기준 행을 검증한다", () => {
  const taxColumns = Object.fromEntries(Array.from({ length: 11 }, (_, index) => [`dependent${index + 1}`, String(index)]));
  const parsed = parseEmploymentTaxTableRows([
    { minMonthlyPay: "0", maxMonthlyPay: "10000000", ...taxColumns },
    { minMonthlyPay: "10000000", maxMonthlyPay: "10000000", ...taxColumns }
  ]);
  assert.equal(parsed.tableRows.length, 1);
  assert.equal(parsed.taxAtTenMillion[10], 10);
});
