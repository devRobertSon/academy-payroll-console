import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { calculateTuitionShare, isTuitionShare, tuitionBasis, calculatePayroll, createMonthlyEarningLines } from "../src/lib/payroll.js";
import { submittedTuitionBasis } from "../src/lib/teacher-self-service.js";
import { escapeHtml as e, formatNumber, formatWon, formatHours, formatMonth } from "../src/lib/format.js";
import { demoPolicy } from "../src/data/demo-data.js";

const app = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
const rules = await readFile(new URL("../firestore.rules", import.meta.url), "utf8");
const shared = { e, formatNumber, formatWon, formatHours, formatMonth, calculateTuitionShare, isTuitionShare, tuitionBasis, submittedTuitionBasis };

function sourceFor(name) {
  const start = app.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  const remaining = app.slice(start);
  const next = remaining.search(/\r?\n(?:async )?function /);
  return next < 0 ? remaining : remaining.slice(0, next);
}

function load(name, context = {}) {
  return runInNewContext(`${sourceFor(name)}\n${name}`, { ...shared, ...context });
}

function editor(value, valid = true) {
  const input = { value, validity: { valid } };
  return { querySelector: (selector) => {
    assert.equal(selector, "[data-tuition-amount]");
    return input;
  } };
}

test("총액 편집기는 한 칸만 표시하고 과거 인원별 데이터는 합계로 연다", () => {
  const render = load("tuitionAmountEditorHtml");
  for (const [line, value] of [
    [{}, ""], [{ tuitionAmount: null }, ""], [{ tuitionAmount: 0 }, "0"],
    [{ tuitionAmount: 5000000 }, "5000000"],
    [{ tuitionGroups: [{ studentCount: 10, tuitionPerStudent: 300000 }, { studentCount: 5, tuitionPerStudent: 400000 }] }, "5000000"]
  ]) {
    const html = render(line);
    assert.equal((html.match(/<input /g) || []).length, 1);
    assert.match(html, new RegExp(`value="${value}"`));
    assert.match(html, /aria-label="해당 수업 전체 학원비"/);
    assert.doesNotMatch(html, /학생 수|1인당|항목 추가|data-student/);
  }
});

test("총액 편집기의 빈 칸·0원·큰 금액과 비정상 숫자를 구분한다", () => {
  const read = load("readTuitionEditor");
  assert.equal(read(editor("")).tuitionAmount, null);
  assert.equal(read(editor("")).tuitionPending, true);
  assert.equal(read(editor("0")).tuitionPending, false);
  assert.equal(read(editor("10000000000")).tuitionAmount, 10000000000);
  for (const value of ["-1", "0.5", "10000000001", "NaN", "Infinity"]) {
    assert.throws(() => read(editor(value)), /전체 학원비/);
  }
  assert.throws(() => read(editor("", false)), /전체 학원비/);
});

test("관리자 월 지급액 저장은 학생 수 없이 총액과 비율만 기록한다", () => {
  const readTuitionEditor = load("readTuitionEditor");
  for (const value of ["", "0", "5000000"]) {
    const row = {
      dataset: { lineId: "share", rateId: "share" },
      hasAttribute: (name) => name === "data-tuition-share",
      querySelector: (selector) => selector === "[data-tuition-editor]" ? editor(value) : { value: "40" }
    };
    const read = load("readBusinessWorkLines", { readTuitionEditor, document: { querySelectorAll: () => [row] } });
    const [line] = read("#monthly-business-work");
    assert.deepEqual(JSON.parse(JSON.stringify(line)), {
      id: "share", rateId: "share", tuitionAmount: value === "" ? null : Number(value), tuitionShareRate: 40, hours: 0
    });
  }
});

test("새 명세서 산정 기준은 수업 전체 학원비를, 과거 명세서는 당시 근거를 표시한다", () => {
  const label = load("earningBasisLabel");
  assert.equal(label({ tuitionAmount: 5000000, tuitionShareRate: 40 }), "해당 수업 전체 학원비 5,000,000원 × 40%");
  assert.equal(label({ tuitionGroups: [{ studentCount: 10, tuitionPerStudent: 300000 }], tuitionShareRate: 40 }), "(10명 × 300,000원) × 40%");
});

test("회계사용 CSV에도 전체 학원비와 약정 비율의 산정 근거가 포함된다", () => {
  const teacher = { id: "demo", name: "가상강사", incomeComposition: "business", businessRates: [{ id: "share", tuitionShareRate: 40 }] };
  const payroll = calculatePayroll(createMonthlyEarningLines(teacher, "2026-09", {
    businessWorkLines: [{ id: "share", rateId: "share", tuitionShareRate: 40, tuitionAmount: 5000000 }]
  }), demoPolicy);
  let exported;
  load("exportLedger", {
    state: { month: "2026-09" },
    ledgerItemsForMonth: () => [{ teacher, payroll, incomeLabel: "사업소득" }],
    accountingReportFor: (value) => value.reporting,
    insuranceBasesFor: () => ({ nationalPension: 0, healthInsurance: 0, employmentInsurance: 0 }),
    formatMobilePhoneNumber: () => "",
    formatTeacherIdentity: () => "",
    earningBasisLabel: load("earningBasisLabel"),
    downloadCsv: (_name, rows) => { exported = rows; },
    showToast() {}
  })();
  assert.equal(exported[1][exported[0].indexOf("강사료 산정 기준")], "해당 수업 전체 학원비 5,000,000원 × 40%");
  assert.equal(exported[1][exported[0].indexOf("실 지급액")], 1934000);
});

test("선생님 입력과 관리자 제출 비교에 이전 groups 배열이 필수로 남지 않는다", () => {
  const teacherScreen = sourceFor("renderWorkHours");
  assert.match(teacherScreen, /tuitionAmountEditorHtml\(submittedTuitionBasis\(submittedTuition\)\)/);
  assert.match(teacherScreen, /tuitionAmount: readTuitionEditor/);
  assert.doesNotMatch(app, /submittedTuition\.groups\.length|tuitionSubmission\.groups|data-student-count|data-student-tuition/);
  assert.match(app, /정산 대상 학원비가 없는 달은 0원을 입력/);
});

test("규칙은 총액 형식과 기존 형식을 구별하고 소유 비율·미확정 월 제한을 유지한다", () => {
  const total = rules.slice(rules.indexOf("function validTuitionTotal("), rules.indexOf("function validLegacyTuitionSubmission("));
  assert.match(total, /hasOnly\(\['rateId', 'tuitionAmount'\]\)/);
  assert.match(total, /hasAll\(\['rateId', 'tuitionAmount'\]\)/);
  assert.match(total, /input\.tuitionAmount == null/);
  assert.match(total, /input\.tuitionAmount is int/);
  assert.match(total, /input\.tuitionAmount >= 0/);
  assert.match(total, /input\.tuitionAmount <= 10000000000/);
  const legacy = rules.slice(rules.indexOf("function validLegacyTuitionSubmission("), rules.indexOf("match /teacherMonthlyInputs/"));
  assert.match(legacy, /hasOnly\(\['rateId', 'groups'\]\)/);
  assert.match(legacy, /validTuitionGroupAt\(data\.tuitionInput\.groups, 9\)/);
  const submission = rules.slice(rules.indexOf("function hasValidTuitionSubmission("), rules.indexOf("function validTuitionTotal("));
  assert.match(submission, /ownsTuitionRate\(data\.teacherId, data\.tuitionInput\.rateId\)/);
  const access = rules.slice(rules.indexOf("match /teacherMonthlyInputs/"), rules.indexOf("match /expenseReceipts/"));
  for (const condition of [
    "request.resource.data.teacherId == account().teacherId",
    "request.resource.data.teacherUid == request.auth.uid",
    "hasValidTuitionSubmission(request.resource.data)",
    "monthIsEditable(request.resource.data.month)"
  ]) assert.ok(access.includes(condition), condition);
});
