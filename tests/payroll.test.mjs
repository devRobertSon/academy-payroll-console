import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateEmploymentIncomeTax,
  calculatePayroll,
  createMonthlyEarningLines,
  getMonthlyPayAmounts,
  getTeacherPaySettings,
  parseEmploymentTaxTableRows,
  resolveIncomeComposition,
  resolveEffectivePolicy,
  resolveRateRule,
  splitPayrollByIncome,
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

test("계약 요약은 근로소득·사업소득·혼합형을 명시적으로 구분한다", () => {
  const employee = getTeacherPaySettings({
    incomeComposition: "employee",
    defaultEmployeePay: 3000000,
    businessRates: [{ subjectName: "특강", hourlyRate: 70000 }]
  });
  const business = getTeacherPaySettings({
    incomeComposition: "business",
    defaultEmployeePay: 3000000,
    insuranceEnrolled: true,
    businessRates: [{ subjectName: "영어", hourlyRate: 45000 }]
  });
  const mixed = getTeacherPaySettings({
    incomeComposition: "mixed",
    defaultEmployeePay: 3000000,
    businessRates: [{ subjectName: "논술", hourlyRate: 70000 }]
  });

  assert.equal(employee.incomeComposition, "employee");
  assert.deepEqual(employee.businessRates, []);
  assert.equal(business.incomeComposition, "business");
  assert.equal(business.defaultEmployeePay, 0);
  assert.equal(business.insuranceEnrolled, false);
  assert.equal(mixed.defaultEmployeePay, 3000000);
  assert.equal(mixed.businessRates.length, 1);
});

test("기존 선생님 문서는 저장된 급여 조건으로 계약 유형을 자동 판별한다", () => {
  assert.equal(resolveIncomeComposition({ defaultEmployeePay: 3000000 }), "employee");
  assert.equal(resolveIncomeComposition({ businessRates: [{ subjectName: "영어", hourlyRate: 45000 }] }), "business");
  assert.equal(resolveIncomeComposition({ defaultEmployeePay: 3000000, businessRates: [{ subjectName: "특강", hourlyRate: 70000 }] }), "mixed");
  assert.equal(resolveIncomeComposition({ employmentType: "freelancer", baseMonthlyPay: 2500000 }), "business");
});

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

test("혼합 급여는 근로소득과 사업소득 명세서 두 개로 분리해도 합계가 일치한다", () => {
  const combined = calculatePayroll([
    { month: "2026-08", subjectName: "월 근로소득", hours: 1, hourlyRate: 3000000, treatment: "employee", insuranceCovered: false },
    { month: "2026-08", subjectName: "논술 특강", hours: 10, hourlyRate: 70000, treatment: "business", insuranceCovered: false },
    { month: "2026-08", subjectName: "교통비", hours: 1, hourlyRate: 50000, treatment: "exempt", insuranceCovered: false }
  ], demoPolicy, { employeeIncomeTax: 100000, employeeLocalTax: 10000, custom: 5000 });
  const documents = splitPayrollByIncome(combined, demoPolicy);

  assert.deepEqual(documents.map((item) => item.incomeType), ["employee", "business"]);
  assert.equal(documents[0].payroll.gross, 3050000);
  assert.equal(documents[1].payroll.gross, 700000);
  assert.equal(documents[1].payroll.deductions.businessIncomeTax, 21000);
  assert.equal(documents[1].payroll.deductions.businessLocalTax, 2100);
  assert.equal(documents.reduce((sum, item) => sum + item.payroll.gross, 0), combined.gross);
  assert.equal(documents.reduce((sum, item) => sum + item.payroll.totalDeductions, 0), combined.totalDeductions);
  assert.equal(documents.reduce((sum, item) => sum + item.payroll.net, 0), combined.net);
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

test("과목 구분이 없으면 기본 시급 하나로 수업시간과 3.3%를 계산한다", () => {
  const teacher = {
    id: "default-rate",
    incomeComposition: "business",
    defaultBusinessHourlyRate: 48000,
    usesSubjectRates: false,
    businessRates: []
  };
  const settings = getTeacherPaySettings(teacher);
  const lines = createMonthlyEarningLines(teacher, "2026-08", {
    businessWorkLines: [{ ...settings.businessRates[0], rateId: settings.businessRates[0].id, hours: 20 }]
  });
  const payroll = calculatePayroll(lines, demoPolicy);

  assert.equal(settings.businessRates.length, 1);
  assert.equal(settings.businessRates[0].subjectName, "일반 수업");
  assert.equal(lines[0].hourlyRate, 48000);
  assert.equal(payroll.grossByTreatment.business, 960000);
  assert.equal(payroll.deductions.businessIncomeTax, 28800);
  assert.equal(payroll.deductions.businessLocalTax, 2880);
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

  const insuredSettings = getTeacherPaySettings(insured);
  assert.equal(insuredSettings.insuranceEnrolled, true);
  assert.equal(insuredSettings.defaultEmployeePay, 3000000);
  assert.equal(insuredSettings.insuranceSettings.nationalPension.enrolled, true);
  const freelancerAmounts = getMonthlyPayAmounts(freelancer, { grossPay: 2000000 });
  assert.equal(freelancerAmounts.employeeGrossPay, 0);
  assert.equal(freelancerAmounts.businessGrossPay, 2000000);
  assert.equal(freelancerAmounts.source, "legacy-monthly-input");
});

test("국민연금·건강보험·고용보험은 선생님별 가입 기간과 서로 다른 신고 기준액을 적용한다", () => {
  const insuranceSettings = {
    nationalPension: { enrolled: true, defaultBaseAmount: 2000000, effectiveFrom: "2026-01-01" },
    healthInsurance: { enrolled: true, defaultBaseAmount: 3000000, effectiveFrom: "2026-01-01" },
    employmentInsurance: { enrolled: true, defaultBaseAmount: 4000000, effectiveFrom: "2026-01-01" }
  };
  const payroll = calculatePayroll([
    { month: "2026-08", hours: 1, hourlyRate: 3500000, treatment: "employee", insuranceCovered: true }
  ], createCombinedPolicy(ntsTaxPolicy2024, resolveEffectivePolicy(officialInsurancePolicies, "2026-08")), {
    insuranceSettings,
    employeeIncomeTax: 0,
    employeeLocalTax: 0
  });

  assert.deepEqual(payroll.insuranceBases, {
    nationalPension: 2000000,
    healthInsurance: 3000000,
    employmentInsurance: 4000000
  });
  assert.equal(payroll.deductions.nationalPension, 95000);
  assert.equal(payroll.deductions.healthInsurance, 107850);
  assert.equal(payroll.deductions.employmentInsurance, 36000);
  assert.equal(payroll.reporting.healthAndLongTermCare, payroll.deductions.healthInsurance + payroll.deductions.longTermCare);
});

test("보험 적용 종료일이 지난 달에는 해당 보험료를 자동 계산하지 않는다", () => {
  const payroll = calculatePayroll([
    { month: "2026-08", hours: 1, hourlyRate: 3000000, treatment: "employee", insuranceCovered: true }
  ], demoPolicy, {
    insuranceSettings: {
      nationalPension: { enrolled: true, defaultBaseAmount: 3000000, effectiveTo: "2026-07-31" },
      healthInsurance: { enrolled: false },
      employmentInsurance: { enrolled: false }
    },
    employeeIncomeTax: 0,
    employeeLocalTax: 0
  });

  assert.equal(payroll.deductions.nationalPension, 0);
  assert.equal(payroll.reporting.insuranceTotal, 0);
});

test("교통비·주차료·기타 지급을 선택한 과세 방식으로 계산하고 회계사용 항목을 분리한다", () => {
  const teacher = {
    id: "accounting",
    insuranceEnrolled: false,
    defaultEmployeePay: 0,
    businessRates: [],
    transportPolicy: { unitAmount: 1500, treatment: "business" }
  };
  const lines = createMonthlyEarningLines(teacher, "2026-08", {
    businessWorkLines: [{ subjectName: "영어", hourlyRate: 50000, hours: 2 }],
    transportTrips: 10,
    parkingAmount: 10000,
    parkingTreatment: "exempt",
    additionalEarnings: [{ id: "book", label: "교재 준비", amount: 20000, treatment: "business" }]
  });
  const payroll = calculatePayroll(lines, demoPolicy);

  assert.equal(payroll.gross, 145000);
  assert.equal(payroll.reporting.classHours, 2);
  assert.equal(payroll.reporting.transportTrips, 10);
  assert.equal(payroll.reporting.transportAmount, 15000);
  assert.equal(payroll.reporting.parkingAmount, 10000);
  assert.equal(payroll.reporting.lectureFeeGross, 100000);
  assert.equal(payroll.reporting.lectureWithholding, 3300);
  assert.equal(payroll.reporting.additionalPaymentWithholding, 1155);
  assert.equal(payroll.unconfirmedEarningLines.length, 0);
});

test("월 급여 입력 요약에서 교통비·주차비·기타 금액을 각각 제공한다", () => {
  const amounts = getMonthlyPayAmounts({
    defaultEmployeePay: 0,
    businessRates: [],
    transportPolicy: { unitAmount: 1500, treatment: "employee" }
  }, {
    transportTrips: 12,
    parkingAmount: 30000,
    additionalEarnings: [
      { id: "materials", label: "교재비", amount: 20000, treatment: "employee" },
      { id: "meal", label: "식비", amount: 10000, treatment: "employee" }
    ]
  });

  assert.equal(amounts.transportAmount, 18000);
  assert.equal(amounts.parkingAmount, 30000);
  assert.equal(amounts.otherPaymentAmount, 30000);
  assert.equal(amounts.additionalGrossPay, 78000);
});

test("처리 방법을 확인하지 않은 추가 지급은 확정 차단 대상으로 표시한다", () => {
  const lines = createMonthlyEarningLines({ id: "pending", businessRates: [] }, "2026-08", {
    parkingAmount: 20000,
    parkingTreatment: "pending"
  });
  const payroll = calculatePayroll(lines, demoPolicy);

  assert.equal(payroll.grossByTreatment.pending, 20000);
  assert.equal(payroll.totalDeductions, 0);
  assert.equal(payroll.unconfirmedEarningLines[0].subjectName, "주차료");
});

test("2026년 공식 사회보험 근로자 부담률을 적용한다", () => {
  const insurancePolicy = resolveEffectivePolicy(officialInsurancePolicies, "2026-08");
  const payroll = calculatePayroll([
    { hours: 1, hourlyRate: 2000000, treatment: "employee", insuranceCovered: true }
  ], createCombinedPolicy(ntsTaxPolicy2024, insurancePolicy));

  assert.equal(insurancePolicy.version, "INSURANCE-2026-07");
  assert.equal(payroll.deductions.nationalPension, 95000);
  assert.equal(payroll.deductions.healthInsurance, 71900);
  assert.equal(payroll.deductions.longTermCare, 9440);
  assert.equal(payroll.deductions.employmentInsurance, 18000);
});

test("공식 모의계산과 같이 자동 사회보험료의 10원 미만을 절사한다", () => {
  const insurancePolicy = resolveEffectivePolicy(officialInsurancePolicies, "2026-08");
  const payroll = calculatePayroll([
    { hours: 1, hourlyRate: 3200000, treatment: "employee", insuranceCovered: true }
  ], createCombinedPolicy(ntsTaxPolicy2024, insurancePolicy));

  assert.equal(payroll.deductions.nationalPension, 152000);
  assert.equal(payroll.deductions.healthInsurance, 115040);
  assert.equal(payroll.deductions.longTermCare, 15110);
  assert.equal(payroll.deductions.employmentInsurance, 28800);
  assert.equal(payroll.reporting.insuranceTotal, 310950);
  assert.ok([
    payroll.deductions.nationalPension,
    payroll.deductions.healthInsurance,
    payroll.deductions.longTermCare,
    payroll.deductions.employmentInsurance
  ].every((amount) => amount % 10 === 0));
});

test("국민연금은 기준소득월액의 천원 미만도 버린 뒤 계산한다", () => {
  const insurancePolicy = resolveEffectivePolicy(officialInsurancePolicies, "2026-08");
  const payroll = calculatePayroll([
    { hours: 1, hourlyRate: 2001999, treatment: "employee", insuranceCovered: true }
  ], createCombinedPolicy(ntsTaxPolicy2024, insurancePolicy));

  assert.equal(payroll.insuranceBases.nationalPension, 2001999);
  assert.equal(payroll.deductions.nationalPension, 95040);
});

test("2026년 7월 국민연금 상한과 건강보험료 상한을 적용한다", () => {
  const january = resolveEffectivePolicy(officialInsurancePolicies, "2026-06");
  const july = resolveEffectivePolicy(officialInsurancePolicies, "2026-07");
  const payroll = calculatePayroll([
    { hours: 1, hourlyRate: 200000000, treatment: "employee", insuranceCovered: true }
  ], createCombinedPolicy(ntsTaxPolicy2024, july));

  assert.equal(january.version, "INSURANCE-2026-01");
  assert.equal(july.version, "INSURANCE-2026-07");
  assert.equal(payroll.deductions.nationalPension, 313020);
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

test("회계사 고지액은 건강보험과 장기요양 합계로 한 번에 입력할 수 있다", () => {
  const payroll = calculatePayroll([
    { month: "2026-08", hours: 1, hourlyRate: 3000000, treatment: "employee", insuranceCovered: true }
  ], demoPolicy, {
    healthAndLongTermCare: 123456,
    employeeIncomeTax: 0,
    employeeLocalTax: 0
  });

  assert.equal(payroll.deductions.healthInsurance, 123456);
  assert.equal(payroll.deductions.longTermCare, 0);
  assert.equal(payroll.reporting.healthAndLongTermCare, 123456);
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

