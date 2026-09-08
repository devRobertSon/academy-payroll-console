import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateTuitionShare, calculatePayroll, createMonthlyEarningLines,
  getMonthlyPayAmounts, getTeacherPaySettings, splitPayrollByIncome, normalizeTuitionGroups, tuitionBasis
} from "../src/lib/payroll.js";
import { buildBusinessHours, mergeMonthlyWorkInput } from "../src/lib/teacher-self-service.js";
import { demoPolicy } from "../src/data/demo-data.js";

const rate = { id: "share", tuitionShareRate: 40 };
const teacher = { id: "share-teacher", incomeComposition: "business", businessRates: [rate] };
const override = { businessWorkLines: [{ ...rate, rateId: rate.id, tuitionAmount: 5000000 }] };

test("비율제 계약을 정규화하고 월 학원비 500만 원의 40%를 계산한다", () => {
  assert.deepEqual(getTeacherPaySettings(teacher).businessRates, [rate]);
  const amounts = getMonthlyPayAmounts(teacher, override);
  assert.equal(amounts.businessGrossPay, 2000000);
  assert.equal(amounts.businessHours, 0);
  assert.equal(amounts.totalGrossPay, 2000000);
  assert.equal(getMonthlyPayAmounts(teacher).businessGrossPay, 0);
  assert.equal(calculateTuitionShare(0, 40), 0);
  assert.equal(calculateTuitionShare(10000000000, 100), 10000000000);
});

test("비율은 소수점 둘째 자리까지, 결과는 원 단위 반올림한다", () => {
  assert.equal(calculateTuitionShare(1000001, 33.33), 333300);
  assert.equal(calculateTuitionShare(5, 50), 3);
  assert.equal(calculateTuitionShare(1000000, 0.01), 100);
  assert.equal(calculateTuitionShare(1000000, 57.99), 579900);
});

test("비율 및 학원비의 음수·범위 초과·비정상 입력은 거부한다", () => {
  assert.throws(() => getTeacherPaySettings({ ...teacher, businessRates: [rate, { id: "second-share", tuitionShareRate: 20 }] }));
  for (const percentage of [0, -1, 100.01, 33.333, NaN, Infinity, "bad"]) {
    assert.throws(() => calculateTuitionShare(5000000, percentage));
    assert.throws(() => getTeacherPaySettings({ ...teacher, businessRates: [{ id: "bad", tuitionShareRate: percentage }] }));
  }
  for (const amount of [-1, 10000000001, 0.5, Infinity, NaN, "bad"]) {
    assert.throws(() => calculateTuitionShare(amount, 40));
  }
});

test("비율제 강사료의 원천징수·명세서 분리·산정 근거를 보존한다", () => {
  const entries = createMonthlyEarningLines(teacher, "2026-09", override);
  assert.equal(entries[0].kind, "tuition-share-business");
  assert.equal(entries[0].tuitionAmount, 5000000);
  assert.equal(entries[0].tuitionShareRate, 40);
  assert.equal(entries[0].hours, 0);
  assert.equal("hourlyRate" in entries[0], false);
  const payroll = calculatePayroll(entries, demoPolicy);
  assert.equal(payroll.gross, 2000000);
  assert.equal(payroll.totalDeductions, 66000);
  assert.equal(payroll.net, 1934000);
  assert.equal(payroll.reporting.classHours, 0);
  assert.equal(payroll.reporting.lectureFeeGross, 2000000);
  const [document] = splitPayrollByIncome(payroll, demoPolicy);
  assert.equal(document.incomeType, "business");
  assert.equal(document.payroll.earningLines[0].tuitionShareRate, 40);
  assert.equal(document.payroll.gross, 2000000);
  // A saved calculation must not depend on the subsequently changed contract.
  const saved = JSON.parse(JSON.stringify(payroll));
  getMonthlyPayAmounts({ ...teacher, businessRates: [{ ...rate, tuitionShareRate: 50 }] });
  assert.deepEqual(saved, payroll);
  assert.equal(calculatePayroll(saved.earningLines, demoPolicy).gross, 2000000);
});

test("혼합형의 근로소득 월급과 비율제 사업소득은 별도 명세서로 계산한다", () => {
  const mixed = { ...teacher, incomeComposition: "mixed", defaultEmployeePay: 3000000 };
  const payroll = calculatePayroll(createMonthlyEarningLines(mixed, "2026-09", override), demoPolicy);
  const documents = splitPayrollByIncome(payroll, demoPolicy);
  assert.equal(payroll.gross, 5000000);
  assert.equal(documents.find((item) => item.incomeType === "employee").payroll.gross, 3000000);
  assert.equal(documents.find((item) => item.incomeType === "business").payroll.gross, 2000000);
});

test("선생님의 시수 제출은 관리자 학원비와 해당 월 약정 비율을 덮어쓰지 않는다", () => {
  assert.deepEqual(buildBusinessHours([rate], { share: 700 }), {});
  const merged = mergeMonthlyWorkInput([{ ...rate, tuitionShareRate: 50 }], override, {
    employeeWorkHours: 0, businessHours: { share: 700 }, tuitionAmount: 99999999, tuitionShareRate: 100
  });
  assert.equal(merged.businessWorkLines[0].tuitionAmount, 5000000);
  assert.equal(merged.businessWorkLines[0].tuitionShareRate, 40);
  assert.equal(getMonthlyPayAmounts(teacher, merged).businessGrossPay, 2000000);
  assert.deepEqual(override.businessWorkLines[0], { ...rate, rateId: rate.id, tuitionAmount: 5000000 });
  const empty = mergeMonthlyWorkInput([rate], {}, { businessHours: { share: 100 }, tuitionAmount: 999999 });
  assert.equal(getMonthlyPayAmounts(teacher, empty).businessGrossPay, 0);
});

test("시급제와 비율제 전환 시 이전 방식의 계약 항목을 중복 합산하지 않는다", () => {
  const hourly = { id: "hourly", hourlyRate: 50000 };
  const oldHourly = { businessWorkLines: [{ ...hourly, rateId: hourly.id, hours: 20 }] };
  const mergedShare = mergeMonthlyWorkInput([rate], oldHourly, { businessHours: { hourly: 20 } });
  assert.equal(getMonthlyPayAmounts(teacher, mergedShare).businessGrossPay, 0);
  assert.equal(getMonthlyPayAmounts(teacher, oldHourly).businessGrossPay, 0);
  const hourlyTeacher = { ...teacher, businessRates: [hourly] };
  const mergedHourly = mergeMonthlyWorkInput([hourly], override, { businessHours: { hourly: 20 } });
  assert.equal(getMonthlyPayAmounts(hourlyTeacher, mergedHourly).businessGrossPay, 1000000);
  assert.equal(override.businessWorkLines[0].tuitionAmount, 5000000);
});

test("관리자가 명시적으로 추가한 월별 수당 시급은 비율제와 함께 계산한다", () => {
  const additional = { id: "extra", hourlyRate: 50000, hours: 2 };
  const merged = mergeMonthlyWorkInput([rate], { businessWorkLines: [...override.businessWorkLines, additional] }, { businessHours: {} });
  const amounts = getMonthlyPayAmounts(teacher, merged);
  assert.equal(amounts.businessGrossPay, 2100000);
  assert.equal(amounts.businessHours, 2);
});

test("비율과 등록된 여러 시급을 합산하고 실제 시급 수업시간만 집계한다", () => {
  const hourly = { id: "hourly", hourlyRate: 50000 };
  const secondHourly = { id: "second-hourly", hourlyRate: 70000 };
  const combined = { ...teacher, businessRates: [rate, hourly, secondHourly] };
  const settings = getTeacherPaySettings(combined);
  assert.deepEqual(settings.businessRates, [hourly, secondHourly, rate]);
  assert.deepEqual(buildBusinessHours(settings.businessRates, { hourly: 10, "second-hourly": 2, share: 100 }), { hourly: 10, "second-hourly": 2 });
  const merged = mergeMonthlyWorkInput(settings.businessRates, override, { businessHours: { hourly: 10, "second-hourly": 2, share: 100 } });
  const amounts = getMonthlyPayAmounts(combined, merged);
  assert.equal(amounts.businessGrossPay, 2640000);
  assert.equal(amounts.businessHours, 12);
  const entries = createMonthlyEarningLines(combined, "2026-09", merged);
  assert.deepEqual(entries.map((line) => line.subjectName), ["시급 1", "시급 2", "학원비 비율 강사료"]);
  const payroll = calculatePayroll(entries, demoPolicy);
  assert.equal(payroll.gross, 2640000);
  assert.equal(payroll.totalDeductions, 87120);
  assert.equal(payroll.net, 2552880);
  assert.equal(payroll.reporting.classHours, 12);
  assert.equal(splitPayrollByIncome(payroll, demoPolicy)[0].payroll.earningLines.length, 3);
});

test("비율 40%와 시급 5만 원 10시간은 강사료 250만 원으로 합산한다", () => {
  const hourly = { id: "hourly", hourlyRate: 50000 };
  const combined = { ...teacher, businessRates: [hourly, rate] };
  const directInput = { businessWorkLines: [
    ...override.businessWorkLines, { ...hourly, rateId: hourly.id, hours: 10 }
  ] };
  assert.equal(getMonthlyPayAmounts(combined, directInput).businessGrossPay, 2500000);
  const resubmitted = mergeMonthlyWorkInput(combined.businessRates, directInput, { businessHours: { hourly: 12, share: 999 } });
  assert.equal(getMonthlyPayAmounts(combined, resubmitted).businessGrossPay, 2600000);
  assert.equal(resubmitted.businessWorkLines.find((line) => line.rateId === "share").tuitionAmount, 5000000);
});

test("시급제나 비율제에서 병행으로 전환하면 기존 월별 항목을 유지한다", () => {
  const hourly = { id: "hourly", hourlyRate: 50000 };
  const combined = { ...teacher, businessRates: [hourly, rate] };
  const oldHourly = { businessWorkLines: [{ ...hourly, rateId: hourly.id, hours: 10 }] };
  assert.equal(getMonthlyPayAmounts(combined, oldHourly).businessGrossPay, 500000);
  assert.equal(getMonthlyPayAmounts(combined, override).businessGrossPay, 2000000);
  const input = { businessWorkLines: [...oldHourly.businessWorkLines, ...override.businessWorkLines] };
  assert.equal(getMonthlyPayAmounts({ ...teacher, businessRates: [hourly] }, input).businessGrossPay, 500000);
  assert.equal(getMonthlyPayAmounts(teacher, input).businessGrossPay, 2000000);
  assert.equal(input.businessWorkLines.length, 2);
});

test("비율 행과 0시간 시급 행이 있어도 명세서의 시급 번호를 바꾸지 않는다", () => {
  const hourlyRates = [{ id: "first", hourlyRate: 50000 }, { id: "second", hourlyRate: 70000 }];
  const combined = { ...teacher, businessRates: [...hourlyRates, rate] };
  const input = { businessWorkLines: [
    ...override.businessWorkLines,
    { ...hourlyRates[0], rateId: "first", hours: 0 },
    { ...hourlyRates[1], rateId: "second", hours: 2 }
  ] };
  const entries = createMonthlyEarningLines(combined, "2026-09", input);
  assert.deepEqual(entries.map((line) => line.subjectName), ["학원비 비율 강사료", "시급 2"]);
});

test("비율 항목 하나와 시급 9개까지 허용하고 초과 입력을 거부한다", () => {
  const hourlyRates = Array.from({ length: 9 }, (_, index) => ({ id: `hourly-${index}`, hourlyRate: 50000 }));
  assert.equal(getTeacherPaySettings({ ...teacher, businessRates: [...hourlyRates, rate] }).businessRates.length, 10);
  assert.throws(() => getTeacherPaySettings({ ...teacher, businessRates: [...hourlyRates, rate, { id: "extra", hourlyRate: 50000 }] }));
});

const tuitionGroups = [
  { studentCount: 10, tuitionPerStudent: 300000 },
  { studentCount: 5, tuitionPerStudent: 400000 }
];

test("담당 학생 수와 다른 학원비들을 합산하고 제공된 전체 매출값은 사용하지 않는다", () => {
  const input = { businessWorkLines: [{ ...rate, rateId: rate.id, tuitionGroups, tuitionAmount: 99999999 }] };
  const amounts = getMonthlyPayAmounts(teacher, input);
  assert.equal(amounts.businessWorkLines[0].tuitionAmount, 5000000);
  assert.equal(amounts.businessGrossPay, 2000000);
  assert.equal(amounts.tuitionPending, false);
  assert.equal(amounts.businessHours, 0);
  const payroll = calculatePayroll(createMonthlyEarningLines(teacher, "2026-09", input), demoPolicy);
  assert.equal(payroll.gross, 2000000);
});

test("학생 수·학원비 내역을 명세서 산정 근거로 복사해 보존한다", () => {
  const groups = structuredClone(tuitionGroups);
  const input = { businessWorkLines: [{ ...rate, rateId: rate.id, tuitionGroups: groups }] };
  const entries = createMonthlyEarningLines(teacher, "2026-09", input);
  const [document] = splitPayrollByIncome(calculatePayroll(entries, demoPolicy), demoPolicy);
  groups[0].studentCount = 100;
  assert.deepEqual(document.payroll.earningLines[0].tuitionGroups, tuitionGroups);
  assert.equal(document.payroll.gross, 2000000);
});

test("미입력과 명시적 0명 정산을 구분하고 기존 합계 입력을 보존한다", () => {
  assert.equal(getMonthlyPayAmounts(teacher).tuitionPending, true);
  assert.equal(getMonthlyPayAmounts(teacher, { businessWorkLines: [] }).tuitionPending, true);
  const blank = mergeMonthlyWorkInput([rate], {}, { businessHours: {} });
  assert.equal(getMonthlyPayAmounts(teacher, blank).tuitionPending, true);
  const zero = { businessWorkLines: [{ ...rate, rateId: rate.id, tuitionGroups: [{ studentCount: 0, tuitionPerStudent: 0 }] }] };
  assert.equal(getMonthlyPayAmounts(teacher, zero).tuitionPending, false);
  assert.equal(getMonthlyPayAmounts(teacher, zero).businessGrossPay, 0);
  assert.equal(getMonthlyPayAmounts(teacher, override).tuitionPending, false);
  assert.equal("tuitionGroups" in tuitionBasis(override.businessWorkLines[0]), false);
});

test("학생 수·학원비의 잘못된 입력과 항목 수·합계 한도 초과를 거부한다", () => {
  for (const studentCount of [-1, 1.5, 1001, NaN, Infinity, "10", null]) {
    assert.throws(() => normalizeTuitionGroups([{ studentCount, tuitionPerStudent: 300000 }]));
  }
  for (const tuitionPerStudent of [-1, 0.5, 10000001, NaN, Infinity, "300000", null]) {
    assert.throws(() => normalizeTuitionGroups([{ studentCount: 10, tuitionPerStudent }]));
  }
  assert.throws(() => normalizeTuitionGroups(null));
  assert.throws(() => normalizeTuitionGroups(Array(11).fill(tuitionGroups[0])));
  assert.throws(() => normalizeTuitionGroups(Array(2).fill({ studentCount: 1000, tuitionPerStudent: 10000000 })));
  assert.equal(normalizeTuitionGroups(Array(10).fill(tuitionGroups[0])).length, 10);
  assert.deepEqual(normalizeTuitionGroups([]), []);
});

test("선생님이 제출한 담당 인원·학원비는 본인의 비율 항목에만 적용한다", () => {
  const submission = { businessHours: {}, tuitionInput: { rateId: rate.id, groups: tuitionGroups }, tuitionShareRate: 100 };
  const merged = mergeMonthlyWorkInput([rate], {}, submission);
  assert.equal(getMonthlyPayAmounts(teacher, merged).businessGrossPay, 2000000);
  assert.equal(getMonthlyPayAmounts(teacher, merged).tuitionPending, false);
  const wrong = mergeMonthlyWorkInput([rate], {}, { ...submission, tuitionInput: { rateId: "other", groups: tuitionGroups } });
  assert.equal(getMonthlyPayAmounts(teacher, wrong).businessGrossPay, 0);
  assert.equal(getMonthlyPayAmounts(teacher, wrong).tuitionPending, true);
});

test("관리자 보완 전에는 제출값을 적용하고 보완 후에는 재제출로 덮어쓰지 않는다", () => {
  const submission = { businessHours: {}, tuitionInput: { rateId: rate.id, groups: tuitionGroups } };
  const pending = { businessWorkLines: [{ ...rate, rateId: rate.id, tuitionGroups: [] }] };
  assert.equal(getMonthlyPayAmounts(teacher, mergeMonthlyWorkInput([rate], pending, submission)).businessGrossPay, 2000000);
  const saved = { businessWorkLines: [{ ...rate, rateId: rate.id, tuitionShareRate: 35,
    tuitionGroups: [{ studentCount: 8, tuitionPerStudent: 300000 }] }] };
  const reviewed = mergeMonthlyWorkInput([rate], saved, submission);
  assert.equal(getMonthlyPayAmounts(teacher, reviewed).businessGrossPay, 840000);
  assert.deepEqual(reviewed.businessWorkLines[0].tuitionGroups, saved.businessWorkLines[0].tuitionGroups);
  assert.equal(getMonthlyPayAmounts(teacher, mergeMonthlyWorkInput([rate], override, submission)).businessGrossPay, 2000000);
});

test("혼합형에서 담당 학원비와 시급을 합산하고 시간 재제출로 인원 내역을 지우지 않는다", () => {
  const hourly = { id: "hourly", hourlyRate: 50000 };
  const combined = { ...teacher, businessRates: [hourly, rate] };
  const saved = { businessWorkLines: [{ ...rate, rateId: rate.id, tuitionGroups }] };
  const merged = mergeMonthlyWorkInput(combined.businessRates, saved, { businessHours: { hourly: 10 }, tuitionInput: null });
  const amounts = getMonthlyPayAmounts(combined, merged);
  assert.equal(amounts.businessGrossPay, 2500000);
  assert.equal(amounts.businessHours, 10);
  assert.deepEqual(amounts.businessWorkLines.find((line) => line.rateId === rate.id).tuitionGroups, tuitionGroups);
});
