import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateEmploymentIncomeTax,
  calculatePayroll,
  createMonthlyEarningLines,
  getMonthlyPayAmounts,
  getTeacherPaySettings,
  parseEmploymentTaxTableRows,
  resolveEffectivePolicy,
  resolveRateRule,
  summarizePayroll
} from "../src/lib/payroll.js";
import { demoPolicy } from "../src/data/demo-data.js";
import {
  createCombinedPolicy,
  NTS_SOURCE_URLS,
  ntsTaxPolicy2024,
  officialInsurancePolicies
} from "../src/data/nts-tax-policy.js";
import { csvRowsToObjects, parseCsv } from "../src/lib/csv.js";

test("간이세액표 공식 근거는 파일이 아닌 웹 열람 페이지로 연결한다", () => {
  const url = new URL(NTS_SOURCE_URLS.employmentTable);

  assert.equal(url.hostname, "www.law.go.kr");
  assert.equal(url.pathname, "/lsBylInfoPLinkR.do");
  assert.notEqual(url.pathname, "/flDownload.do");
});

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

test("4대보험 가입자는 수업이 없어도 선생님 기본 월급으로 계산한다", () => {
  const teacher = { id: "t1", insuranceEnrolled: true, defaultEmployeePay: 3000000, defaultBusinessPay: 0 };
  const lines = createMonthlyEarningLines(teacher, "2026-08");
  const payroll = calculatePayroll(lines, demoPolicy, { employeeIncomeTax: 0, employeeLocalTax: 0 });

  assert.equal(lines[0].subjectName, "월 근로소득");
  assert.equal(lines[0].treatment, "employee");
  assert.equal(lines[0].insuranceCovered, true);
  assert.equal(payroll.gross, 3000000);
  assert.equal(payroll.insuredBase, 3000000);
});

test("4대보험 가입 선생님에게 근로소득과 사업소득을 함께 계산한다", () => {
  const teacher = { id: "mixed", insuranceEnrolled: true, defaultEmployeePay: 3000000, businessRates: [{ id: "essay", subjectName: "논술 특강", hourlyRate: 70000 }] };
  const lines = createMonthlyEarningLines(teacher, "2026-08", {
    businessWorkLines: [{ rateId: "essay", subjectName: "논술 특강", hourlyRate: 70000, hours: 10 }]
  });
  const payroll = calculatePayroll(lines, demoPolicy, { employeeIncomeTax: 0, employeeLocalTax: 0 });

  assert.equal(lines.length, 2);
  assert.equal(payroll.grossByTreatment.employee, 3000000);
  assert.equal(payroll.grossByTreatment.business, 700000);
  assert.equal(payroll.insuredBase, 3000000);
  assert.equal(payroll.deductions.businessIncomeTax, 21000);
  assert.equal(lines[1].hours, 10);
  assert.equal(lines[1].hourlyRate, 70000);
});

test("사업소득만 받는 선생님은 4대보험 없이 사업소득으로 계산한다", () => {
  const teacher = { id: "t2", insuranceEnrolled: false, defaultEmployeePay: 0, businessRates: [{ id: "english", subjectName: "중등 영어", hourlyRate: 45000 }] };
  const lines = createMonthlyEarningLines(teacher, "2026-08", {
    employeeGrossPay: 0,
    businessWorkLines: [{ rateId: "english", subjectName: "중등 영어", hourlyRate: 45000, hours: 40 }]
  });
  const payroll = calculatePayroll(lines, demoPolicy);

  assert.equal(lines[0].subjectName, "중등 영어");
  assert.equal(lines[0].treatment, "business");
  assert.equal(lines[0].insuranceCovered, false);
  assert.equal(payroll.grossByTreatment.business, 1800000);
  assert.equal(payroll.insuredBase, 0);
  assert.equal(payroll.deductions.businessIncomeTax, 54000);
});

test("근로소득과 사업소득을 모두 0원으로 지정하면 해당 월 계산 대상에서 제외한다", () => {
  const teacher = { id: "t3", insuranceEnrolled: true, defaultEmployeePay: 3000000, businessRates: [{ id: "math", subjectName: "수학", hourlyRate: 50000 }] };
  assert.deepEqual(createMonthlyEarningLines(teacher, "2026-08", {
    employeeGrossPay: 0,
    businessWorkLines: [{ rateId: "math", subjectName: "수학", hourlyRate: 50000, hours: 0 }]
  }), []);
});

test("사업소득은 과목별 시급과 수업 시수를 곱해 합산하고 3.3%를 공제한다", () => {
  const teacher = { id: "subjects", insuranceEnrolled: false, defaultEmployeePay: 0, businessRates: [] };
  const lines = createMonthlyEarningLines(teacher, "2026-08", {
    businessWorkLines: [
      { subjectName: "중등 수학", hourlyRate: 50000, hours: 10 },
      { subjectName: "고등 수학", hourlyRate: 70000, hours: 2 }
    ]
  });
  const payroll = calculatePayroll(lines, demoPolicy);

  assert.equal(lines.length, 2);
  assert.equal(payroll.grossByTreatment.business, 640000);
  assert.equal(payroll.deductions.businessIncomeTax, 19200);
  assert.equal(payroll.deductions.businessLocalTax, 1920);
  assert.equal(payroll.net, 618880);
});

test("기존 유형과 월 지급액 필드는 새 급여 구성으로 호환해 읽는다", () => {
  const insured = { id: "legacy-insured", employmentType: "insured", baseMonthlyPay: 3000000 };
  const freelancer = { id: "legacy-freelancer", employmentType: "freelancer", baseMonthlyPay: 1800000 };

  assert.deepEqual(getTeacherPaySettings(insured), {
    insuranceEnrolled: true,
    defaultEmployeePay: 3000000,
    defaultBusinessPay: 0,
    businessRates: [],
    source: "legacy"
  });
  assert.deepEqual(getMonthlyPayAmounts(freelancer, { grossPay: 2000000 }), {
    employeeGrossPay: 0,
    businessGrossPay: 2000000,
    businessHours: 0,
    businessWorkLines: [],
    source: "legacy-monthly-input"
  });
});

test("2026년 공식 사회보험 근로자 부담률을 적용한다", () => {
  const insurancePolicy = resolveEffectivePolicy(officialInsurancePolicies, "2026-08");
  const payroll = calculatePayroll([
    { hours: 1, hourlyRate: 2000000, treatment: "employee", insuranceCovered: true }
  ], createCombinedPolicy(ntsTaxPolicy2024, insurancePolicy));

  assert.equal(insurancePolicy.version, "INSURANCE-2026-07");
  assert.equal(payroll.deductions.nationalPension, 95000);
  assert.equal(payroll.deductions.healthInsurance, 71900);
  assert.equal(payroll.deductions.longTermCare, 9448);
  assert.equal(payroll.deductions.employmentInsurance, 18000);
});

test("2026년 7월 국민연금 상한과 건강보험료 상한을 적용한다", () => {
  const january = resolveEffectivePolicy(officialInsurancePolicies, "2026-06");
  const july = resolveEffectivePolicy(officialInsurancePolicies, "2026-07");
  const payroll = calculatePayroll([
    { hours: 1, hourlyRate: 200000000, treatment: "employee", insuranceCovered: true }
  ], createCombinedPolicy(ntsTaxPolicy2024, july));

  assert.equal(january.version, "INSURANCE-2026-01");
  assert.equal(july.version, "INSURANCE-2026-07");
  assert.equal(payroll.deductions.nationalPension, 313025);
  assert.equal(payroll.deductions.healthInsurance, 4591740);
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
