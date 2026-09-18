import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { calculatePayroll, createMonthlyEarningLines, getMonthlyPayAmounts, getTeacherPaySettings, INSURANCE_LABELS, TREATMENT_LABELS, businessRateLabel, isTuitionShare } from "../src/lib/payroll.js";
import { createCombinedPolicy, ntsTaxPolicy2024, officialInsurancePolicies } from "../src/data/nts-tax-policy.js";
import { buildExcelPay } from "../src/lib/payroll-excel.js";
import { escapeHtml as e, formatWon, formatMonth } from "../src/lib/format.js";

const app = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
const rules = await readFile(new URL("../firestore.rules", import.meta.url), "utf8");
const policy = createCombinedPolicy(ntsTaxPolicy2024, officialInsurancePolicies.at(-1));
const teacher = {
  id: "demo-pay", name: "가상강사", incomeComposition: "employee", defaultEmployeePay: 2000000,
  businessRates: [], paymentDay: 10,
  insuranceSettings: Object.fromEntries(Object.keys(INSURANCE_LABELS).map((key) => [key, { enrolled: true }]))
};
const other = { amount: 100000, treatment: "employee", insuranceCovered: true };
function sourceFor(name) {
  const start = app.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  const remaining = app.slice(start);
  const next = remaining.search(/\r?\n(?:async )?function /);
  return next < 0 ? remaining : remaining.slice(0, next);
}
const context = {
  e, formatWon, formatMonth, calculatePayroll, createMonthlyEarningLines,
  INSURANCE_LABELS, TREATMENT_LABELS, businessRateLabel, isTuitionShare,
  state: { month: "2026-09" }, teacherPaySettings: getTeacherPaySettings,
  policyForMonth: () => policy, teacherContractLabel: () => "근로소득"
};
context.taxProfileForTeacher = runInNewContext(`${sourceFor("taxProfileForTeacher")}\ntaxProfileForTeacher`);
context.teacherInsuranceEstimate = runInNewContext(`${sourceFor("teacherInsuranceEstimate")}\nteacherInsuranceEstimate`, context);
function load(name, extra = {}) { return runInNewContext(`${sourceFor(name)}\n${name}`, { ...context, ...extra }); }
function calculate(person, override = {}) {
  return calculatePayroll(createMonthlyEarningLines(person, "2026-09", override), policy,
    { ...override, insuranceSettings: person.insuranceSettings }, person.taxProfile);
}

test("신규 항목이 없는 기존 선생님의 지급액과 급여 지급일을 보존한다", () => {
  const before = structuredClone(teacher);
  const settings = getTeacherPaySettings(teacher);
  assert.equal(settings.otherPaymentPolicy.amount, 0);
  assert.equal(settings.transportPolicy.paymentDay, 5);
  assert.equal(getTeacherPaySettings({ ...teacher, transportPolicy: { paymentDay: 7 } }).transportPolicy.paymentDay, 7);
  assert.equal(calculate(teacher).gross, 2000000);
  assert.equal(teacher.paymentDay, 10);
  assert.deepEqual(teacher, before);
});

test("기타 기본금액은 매월 한 번 적용하고 보험 포함 여부를 반영한다", () => {
  const person = { ...teacher, otherPaymentPolicy: other };
  assert.equal(getMonthlyPayAmounts(person).otherPaymentAmount, 100000);
  for (const month of ["2026-09", "2026-10"]) {
    const lines = createMonthlyEarningLines(person, month);
    assert.equal(lines.filter((line) => line.earningCategory === "otherPayment").length, 1);
    assert.equal(calculatePayroll(lines, policy, { insuranceSettings: teacher.insuranceSettings }).gross, 2100000);
  }
  assert.equal(calculate(person).insuranceBases.healthInsurance, 2100000);
  assert.equal(calculate({ ...person, otherPaymentPolicy: { ...other, insuranceCovered: false } }).insuranceBases.healthInsurance, 2000000);
});

test("월별 기타 항목과 명시적 0원은 기본금액보다 우선한다", () => {
  const person = { ...teacher, otherPaymentPolicy: other };
  assert.equal(getMonthlyPayAmounts(person, { additionalEarnings: [] }).otherPaymentAmount, 0);
  assert.equal(getMonthlyPayAmounts(person, { additionalEarnings: [{ amount: 5000, treatment: "exempt" }] }).otherPaymentAmount, 5000);
  assert.equal(getMonthlyPayAmounts(person, { excelPay: { otherPaymentAmount: 0 } }).otherPaymentAmount, 0);
  assert.equal(getMonthlyPayAmounts(person, { excelPay: { otherPaymentAmount: 12345, otherTreatment: "business" } }).otherPaymentAmount, 12345);
  assert.equal(getMonthlyPayAmounts(person, { excelPay: null }).otherPaymentAmount, 100000);
});

test("사업소득 선생님도 기타 기본금액을 받고 미확인 처리는 확정 전 확인 대상으로 남는다", () => {
  const person = { ...teacher, incomeComposition: "business", defaultEmployeePay: 0, businessRates: [{ id: "a", hourlyRate: 50000 }], otherPaymentPolicy: { amount: 100000 } };
  const amounts = getMonthlyPayAmounts(person);
  assert.equal(amounts.otherPaymentAmount, 100000);
  assert.equal(amounts.unconfirmedCount, 1);
  assert.equal(calculatePayroll(createMonthlyEarningLines(person, "2026-09"), policy).unconfirmedEarningLines.length, 1);
});

test("기타 기본금액이 있어도 J열의 주차비와 K열의 기타비를 한 번만 적용한다", () => {
  const person = { ...teacher, otherPaymentPolicy: other };
  const override = { parkingAmount: 20000, parkingTreatment: "exempt" };
  const row = { values: { transport: 50000, other: 150000 }, errors: [], hasInputs: true };
  const excelPay = buildExcelPay(row, person, override, { otherTreatment: "employee" });
  assert.equal(getMonthlyPayAmounts(person, override).otherPaymentAmount, 100000);
  assert.equal(excelPay.otherPaymentAmount, 150000);
  const amounts = getMonthlyPayAmounts(person, { ...override, excelPay });
  assert.equal(amounts.transportAmount, 30000);
  assert.equal(amounts.parkingAmount, 20000);
  assert.equal(amounts.otherPaymentAmount, 150000);
  assert.equal(amounts.additionalGrossPay, 200000);
});

test("200만 원의 공제는 총 지급액을 줄이지 않고 실 지급액에서만 차감한다", () => {
  for (const person of [teacher, { ...teacher, insuranceSettings: {} }]) {
    const result = calculate(person);
    assert.equal(result.gross, 2000000);
    assert.equal(result.earningLines.find((line) => line.earningCategory === "employeeSalary").amount, 2000000);
    assert.equal(result.net + result.totalDeductions, 2000000);
  }
});

test("선생님 상세에 보험별 예상 금액과 합계, 기타금액과 교통비 지급일을 표시한다", () => {
  const html = load("teacherPayDetails")({ ...teacher, otherPaymentPolicy: { ...other, insuranceCovered: false } });
  assert.match(html, /예상 보험료/);
  assert.match(html, /95,000원/);
  assert.match(html, /81,340원/);
  assert.match(html, /18,000원/);
  assert.match(html, /194,340원/);
  assert.match(html, /기타 기본금액[\s\S]*100,000원/);
  assert.match(html, /교통비 지급일[\s\S]*매월 5일/);
  assert.match(html, /급여 지급일[\s\S]*매월 10일/);
});

test("개인 원천징수 항목을 화면에서 제거해도 기존 계산 조건은 유지한다", () => {
  assert.doesNotMatch(app, /name="(?:dependentCount|children8To20|withholdingRatio)"|data-edit-tax-profile|openTaxProfileModal/);
  assert.doesNotMatch(app, /공제대상가족|8~20세 자녀|원천징수 비율/);
  assert.match(sourceFor("openTeacherEditModal"), /taxProfile: taxProfileForTeacher\(teacher\)/);
  const taxProfile = { dependentCount: 4, children8To20: 2, withholdingRatio: 0.8 };
  assert.deepEqual(JSON.parse(JSON.stringify(context.taxProfileForTeacher({ taxProfile }))), taxProfile);
  const person = { ...teacher, taxProfile };
  assert.equal(context.teacherInsuranceEstimate(person).deductions.employeeIncomeTax, calculate(person).deductions.employeeIncomeTax);
});

test("숫자 입력의 스크롤 증감만 막고 일반 페이지 스크롤은 유지한다", () => {
  let listener;
  let blurred = 0;
  const document = {
    activeElement: { tagName: "INPUT", type: "number", blur: () => { blurred++; } },
    addEventListener: (name, callback, options) => {
      assert.equal(name, "wheel");
      assert.equal(options.capture, true);
      assert.equal(options.passive, true);
      listener = callback;
    }
  };
  load("bindNumberInputScrollGuard", { document })();
  listener();
  assert.equal(blurred, 1);
  document.activeElement.type = "text";
  listener();
  assert.equal(blurred, 1);
});

function insuranceForm() {
  const field = (value = "") => ({ value, checked: false, dataset: {}, listeners: {}, addEventListener(name, fn) { this.listeners[name] = fn; } });
  const pay = field("2000000");
  const elements = { otherPaymentAmount: field("0"), otherPaymentTreatment: field("employee") };
  const otherSettings = { dataset: { otherInsuranceCovered: "true" } };
  for (const key of Object.keys(INSURANCE_LABELS)) {
    elements[`edit-${key}-base`] = field(key === "nationalPension" ? "1500000" : "2000000");
    elements[`edit-${key}-enrolled`] = { ...field(), checked: true };
    elements[`edit-${key}-from`] = field();
    elements[`edit-${key}-to`] = field();
  }
  const labels = new Map();
  const output = (selector) => {
    if (!labels.has(selector)) labels.set(selector, { textContent: "" });
    return labels.get(selector);
  };
  const form = { elements, querySelector: (selector) => selector === "#pay" ? pay : selector === "[data-other-insurance-covered]" ? otherSettings : selector.startsWith("[data-insurance-preview") ? { querySelector: output } : output(selector) };
  return { form, pay, elements, labels };
}

test("보험 편집기를 열거나 급여를 바꿔도 별도로 지정한 신고 기준액은 덮어쓰지 않는다", () => {
  const { form, pay, elements, labels } = insuranceForm();
  load("bindInsuranceEditorAutomation", { readOtherPaymentPolicy: load("readOtherPaymentPolicy") })(form, "edit", "#pay", teacher);
  assert.equal(elements["edit-nationalPension-base"].value, "1500000");
  assert.equal(labels.get('[data-insurance-row-estimate="nationalPension"]').textContent, "71,250원");
  pay.value = "3000000";
  pay.listeners.input();
  assert.equal(elements["edit-nationalPension-base"].value, "1500000");
  assert.equal(elements["edit-healthInsurance-base"].value, "3000000");
  elements.otherPaymentAmount.value = "100000";
  elements.otherPaymentAmount.listeners.input();
  assert.equal(elements["edit-healthInsurance-base"].value, "3100000");
  assert.equal(elements["edit-nationalPension-base"].value, "1500000");
});

test("기타 보험 체크박스 없이 기존 기본값과 월별 보험 설정을 보존한다", () => {
  for (const covered of [true, false]) {
    const html = load("otherPaymentEditorHtml", { treatmentOptions: () => "" })({ ...other, insuranceCovered: covered }, "test");
    assert.doesNotMatch(html, /type="checkbox"/);
    const form = { elements: { otherPaymentAmount: { value: "100000" }, otherPaymentTreatment: { value: "employee" } },
      querySelector: () => ({ dataset: { otherInsuranceCovered: String(covered) } }) };
    assert.equal(load("readOtherPaymentPolicy")(form).insuranceCovered, covered);
    const row = { dataset: { lineId: "old", insuranceCovered: String(covered) }, querySelector: (selector) => ({ value:
      selector.includes("label") ? "기타" : selector.includes("amount") ? "100000" : "employee" }) };
    const lines = load("readAdditionalEarnings", { document: { querySelectorAll: () => [row] } })("#test");
    assert.equal(lines[0].insuranceCovered, covered);
  }
  assert.doesNotMatch(app, /name="otherPaymentInsuranceCovered"|data-additional-insurance|data-choice="otherInsuranceCovered"|name="otherInsuranceCovered"/);
});

test("월 지급액 저장 시 이전 주차비 금액과 보험 설정을 그대로 보존한다", async () => {
  const legacy = { parkingAmount: 23456, parkingTreatment: "pending", parkingInsuranceCovered: true };
  const person = { ...teacher, id: "legacy" };
  const localState = { month: "2026-09", data: { overrides: { "2026-09:legacy": legacy } } };
  let html;
  let save;
  const form = { reportValidity: () => true, elements: { transportInsuranceCovered: { checked: false } } };
  class FormDataMock {
    *[Symbol.iterator]() { yield* Object.entries({ employeeGrossPay: "2000000", transportTrips: "1", transportUnitAmount: "40000", transportTreatment: "exempt", legacyParkingTreatment: "exempt", grossPayNote: "" }); }
  }
  load("openMonthlyPayModal", {
    state: localState, monthlyPayAmounts: () => getMonthlyPayAmounts(person, legacy),
    mergeBusinessWorkLines: () => [], monthlyWorkInput: () => null, submittedTuitionBasis: () => null,
    monthlyInsuranceBasesHtml: () => "", businessWorkEditorHtml: () => "", additionalEarningsEditorHtml: () => "", treatmentOptions: () => "",
    openModal: (title, body, button, handler) => { html = body; save = handler; },
    elements: { modalRoot: { querySelector: (selector) => selector === "#monthly-pay-form" ? form : null } },
    bindBusinessWorkEditor() {}, bindAdditionalEarningsEditor() {}, readBusinessWorkLines: () => [], readAdditionalEarnings: () => [],
    FormData: FormDataMock, showToast() {}, renderPayrollInputs() {}
  })(person);
  assert.doesNotMatch(html, /name="parkingAmount"|name="parkingInsuranceCovered"/);
  assert.match(html, /이전 주차비 내역 23,456원/);
  await save();
  const saved = localState.data.overrides["2026-09:legacy"];
  assert.equal(saved.parkingAmount, 23456);
  assert.equal(saved.parkingInsuranceCovered, true);
  assert.equal(saved.parkingTreatment, "exempt");
  assert.equal(saved.transportUnitAmount, 40000);
  assert.equal(getMonthlyPayAmounts(person, saved).additionalGrossPay, 63456);
  assert.equal(legacy.parkingTreatment, "pending");
});

test("내역서와 CSV에서 주차비를 교통비에 한 번만 합산한다", () => {
  const payroll = calculate(teacher, { transportTrips: 1, transportUnitAmount: 40000, transportTreatment: "exempt", parkingAmount: 23456, parkingTreatment: "exempt" });
  const report = { transportAmount: 40000, parkingAmount: 23456, otherPaymentAmount: 0, lectureWithholding: 0, additionalPaymentWithholding: 0 };
  let rows;
  const extra = {
    accountingReportFor: () => report, insuranceBasesFor: () => ({}), formatMobilePhoneNumber: () => "", formatTeacherIdentity: () => "", formatMaskedTeacherIdentity: () => "",
    ledgerItemsForMonth: () => [{ teacher, incomeLabel: "근로소득", payroll }], earningBasisLabel: () => "", downloadCsv: (name, value) => { rows = value; }, showToast() {},
    formatNumber: String, formatHours: String
  };
  load("exportLedger", extra)();
  assert.equal(rows[0].length, rows[1].length);
  assert.equal(rows[1][rows[0].indexOf("교통비")], 63456);
  assert.equal(rows[0].includes("주차료"), false);
  const html = load("ledgerTable", extra)([{ teacher, incomeLabel: "근로소득", payroll }], { gross: payroll.gross, deductions: payroll.totalDeductions, net: payroll.net });
  assert.match(html, /<td class="numeric">63456<\/td>/);
  assert.doesNotMatch(html, /<th[^>]*>주차/);
  assert.equal([...html.matchAll(/<th[ >]/g)].length, 24);
});

test("기존 규칙 호환을 유지하고 새 기본 지급 설정은 관리자만 변경할 수 있다", () => {
  assert.match(rules, /function hasValidOtherPaymentPolicy\(data\)/);
  assert.match(rules, /return !data\.keys\(\)\.hasAny\(\['otherPaymentPolicy'\]\)/);
  const otherPolicy = rules.slice(rules.indexOf("function hasValidOtherPaymentPolicy("), rules.indexOf("function hasValidTaxProfile("));
  assert.match(otherPolicy, /let policy = data\.get\('otherPaymentPolicy', null\)/);
  assert.match(otherPolicy, /policy\.amount is int/);
  assert.match(otherPolicy, /policy\.amount <= 100000000/);
  const transport = rules.slice(rules.indexOf("function hasValidTransportPolicy("), rules.indexOf("function hasValidOtherPaymentPolicy("));
  assert.match(transport, /let policy = data\.transportPolicy/);
  assert.match(transport, /policy\.paymentDay is int/);
  const ownUpdate = rules.slice(rules.indexOf("|| (isOwnTeacher(teacherId)"), rules.indexOf("allow delete: if isAdmin();", rules.indexOf("match /teachers/")));
  assert.doesNotMatch(ownUpdate, /'otherPaymentPolicy'|'transportPolicy'|'paymentDay'/);
});
