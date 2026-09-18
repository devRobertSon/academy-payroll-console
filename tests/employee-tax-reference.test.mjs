import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { calculatePayroll, createMonthlyEarningLines, splitPayrollByIncome, publicPayslipCalculation } from "../src/lib/payroll.js";
import { payslipVersionId } from "../src/lib/payroll-lifecycle.js";
import { demoPolicy } from "../src/data/demo-data.js";
import { escapeHtml as e, formatWon, formatMonth } from "../src/lib/format.js";

const app = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
const store = await readFile(new URL("../src/lib/firebase-store.js", import.meta.url), "utf8");
const rules = await readFile(new URL("../firestore.rules", import.meta.url), "utf8");
const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");
const teacher = { id: "synthetic", name: "가상강사", incomeComposition: "mixed", defaultEmployeePay: 3200000,
  businessRates: [{ id: "rate", hourlyRate: 50000 }] };
const input = { businessWorkLines: [{ id: "work", rateId: "rate", hourlyRate: 50000, hours: 10 }],
  additionalEarnings: [{ id: "extra", label: "가상 강연료", amount: 200000, treatment: "other" }],
  employeeIncomeTax: 50000, employeeLocalTax: 5000, custom: 10000 };
const calc = (overrides = input, reference = true) => calculatePayroll(createMonthlyEarningLines(teacher, "2026-09", overrides), demoPolicy,
  { ...overrides, ...(reference ? { employeeTaxMode: "admin-reference" } : {}) });
function sourceFor(name, source = app) {
  const pattern = new RegExp(`(?:async )?function ${name}\\(`);
  const start = source.search(pattern);
  assert.ok(start >= 0, name);
  const rest = source.slice(start);
  const end = rest.search(/\r?\n\s*(?:async )?function /);
  return end < 0 ? rest : rest.slice(0, end);
}

test("employee income and local taxes become references while insurance, business and other deductions stay intact", () => {
  const previous = calc(input, false), next = calc();
  assert.equal(next.gross, previous.gross);
  assert.equal(next.deductions.employeeIncomeTax, 0);
  assert.equal(next.deductions.employeeLocalTax, 0);
  assert.equal(next.adminTaxReference.employeeIncomeTax, 50000);
  assert.equal(next.adminTaxReference.employeeLocalTax, 5000);
  assert.equal(next.net, previous.net + 55000);
  assert.equal(next.totalDeductions, previous.totalDeductions - 55000);
  for (const key of ["nationalPension", "healthInsurance", "longTermCare", "employmentInsurance", "businessIncomeTax", "businessLocalTax", "otherIncomeTax", "otherLocalTax", "custom"]) {
    assert.equal(next.deductions[key], previous.deductions[key], key);
  }
  assert.equal(next.reporting.employeeIncomeTax, 0);
  assert.equal(next.reporting.employeeLocalTax, 0);
  assert.equal(next.reporting.taxTotal, previous.reporting.taxTotal - 55000);
});

test("automatic references and explicit zero overrides retain their values without deductions", () => {
  for (const values of [{}, { employeeIncomeTax: 0, employeeLocalTax: 0 }, { employeeIncomeTax: 73456, employeeLocalTax: 1234 }]) {
    const previous = calc(values, false), next = calc(values);
    assert.equal(next.adminTaxReference.employeeIncomeTax, previous.deductions.employeeIncomeTax);
    assert.equal(next.adminTaxReference.employeeLocalTax, previous.deductions.employeeLocalTax);
    assert.equal(next.net - previous.net, previous.deductions.employeeIncomeTax + previous.deductions.employeeLocalTax);
  }
});

test("Excel R/S are references but H/L, manual insurance and other deductions remain payable deductions", () => {
  for (const taxFields of [{}, { excelLectureWithholding: 44444 }, { excelAdditionalWithholding: 7777 }, { excelLectureWithholding: 44444, excelAdditionalWithholding: 7777 }]) {
    const override = { ...input, excelPay: { employeeIncomeTax: 12345, employeeLocalTax: 1234, nationalPension: 99999, ...taxFields } };
    const previous = calc(override, false), next = calc(override);
    assert.equal(next.net, previous.net + 13579);
    assert.equal(next.adminTaxReference.employeeIncomeTax, 12345);
    assert.equal(next.deductions.nationalPension, 99999);
    assert.equal(next.reporting.lectureWithholding, previous.reporting.lectureWithholding);
    assert.equal(next.reporting.additionalPaymentWithholding, previous.reporting.additionalPaymentWithholding);
    const documents = splitPayrollByIncome(next, demoPolicy);
    assert.equal(documents.reduce((sum, doc) => sum + doc.payroll.net, 0), next.net);
    assert.equal(documents.reduce((sum, doc) => sum + doc.payroll.totalDeductions, 0), next.totalDeductions);
    assert.equal(documents.reduce((sum, doc) => sum + doc.payroll.adminTaxReference.employeeIncomeTax, 0), 12345);
  }
});

test("mixed documents preserve reference amounts only on employee document and never reintroduce deducted taxes", () => {
  const payroll = calc();
  const documents = splitPayrollByIncome(payroll, demoPolicy);
  assert.equal(documents.length, 2);
  for (const doc of documents) {
    assert.equal(doc.payroll.deductions.employeeIncomeTax, 0);
    assert.equal(doc.payroll.deductions.employeeLocalTax, 0);
    assert.equal(doc.payroll.adminTaxReference.employeeIncomeTax, doc.incomeType === "employee" ? 50000 : 0);
  }
  assert.equal(documents.reduce((sum, doc) => sum + doc.payroll.net, 0), payroll.net);
  assert.equal(documents.reduce((sum, doc) => sum + doc.payroll.totalDeductions, 0), payroll.totalDeductions);
});

test("public calculation excludes admin references without mutating the frozen private calculation", () => {
  const privateCalculation = calc();
  const before = structuredClone(privateCalculation);
  const visible = publicPayslipCalculation(privateCalculation);
  assert.equal(Object.hasOwn(visible, "adminTaxReference"), false);
  assert.equal(visible.net, privateCalculation.net);
  assert.equal(visible.employeeTaxMode, "admin-reference");
  assert.deepEqual(privateCalculation, before);
  for (const doc of splitPayrollByIncome(visible, demoPolicy)) {
    assert.equal(doc.payroll.deductions.employeeIncomeTax, 0);
    assert.equal(doc.payroll.adminTaxReference?.employeeIncomeTax || 0, 0);
  }
});

test("publication atomically saves references only in the existing admin-only version document", async () => {
  const writes = [];
  let committed = false;
  const batch = { set: (path, value) => writes.push({ path, value }), commit: async () => { committed = true; } };
  const publish = runInNewContext(`${sourceFor("publishPayrollRun", store)}\npublishPayrollRun`, {
    db: {}, auth: { currentUser: { uid: "admin-demo" } }, publicPayslipCalculation,
    firestoreSdk: { writeBatch: () => batch, doc: (_db, collection, id) => `${collection}/${id}`, serverTimestamp: () => "timestamp" }
  });
  const payroll = calc();
  await publish({ month: "2026-09", revision: 1 }, [{ id: "p", versionId: "pv", data: { calculation: payroll } }], { id: "audit", data: {} });
  assert.equal(committed, true);
  assert.equal(Object.hasOwn(writes.find(w => w.path === "payslips/p").value.calculation, "adminTaxReference"), false);
  assert.equal(writes.find(w => w.path === "payslipVersions/pv").value.calculation.adminTaxReference.employeeIncomeTax, 50000);
  assert.match(rules.slice(rules.indexOf("match /payslipVersions/"), rules.indexOf("match /payrollCancellations/")), /allow read: if isAdmin\(\)/);
});

test("only admin workspace retrieves current-revision references and historic issued payroll stays unchanged", () => {
  const privateCalculation = calc(), publicCalculation = publicPayslipCalculation(privateCalculation);
  const saved = { month: "2026-09", teacherId: "synthetic", revision: 2, calculation: publicCalculation };
  const state = { data: { payslipVersions: [{ id: payslipVersionId(saved.month, saved.teacherId, 2), calculation: privateCalculation }] } };
  for (const admin of [true, false]) {
    const read = runInNewContext(`${sourceFor("publishedPayrollCalculation")}\npublishedPayrollCalculation`, { state, payslipVersionId, isAdminWorkspace: () => admin });
    assert.equal(read(saved), admin ? privateCalculation : publicCalculation);
    const old = calc(input, false);
    assert.equal(read({ ...saved, calculation: old }), old);
    assert.equal(read({ ...saved, revision: 3 }), publicCalculation);
  }
});

test("reference panel is admin-only and excluded from printable payslip content", () => {
  for (const admin of [true, false]) {
    const render = runInNewContext(`${sourceFor("adminTaxReferencePanel")}\nadminTaxReferencePanel`, {
      isAdminWorkspace: () => admin, e, formatMonth, formatWon, runForMonth: () => ({ status: "published" })
    });
    const html = render(teacher, "2026-09", calc());
    if (admin) for (const value of ["50,000원", "5,000원", "55,000원", "급여 공제 제외", "발행 당시 참고액", "계산 기준"]) assert.ok(html.includes(value), value);
    else assert.equal(html, "");
  }
  assert.doesNotMatch(sourceFor("payslipSheet"), /adminTaxReference|admin-tax-reference/);
  assert.match(css.slice(css.indexOf("@media print")), /\.admin-tax-reference\s*\{ display: none !important/);
  for (const name of ["payrollForTeacher", "teacherInsuranceEstimate", "excelCalculation"]) assert.match(sourceFor(name), /employeeTaxMode: "admin-reference"/);
});
