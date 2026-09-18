import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { retirementId, retirementBasis, retirementEstimate, buildRetirementConfirmation } from "../src/lib/retirement.js";
import { escapeHtml, formatWon, formatMonth } from "../src/lib/format.js";
import { excelSnapshot } from "../src/lib/payroll-excel-state.js";

const lines = [
  { subjectName: "Salary", earningCategory: "employeeSalary", kind: "monthly", treatment: "employee", amount: 2000000 },
  { subjectName: "Hourly", earningCategory: "lectureFee", kind: "hourly-business", treatment: "business", amount: 300000 },
  { subjectName: "Share", earningCategory: "lectureFee", kind: "tuition-share-business", treatment: "business", amount: 100000 },
  { subjectName: "Transport", earningCategory: "transport", kind: "unit", treatment: "exempt", amount: 120000 },
  { subjectName: "Other", earningCategory: "otherPayment", kind: "monthly", treatment: "employee", amount: 12000 },
  { subjectName: "Receipt", earningCategory: "parking", source: "approved-expense-receipt", treatment: "business", amount: 12000 }
];
const payslip = { id: "2026-09_sample", teacherId: "sample", month: "2026-09", revision: 2, status: "published",
  calculation: { earningLines: lines, net: 100, totalDeductions: 1234 } };
function input(extra = {}) {
  return { teacherId: "sample", month: "2026-09", payslip, basis: retirementBasis(payslip.calculation, () => "Saved basis"),
    actualAmount: "200000", paidOn: "2026-10-05", reviewed: true, ...extra };
}

test("DC estimate includes pay and fees regardless of tax label; expenses require review", () => {
  const before = structuredClone(payslip);
  const basis = retirementBasis(payslip.calculation);
  assert.deepEqual(basis.map((line) => line.included), [true, true, true, false, false, false]);
  assert.deepEqual(retirementEstimate(basis), { baseAmount: 2400000, expectedAmount: 200000 });
  basis[3].included = true;
  assert.equal(retirementEstimate(basis).expectedAmount, 210000);
  assert.deepEqual(payslip, before);
});

test("integer ceiling handles zero, one won, two million and large bases", () => {
  for (const [amount, expected] of [[0, 0], [1, 1], [12, 1], [13, 2], [2000000, 166667], [10000000000, 833333334]]) {
    assert.equal(retirementEstimate([{ amount, included: true }]).expectedAmount, expected);
  }
  for (const amount of [-1, 1.1, Infinity, NaN, 10000000001, "2000000"]) {
    assert.throws(() => retirementEstimate([{ amount, included: true }]));
  }
  assert.throws(() => retirementEstimate([{ amount: 10000000000, included: true }, { amount: 1, included: true }]));
});

test("confirmation retains the reviewed line snapshot without mutating pay", () => {
  const request = input();
  const before = structuredClone(request);
  const saved = buildRetirementConfirmation(request);
  assert.equal(saved.actualAmount, 200000);
  assert.equal(saved.sourceRevision, 2);
  assert.equal(saved.revision, 1);
  assert.equal(saved.basis[0].calculation, "Saved basis");
  assert.deepEqual(request, before);
  request.basis[0].included = false;
  assert.equal(saved.basis[0].included, true);
});

test("blank, invalid amount and invalid date cannot become a zero payment", () => {
  for (const actualAmount of ["", "  ", null, undefined, false, true, [], {}, "x", -1, 0.5, Infinity]) {
    assert.throws(() => buildRetirementConfirmation(input({ actualAmount })));
  }
  for (const paidOn of ["2026-02-30", "2026-00-05", "bad", ""]) {
    assert.throws(() => buildRetirementConfirmation(input({ paidOn })));
  }
  assert.equal(buildRetirementConfirmation(input({ actualAmount: "0", note: "Not paid yet" })).actualAmount, 0);
});

test("basis changes and payment differences need an explanation", () => {
  const basis = retirementBasis(payslip.calculation);
  basis[3].included = true;
  assert.throws(() => buildRetirementConfirmation(input({ basis })), /메모/);
  const saved = buildRetirementConfirmation(input({ basis, note: "Transport is fixed wage" }));
  assert.equal(saved.expectedAmount, 210000);
  assert.equal(saved.basis[3].reason, "관리자 검토 후 변경");
  assert.throws(() => buildRetirementConfirmation(input({ actualAmount: "190000" })), /메모/);
  assert.throws(() => buildRetirementConfirmation(input({ reviewed: false })), /확인/);
});

test("only published combined pay for the same teacher and month can be confirmed", () => {
  for (const change of [{ status: "draft" }, { status: "cancelled" }, { teacherId: "other" }, { month: "2026-08" }, { incomeType: "employee" }]) {
    assert.throws(() => buildRetirementConfirmation(input({ payslip: { ...payslip, ...change } })));
  }
  const basis = retirementBasis(payslip.calculation);
  basis[0].amount = 1;
  assert.throws(() => buildRetirementConfirmation(input({ basis })));
  assert.throws(() => retirementId("2026-13", "sample"));
  assert.throws(() => retirementId("2026-09", "sample/other"));
});

test("corrections advance a revision and require a reason", () => {
  const previous = buildRetirementConfirmation(input());
  assert.throws(() => buildRetirementConfirmation(input({ previous })), /정정 사유/);
  const corrected = buildRetirementConfirmation(input({ previous, correctionReason: "Correct bank amount", actualAmount: 199999, note: "Bank payment differs" }));
  assert.equal(corrected.revision, 2);
  assert.equal(previous.actualAmount, 200000);
});

test("admin-only retirement data stays out of the teacher workspace, payslips and payroll math", async () => {
  const app = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
  const store = await readFile(new URL("../src/lib/firebase-store.js", import.meta.url), "utf8");
  const payroll = await readFile(new URL("../src/lib/payroll.js", import.meta.url), "utf8");
  const source = (name) => { const start = app.indexOf(`function ${name}(`); assert.ok(start >= 0, name); return app.slice(start).split(/\r?\n(?:async )?function /)[0]; };
  assert.match(source("retirementPanel"), /if \(!isAdminWorkspace\(\)\) return/);
  assert.match(source("openRetirementModal"), /if \(!isAdminWorkspace\(\)\) return/);
  assert.match(source("openRetirementModal"), /type="number" class="money-input"/);
  assert.doesNotMatch(source("payslipSheet"), /retirement|퇴직연금/);
  assert.doesNotMatch(source("renderProfile"), /retirement|퇴직연금/);
  const load = store.slice(store.indexOf("async function loadWorkspace("), store.indexOf("async function saveDocument("));
  assert.doesNotMatch(load, /retirementSettings|retirementContributions/);
  assert.doesNotMatch(payroll, /retirement|퇴직연금/);
});

test("dialogs preserve reviewed inclusions on correction, show frozen history and gate draft confirmation", async () => {
  const app = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
  const source = (name) => {
    const start = app.indexOf(`function ${name}(`);
    assert.ok(start >= 0, name);
    return app.slice(start).split(/\r?\n(?:async )?function /)[0];
  };
  const previous = buildRetirementConfirmation(input({
    basis: retirementBasis(payslip.calculation).map((line, i) => ({ ...line, included: i === 3 || line.included })),
    note: "Transport is wage"
  }));
  previous.confirmedName = "Admin";
  let html, submit;
  const context = {
    e: escapeHtml, formatWon, formatMonth, formatDateTime: () => "Time", structuredClone,
    retirementId, retirementBasis, retirementEstimate, buildRetirementConfirmation, excelSnapshot,
    DC_GUIDANCE_URL: "https://www.moel.go.kr/", isAdminWorkspace: () => true,
    teacherById: () => ({ id: "sample", name: "Sample" }),
    runForMonth: () => ({ status: "published", revision: 2 }),
    payrollForTeacher: () => ({ payroll: payslip.calculation }), earningBasisLabel: () => "Basis",
    artifactRevision: (value) => value?.revision || 1,
    state: { store: null, data: { payslips: [payslip] }, retirementCache: { sample: { settings: { enabled: true }, records: [previous] } } },
    openModal: (_title, content, label) => { html = content; submit = label; },
    elements: { modalRoot: { querySelectorAll: () => [], querySelector: () => null } },
    showError: (error) => { throw error; }
  };
  context.retirementBasisHtml = runInNewContext(`${source("retirementBasisHtml")}\nretirementBasisHtml`, context);
  const open = runInNewContext(`async ${source("openRetirementModal")}\nopenRetirementModal`, context);
  await open("sample", "2026-09", true);
  assert.equal(submit, "정정 확정");
  assert.match(html, /data-retirement-include="3"[^>]*checked/);
  assert.match(html, /2,520,000원 ÷ 12 = 210,000원/);
  context.state.data.payslips = [{ ...payslip, status: "cancelled", calculation: { earningLines: Array(201).fill(lines[0]) } }];
  await open("sample", "2026-09", false, previous);
  assert.equal(submit, null);
  assert.match(html, /확정 당시의 기록/);
  assert.match(html, /2,520,000원 ÷ 12 = 210,000원/);
  context.state.retirementCache.sample.records = [];
  await open("sample", "2026-09");
  assert.equal(submit, null);
  assert.doesNotMatch(html, /id="retirement-confirm-form"/);
});
