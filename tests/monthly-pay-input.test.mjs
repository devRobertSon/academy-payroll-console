import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { calculatePayroll, createMonthlyEarningLines, getMonthlyPayAmounts, getTeacherPaySettings, incomeLinkedInsuranceOverrides, isTuitionShare, tuitionBasis, businessRateLabel } from "../src/lib/payroll.js";
import { createCombinedPolicy, ntsTaxPolicy2024, officialInsurancePolicies } from "../src/data/nts-tax-policy.js";
import { EXCEL_PAY_FIELDS } from "../src/lib/payroll-excel-state.js";
import { escapeHtml as e, formatWon, formatMonth, formatHours } from "../src/lib/format.js";

const app = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
const teacher = {
  id: "demo", name: "가상선생님", email: "teacher@example.invalid", incomeComposition: "employee",
  defaultEmployeePay: 2000000, businessRates: [],
  insuranceSettings: Object.fromEntries(["nationalPension", "healthInsurance", "employmentInsurance"].map(key =>
    [key, { enrolled: true, defaultBaseAmount: 900000, effectiveFrom: "2026-01-01", effectiveTo: null }]))
};
const policy = createCombinedPolicy(ntsTaxPolicy2024, officialInsurancePolicies.at(-1));
const staleBases = { nationalPensionBase: 1100000, healthInsuranceBase: 1200000, employmentInsuranceBase: 1300000 };
function calculate(person = teacher, override = {}, month = "2026-09") {
  return calculatePayroll(createMonthlyEarningLines(person, month, override), policy,
    incomeLinkedInsuranceOverrides(getTeacherPaySettings(person).insuranceSettings, override));
}
function sourceFor(name) {
  const start = app.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  const rest = app.slice(start);
  const end = rest.search(/\r?\n(?:async )?function /);
  return end < 0 ? rest : rest.slice(0, end);
}
function load(name, context) {
  const helpers = ["hasEmployeeIncome", "hasBusinessIncome", "monthlyTeacherEditButtonHtml", "monthlyIncomeFieldsHtml", "excelPayFieldsForTeacher"];
  return runInNewContext(`${[...new Set([...helpers, name])].map(sourceFor).join("\n")}\n${name}`, { e, formatWon, formatMonth, formatHours,
    EXCEL_PAY_FIELDS, crypto, tuitionBasis, businessRateLabel, teacherPaySettings: getTeacherPaySettings, isTuitionShare, ...context });
}

test("live insurance ignores both old monthly and teacher bases without overwriting stored data", () => {
  const before = structuredClone(teacher);
  const overrides = { ...staleBases, employeeGrossPay: 2100000 };
  const saved = structuredClone(overrides);
  const result = calculate(teacher, overrides);
  assert.deepEqual(result.insuranceBases, { nationalPension: 2100000, healthInsurance: 2100000, employmentInsurance: 2100000 });
  assert.equal(result.gross, 2100000);
  assert.deepEqual(teacher, before);
  assert.deepEqual(overrides, saved);
  assert.equal(calculate({ ...teacher, defaultEmployeePay: 2500000 }, staleBases).insuranceBases.healthInsurance, 2500000);
});

test("transport only increases the insurance base when employee treatment and coverage are both selected", () => {
  for (const treatment of ["employee", "exempt", "business", "other", "pending"]) {
    for (const covered of [true, false]) {
      const result = calculate(teacher, { ...staleBases, transportTrips: 2, transportUnitAmount: 50000,
        transportTreatment: treatment, transportInsuranceCovered: covered });
      const expected = 2000000 + (treatment === "employee" && covered ? 100000 : 0);
      assert.equal(result.insuranceBases.healthInsurance, expected, `${treatment} ${covered}`);
      assert.equal(result.gross, 2100000);
    }
  }
});

test("enrollment and coverage periods remain active while manually entered premiums remain authoritative", () => {
  const person = structuredClone(teacher);
  person.insuranceSettings.nationalPension.enrolled = false;
  person.insuranceSettings.healthInsurance.effectiveFrom = "2026-10-01";
  person.insuranceSettings.employmentInsurance.effectiveTo = "2026-08-31";
  assert.deepEqual(calculate(person, staleBases).insuranceBases, { nationalPension: 0, healthInsurance: 0, employmentInsurance: 0 });
  const direct = calculate(teacher, { ...staleBases, excelPay: { employeeGrossPay: 2200000, nationalPension: 12345 } });
  assert.equal(direct.insuranceBases.nationalPension, 2200000);
  assert.equal(direct.deductions.nationalPension, 12345);
});

test("published payroll is returned unchanged instead of recalculating old insurance bases", () => {
  const calculation = { insuranceBases: { nationalPension: 1100000 }, gross: 2000000 };
  const get = load("payrollForTeacher", {
    isTeacherWorkspace: () => false, appConfig: { demoMode: false }, teacherById: () => teacher,
    publishedPayrollCalculation: load("publishedPayrollCalculation", { isAdminWorkspace: () => true }),
    payslipId: () => "2026-09_demo", state: { data: { payslips: [{ id: "2026-09_demo", status: "published", calculation }] } }
  });
  assert.equal(get("demo", "2026-09").payroll, calculation);
  for (const name of ["payrollForTeacher", "teacherInsuranceEstimate", "excelCalculation"]) {
    assert.match(sourceFor(name), /incomeLinkedInsuranceOverrides\(/, name);
  }
});

test("monthly form cannot write salary or old insurance bases, including forged form fields", async () => {
  for (const oldSalary of [undefined, 0, 2100000]) {
    const current = { ...staleBases, ...(oldSalary === undefined ? {} : { employeeGrossPay: oldSalary }) };
    const state = { month: "2026-09", data: { overrides: { "2026-09:demo": current } },
      store: { saveAdminMonthlyPayroll: async (value) => { sent = value; } } };
    let html, save, sent;
    const form = { reportValidity: () => true, elements: { transportInsuranceCovered: { checked: false } } };
    class FormDataMock {
      *[Symbol.iterator]() { yield* Object.entries({ employeeGrossPay: "9999999", nationalPensionBase: "9999999",
        employeeWorkHours: "2", transportTrips: "1", transportUnitAmount: "40000", transportTreatment: "exempt", grossPayNote: "" }); }
    }
    load("openMonthlyPayModal", {
      state, monthlyPayAmounts: () => getMonthlyPayAmounts(teacher, current), mergeBusinessWorkLines: () => [],
      monthlyWorkInput: () => null, submittedTuitionBasis: () => null, businessWorkEditorHtml: () => "",
      additionalEarningsEditorHtml: () => "", treatmentOptions: () => "",
      openModal: (_title, content, _button, handler) => { html = content; save = handler; },
      elements: { modalRoot: { querySelector: selector => selector === "#monthly-pay-form" ? form : selector === "[data-monthly-edit-teacher]" ? { addEventListener() {} } : null } },
      bindBusinessWorkEditor() {}, bindAdditionalEarningsEditor() {}, readBusinessWorkLines: () => [],
      readAdditionalEarnings: () => [], FormData: FormDataMock, showToast() {}, renderPayrollInputs() {}
    })(teacher);
    assert.match(html, /id="monthly-pay-employee"[^>]*readonly/);
    assert.doesNotMatch(html, /기본 근로소득|이번 달 보험 신고 기준액|name="employeeGrossPay"|name="nationalPensionBase"/);
    await save();
    assert.equal(Object.hasOwn(sent, "employeeGrossPay"), false);
    assert.equal(Object.hasOwn(sent, "nationalPensionBase"), false);
    assert.equal(state.data.overrides["2026-09:demo"].employeeGrossPay, oldSalary);
    assert.equal(state.data.overrides["2026-09:demo"].nationalPensionBase, staleBases.nationalPensionBase);
    assert.equal(getMonthlyPayAmounts(teacher, state.data.overrides["2026-09:demo"]).employeeGrossPay, oldSalary ?? 2000000);
  }
});

test("Excel monthly dialog preserves employee salary on edit and clearing direct amounts", async () => {
  for (const employeeGrossPay of [undefined, 0, 2200000]) {
    for (const clear of [true, false]) {
      const direct = { businessGrossPay: 300000, ...(employeeGrossPay === undefined ? {} : { employeeGrossPay }) };
      let html, save, saved;
      const form = { reportValidity: () => true };
      class FormDataMock {
        get(key) { return key === "employeeGrossPay" ? "9999999" : key === "transportTreatment" ? "exempt" : key === "otherTreatment" ? "pending" : ""; }
        has(key) { return key === "clearDirect" && clear; }
      }
      load("openExcelPayModal", {
        EXCEL_PAY_FIELDS, state: { month: "2026-09", data: { overrides: { "2026-09:demo": { excelPay: direct } } } },
        excelExpectedState: () => ({}), monthlyPayAmounts: () => ({ employeeGrossPay: employeeGrossPay ?? 2000000, transportTreatment: "exempt" }),
        treatmentOptions: () => "", openModal: (_title, content, _button, handler) => { html = content; save = handler; },
        elements: { modalRoot: { querySelector: selector => selector === "[data-monthly-edit-teacher]" ? { addEventListener() {} } : form } }, FormData: FormDataMock,
        saveExcelChanges: async (_month, changes) => { saved = changes[0].excelPay; }, showToast() {}
      })(teacher, true);
      assert.doesNotMatch(html, /name="employeeGrossPay"/);
      assert.match(html, /readonly/);
      await save();
      assert.equal(saved?.employeeGrossPay, employeeGrossPay);
      if (clear) assert.deepEqual(JSON.parse(JSON.stringify(saved)), employeeGrossPay == null ? null : { employeeGrossPay });
    }
  }
  assert.match(sourceFor("openMonthlyPayModal"), /openExcelPayModal\(teacher, true\)/);
});

test("monthly list puts net pay after teacher, retains accessible buttons and published-month lock", () => {
  for (const locked of [false, true]) {
    const eventTarget = { addEventListener() {} };
    const content = { innerHTML: "", querySelector: () => eventTarget, querySelectorAll: () => [] };
    load("renderPayrollInputs", {
      runForMonth: () => ({ status: locked ? "published" : "draft" }), activeTeachers: () => [teacher],
      state: { month: "2026-09", search: "", data: { overrides: { "2026-09:demo": { excelPay: { employeeGrossPay: 2000000 } } } } }, monthlyPayAmounts: () => getMonthlyPayAmounts(teacher),
      payrollForTeacher: () => ({ payroll: { net: 1801234, reporting: { lectureWithholding: 4321 } } }),
      setPage() {}, bindCommonControls() {}, bindMonthlyPayRows: (value) => assert.equal(value, locked), statusLabel: String, personCell: load("personCell", {}),
      estimatedBusinessWithholding: () => 0, elements: { content, topbarActions: { querySelector: () => eventTarget } },
      openPayrollExcelImport() {}, exportMonthlyPayrollExcel() {}
    })();
    assert.match(content.innerHTML, /<td class="monthly-pay-person"><button[^>]*data-edit-monthly-pay="demo"/);
    const button = content.innerHTML.match(/<button[^>]*data-edit-monthly-pay="demo"[^>]*>/)[0];
    assert.match(button, /aria-label="가상선생님 월 지급액 입력"/);
    assert.equal(button.includes("disabled"), locked);
    assert.match(button, /aria-pressed="false"/);
    assert.match(content.innerHTML, /<th>선생님<\/th><th class="numeric">실 지급액<\/th><th>가입 보험<\/th>/);
    assert.match(content.innerHTML, /<\/button><\/td><td class="numeric"><strong>1,801,234원<\/strong>/);
    assert.match(content.innerHTML, /<td class="numeric">4,321원<\/td>/);
    assert.match(content.innerHTML, /엑셀 직접 입력/);
    assert.doesNotMatch(content.innerHTML, /data-lucide="pencil"/);
    assert.equal([...content.innerHTML.matchAll(/<th[ >]/g)].length, 12);
  }
});

test("monthly row first activation selects, another row changes selection, and reactivation opens edit", () => {
  const opened = [];
  const rows = ["first", "second"].map((id) => {
    const button = { attributes: {}, setAttribute(key, value) { this.attributes[key] = value; }, focus() { this.focused = true; } };
    const row = { dataset: { monthlyPayRow: id }, selected: false, button, handlers: {},
      querySelector: () => button, addEventListener(type, handler) { this.handlers[type] = handler; } };
    row.classList = { toggle: (name, value) => { assert.equal(name, "selected-row"); row.selected = value; } };
    return row;
  });
  let status = "draft";
  const bind = load("bindMonthlyPayRows", {
    elements: { content: { querySelectorAll: () => rows } }, state: { month: "2026-09" }, runForMonth: () => ({ status }),
    teacherById: id => ({ id }), openMonthlyPayModal: person => opened.push(person.id)
  });
  bind(true);
  assert.equal(rows[0].handlers.click, undefined);
  bind(false);
  rows[0].handlers.click();
  assert.deepEqual(opened, []);
  assert.equal(rows[0].selected, true);
  assert.equal(rows[0].button.attributes["aria-pressed"], "true");
  assert.equal(rows[0].button.focused, true);
  rows[1].handlers.click();
  assert.deepEqual(opened, []);
  assert.equal(rows[0].selected, false);
  assert.equal(rows[0].button.attributes["aria-pressed"], "false");
  assert.equal(rows[1].selected, true);
  rows[1].handlers.click();
  assert.deepEqual(opened, ["second"]);
  status = "published";
  rows[1].handlers.click();
  assert.deepEqual(opened, ["second"]);
  status = "draft";
  bind(false);
  rows[1].handlers.click();
  assert.deepEqual(opened, ["second"]);
});

const hourly = { id: "hourly", hourlyRate: 40000 };
const share = { id: "share", tuitionShareRate: 40 };

test("monthly income sections follow employee, business and mixed contracts and pay methods", () => {
  const context = { state: { month: "2026-09" } };
  context.tuitionAmountEditorHtml = load("tuitionAmountEditorHtml", context);
  context.businessWorkRowHtml = load("businessWorkRowHtml", context);
  context.businessWorkEditorHtml = load("businessWorkEditorHtml", context);
  for (const composition of ["employee", "business", "mixed"]) {
    for (const rates of [[hourly], [share], [hourly, share], []]) {
      const person = { ...teacher, incomeComposition: composition, businessRates: rates };
      const settings = getTeacherPaySettings(person);
      const lines = load("mergeBusinessWorkLines")(settings.businessRates, []);
      const html = load("monthlyIncomeFieldsHtml", context)(settings, getMonthlyPayAmounts(person), lines);
      assert.equal(html.includes('id="monthly-pay-employee"'), composition !== "business");
      assert.equal(html.includes('name="employeeWorkHours"'), composition !== "business");
      assert.equal(html.includes('data-work-hourly readonly'), composition !== "employee" && rates.includes(hourly));
      assert.equal(html.includes('data-work-share readonly'), composition !== "employee" && rates.includes(share));
      assert.equal(html.includes('data-tuition-amount'), composition !== "employee" && rates.includes(share));
      assert.doesNotMatch(html, /data-add-business-work|data-remove-business-line/);
      if (composition !== "employee" && rates.length === 0) assert.match(html, /등록된 시급·비율이 없습니다/);
    }
  }
});

test("current contract rates are authoritative while matching hours and tuition drafts survive", () => {
  const merge = load("mergeBusinessWorkLines");
  const draft = [{ id: "work1", rateId: "hourly", hourlyRate: 40000, hours: "7.5" },
    { id: "work2", rateId: "share", tuitionShareRate: 40, tuitionAmount: 5000000 },
    { id: "removed", rateId: "old", hourlyRate: 999999, hours: 10 }];
  const before = structuredClone(draft);
  const lines = merge([{ ...hourly, hourlyRate: 50000 }, { ...share, tuitionShareRate: 45 }], draft);
  assert.equal(lines.length, 2);
  assert.equal(lines[0].hours, "7.5");
  assert.equal(lines[0].hourlyRate, 50000);
  assert.equal(lines[1].tuitionAmount, 5000000);
  assert.equal(lines[1].tuitionShareRate, 45);
  assert.deepEqual(draft, before);
  assert.equal(merge([], draft).length, 0);
  assert.equal(merge([share], draft).length, 1);
  assert.equal(merge([hourly], draft).length, 1);
  assert.equal(merge([{ id: "new", hourlyRate: 60000 }], draft)[0].hours, 0);
  assert.equal(merge([share], [{ ...draft[1], tuitionAmount: null }])[0].tuitionAmount, null);
});

test("legacy unlinked work is matched at most once by rate, never duplicated", () => {
  const merge = load("mergeBusinessWorkLines");
  const lines = merge([hourly, { ...hourly, id: "second" }], [{ id: "legacy", hourlyRate: 40000, hours: 9 }]);
  assert.equal(lines[0].hours, 9);
  assert.equal(lines[1].hours, 0);
  assert.equal(lines[0].id, "legacy");
});

test("Excel monthly fields hide unrelated income and hourly fields without rewriting imported amounts", () => {
  const get = load("excelPayFieldsForTeacher");
  const keys = (incomeComposition, businessRates) => get({ ...teacher, incomeComposition, businessRates }).map(([key]) => key);
  const employee = keys("employee", []);
  assert.ok(employee.includes("employeeGrossPay"));
  assert.ok(!employee.includes("businessGrossPay"));
  const business = keys("business", [share]);
  assert.ok(business.includes("businessGrossPay"));
  assert.ok(!business.includes("employeeGrossPay"));
  assert.ok(!business.includes("nationalPension"));
  assert.ok(!business.includes("businessHours"));
  const mixed = keys("mixed", [hourly, share]);
  for (const key of ["employeeGrossPay", "businessGrossPay", "employeeWorkHours", "businessHours"]) assert.ok(mixed.includes(key));
});

test("separate teacher editor restores the same unfinished controls on save and cancel", () => {
  for (const saved of [false, true]) {
    let options, resumed = 0, focused = false;
    const body = { scrollTop: 345 };
    const button = { focus: () => { focused = true; }, click() {} };
    const nodes = [{ value: "미완성 기타 항목", handler: () => {} }, { value: "2.5" }];
    const root = { childNodes: nodes, querySelector: selector => selector === ".modal-body" ? body : button,
      replaceChildren(...items) { this.childNodes = items; } };
    load("editTeacherFromMonthlyPay", {
      elements: { modalRoot: root }, refreshIcons() {}, overlays: { open() {} },
      openTeacherEditModal: (_teacher, callbacks) => { options = callbacks; root.childNodes = [{ editor: true }]; }
    })(teacher, () => { resumed++; });
    assert.equal(resumed, 0);
    if (saved) options.onSaved();
    options.onClose();
    assert.equal(root.childNodes[0], nodes[0]);
    assert.equal(root.childNodes[1], nodes[1]);
    assert.equal(root.childNodes[0].value, "미완성 기타 항목");
    assert.equal(body.scrollTop, 345);
    assert.equal(resumed, Number(saved));
    assert.equal(focused, true);
  }
});

test("modal save failure retains editor and draft; dismiss is blocked during an in-flight save", async () => {
  function element() { return { listeners: {}, addEventListener(type, fn) { this.listeners[type] = fn; } }; }
  for (const outcome of ["save", "invalid", "error"]) {
    const close = element(), submit = element(), backdrop = element();
    let escape, finish, closed = 0, returned = 0, errors = 0;
    const root = { innerHTML: "", querySelectorAll: () => [close],
      querySelector: selector => selector === ".modal-backdrop" ? backdrop : submit };
    const saving = new Promise(resolve => { finish = resolve; });
    load("openModal", { elements: { modalRoot: root }, refreshIcons() {},
      overlays: { open: (_root, options) => { escape = options.onEscape; } },
      closeModal: () => { closed++; }, showError: () => { errors++; }
    })("Teacher", "body", "Save", async () => {
      await saving;
      if (outcome === "error") throw new Error("denied");
      return outcome !== "invalid";
    }, { onClose: () => { returned++; } });
    const pending = submit.listeners.click();
    escape(); close.listeners.click();
    assert.equal(closed, 0);
    assert.equal(submit.disabled, true);
    finish(); await pending;
    assert.equal(closed, outcome === "save" ? 1 : 0);
    assert.equal(returned, outcome === "save" ? 1 : 0);
    assert.equal(errors, outcome === "error" ? 1 : 0);
    assert.equal(submit.disabled, false);
    if (outcome !== "save") { escape(); assert.equal(returned, 1); }
  }
});

test("teacher editor only signals a successful return after persistence, not before", () => {
  const source = sourceFor("openTeacherEditModal");
  assert.ok(source.indexOf("await state.store.updateTeacher(updated)") < source.indexOf("onSaved?.()"));
  assert.match(source, /\}, \{ onClose \}\)/);
  assert.doesNotMatch(source, /saveAdminMonthlyPayroll|saveExcelChanges/);
});

test("returning from saved teacher settings reprices draft work and commits monthly changes only on final save", async () => {
  const person = { ...teacher, incomeComposition: "mixed", businessRates: [hourly, share] };
  const oldOverride = { employeeGrossPay: 2100000, grossPayNote: "old" };
  const state = { month: "2026-09", data: { overrides: { "2026-09:demo": oldOverride } } };
  const draft = [{ id: "h", rateId: "hourly", hourlyRate: 40000, hours: 7.5 },
    { id: "s", rateId: "share", tuitionShareRate: 40, tuitionAmount: 5000000 }];
  const panel = { innerHTML: "" }, header = { textContent: "" };
  const noticeText = { textContent: "" }, notice = { hidden: true, querySelector: () => noticeText };
  let openEdit, returnFromEdit, save;
  const fields = { employeeWorkHours: "9", transportTrips: "2", transportUnitAmount: "50000", transportTreatment: "exempt", grossPayNote: "unfinished memo" };
  const form = { reportValidity: () => true, elements: { employeeWorkHours: { value: "9" }, transportInsuranceCovered: { checked: false } } };
  const button = { addEventListener: (_type, fn) => { openEdit = fn; } };
  const map = { "#monthly-pay-form": form, "[data-monthly-edit-teacher]": button,
    "[data-monthly-income-fields]": panel, "#modal-title": header, "[data-monthly-contract-notice]": notice };
  const context = {
    state, monthlyPayAmounts: () => getMonthlyPayAmounts(person, oldOverride), mergeBusinessWorkLines: load("mergeBusinessWorkLines"),
    monthlyWorkInput: () => null, submittedTuitionBasis: () => null, businessWorkEditorHtml: () => "business",
    additionalEarningsEditorHtml: () => "", treatmentOptions: () => "", captureMonthlyWorkDraft: () => draft,
    openModal: (_title, _body, _label, handler) => { save = handler; },
    editTeacherFromMonthlyPay: (_person, callback) => { returnFromEdit = callback; },
    elements: { modalRoot: { querySelector: selector => map[selector] || null } },
    bindBusinessWorkEditor() {}, bindAdditionalEarningsEditor() {}, readBusinessWorkLines: () => draft,
    readAdditionalEarnings: () => [{ id: "bonus", label: "draft", amount: 10000, treatment: "exempt" }],
    FormData: class { *[Symbol.iterator]() { yield* Object.entries(fields); } }, showToast() {}, renderPayrollInputs() {}
  };
  load("openMonthlyPayModal", context)(person);
  openEdit();
  assert.equal(state.data.overrides["2026-09:demo"], oldOverride);
  person.defaultEmployeePay = 2500000;
  person.businessRates = [{ ...hourly, hourlyRate: 50000 }, { ...share, tuitionShareRate: 45 }];
  returnFromEdit();
  assert.equal(state.data.overrides["2026-09:demo"], oldOverride);
  assert.match(panel.innerHTML, /2,500,000원/);
  assert.equal(notice.hidden, false);
  await save();
  const saved = state.data.overrides["2026-09:demo"];
  assert.equal(saved.employeeGrossPay, 2500000);
  assert.equal(saved.employeeWorkHours, 9);
  assert.equal(saved.transportTrips, 2);
  assert.equal(saved.transportUnitAmount, 50000);
  assert.equal(saved.grossPayNote, "unfinished memo");
  assert.equal(saved.additionalEarnings[0].amount, 10000);
  assert.equal(saved.businessWorkLines[0].hourlyRate, 50000);
  assert.equal(saved.businessWorkLines[0].hours, 7.5);
  assert.equal(saved.businessWorkLines[1].tuitionShareRate, 45);
  assert.equal(saved.businessWorkLines[1].tuitionAmount, 5000000);
  assert.equal(getMonthlyPayAmounts(person, saved).businessGrossPay, 2625000);
});
