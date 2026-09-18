import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { isTuitionShare, tuitionBasis, TREATMENT_LABELS } from "../src/lib/payroll.js";
import { escapeHtml as e, formatNumber, formatWon, formatHours, formatMonth } from "../src/lib/format.js";

const app = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
function sourceFor(name) {
  const start = app.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  const remaining = app.slice(start);
  const next = remaining.search(/\r?\n(?:async )?function /);
  return next < 0 ? remaining : remaining.slice(0, next);
}
const context = {
  e, formatNumber, formatWon, formatHours, formatMonth, isTuitionShare, tuitionBasis, TREATMENT_LABELS,
  appConfig: { academyName: "샘플학원" },
  deductionLabels: () => ({ employeeIncomeTax: "근로소득세" }),
  insuranceBasesFor: () => ({ nationalPension: 0 })
};
const render = runInNewContext(`${sourceFor("earningBasisLabel")}\n${sourceFor("payslipSheet")}\npayslipSheet`, context);
const fixedLine = { kind: "monthly", subjectName: "기본급", treatment: "employee", amount: 2000000 };
function sheet(lines = [fixedLine], status = "published") {
  const gross = lines.reduce((sum, line) => sum + line.amount, 0);
  return render({ name: "가상강사", paymentDay: 10 }, {
    earningLines: lines, deductions: { employeeIncomeTax: 10000 }, gross,
    totalDeductions: 10000, net: gross - 10000,
    taxPolicyVersion: "test-tax", insurancePolicyVersion: "test-insurance"
  }, "2026-09", { status, revision: 2 }, "근로소득");
}
function paymentTable(html) {
  return html.slice(html.indexOf("<h3>지급 내역</h3>"), html.indexOf("<h3>공제 내역</h3>"));
}

test("확정 명세서는 발행 상태 없이 성명·지급일·총액과 공제 내역을 유지한다", () => {
  const html = sheet();
  assert.doesNotMatch(html, /발행 상태|차 발행 완료|미리보기/);
  for (const text of ["가상강사", "매월 10일", "총 지급액", "2,000,000원", "근로소득세", "10,000", "총 공제액", "실 지급액", "1,990,000원"]) {
    assert.ok(html.includes(text), text);
  }
  const summary = html.slice(html.indexOf('<div class="payslip-summary">'), html.indexOf("<h3>지급 내역</h3>"));
  assert.equal((summary.match(/<strong>/g) || []).length, 2);
});

test("고정 월급·기타 고정액은 산정 기준 열을 생략한다", () => {
  const html = paymentTable(sheet([
    { ...fixedLine, workHours: 20 },
    { kind: "monthly", subjectName: "기타 지급", amount: 50000, treatment: "business" },
    { kind: "monthly", source: "excel-direct", subjectName: "직접 입력", amount: 100000, treatment: "employee" }
  ]));
  assert.doesNotMatch(html, /산정 기준|선생님별 월 지급액|월 직접 입력 금액/);
  assert.equal((html.match(/<th[ >]/g) || []).length, 3);
  for (const row of html.matchAll(/<tr>(<td>.*?)<\/tr>/g)) {
    assert.equal((row[1].match(/<td[ >]/g) || []).length, 3);
  }
});

test("시급·횟수 지급이 있으면 해당 계산식과 열 개수를 유지한다", () => {
  const html = paymentTable(sheet([
    fixedLine,
    { kind: "hourly-business", subjectName: "수업", treatment: "business", hours: 2, hourlyRate: 50000, amount: 100000 },
    { kind: "unit", subjectName: "교통비", treatment: "exempt", hours: 5, hourlyRate: 10000, amount: 50000 }
  ]));
  assert.match(html, /<th>산정 기준<\/th>/);
  assert.match(html, /2시간 × 50,000원/);
  assert.match(html, /5회 × 10,000원/);
  assert.doesNotMatch(html, /선생님별 월 지급액/);
  for (const row of html.matchAll(/<tr>(<td>.*?)<\/tr>/g)) {
    assert.equal((row[1].match(/<td[ >]/g) || []).length, 4);
  }
});

test("비율제와 과거 인원별 비율제 명세서는 당시 계산 근거를 유지한다", () => {
  for (const [basis, expected] of [
    [{ tuitionAmount: 5000000 }, "해당 수업 전체 학원비 5,000,000원 × 40%"],
    [{ tuitionGroups: [{ studentCount: 10, tuitionPerStudent: 500000 }] }, "(10명 × 500,000원) × 40%"]
  ]) {
    const html = sheet([{ kind: "tuition-share-business", subjectName: "비율", treatment: "business", tuitionShareRate: 40, amount: 2000000, ...basis }]);
    assert.ok(html.includes(expected));
    assert.match(html, /<th>산정 기준<\/th>/);
  }
});

test("미확정본은 발행 상태 칸 대신 제목에서 미리보기임을 구별한다", () => {
  for (const status of ["draft", "review", "cancelled"]) {
    const html = sheet([fixedLine], status);
    assert.match(html, /급여명세서 \(미리보기\)<\/h2>/);
    assert.doesNotMatch(html, /발행 상태/);
  }
});

test("명세서 표시 변경은 입력과 발행 기록을 수정하지 않는다", () => {
  const lines = [{ ...fixedLine }];
  const before = structuredClone(lines);
  sheet(lines);
  assert.deepEqual(lines, before);
  assert.match(sourceFor("createCurrentPayslipPdf"), /querySelector\("\.payslip-sheet"\)/);
  assert.match(sourceFor("openPayslipEmailModal"), /createCurrentPayslipPdf\(teacher, payslipDocument\)/);
});

test("PDF 원본 명세서는 기준 버전 문구를 생략하고 계산 기록은 보존한다", () => {
  const payroll = {
    earningLines: [fixedLine], deductions: { employeeIncomeTax: 10000 },
    gross: 2000000, totalDeductions: 10000, net: 1990000,
    taxPolicyVersion: "NTS-2024-02-29", insurancePolicyVersion: "INSURANCE-2026-07"
  };
  const before = structuredClone(payroll);
  for (const status of ["published", "draft"]) {
    const html = render({ name: "가상강사", paymentDay: 10 }, payroll, "2026-09", { status }, "근로소득");
    assert.doesNotMatch(html, /세금 기준|사회보험 기준|NTS-2024-02-29|INSURANCE-2026-07/);
    assert.match(html, /세부 계약 또는 공제 관련 문의는 학원 담당자에게 연락해 주세요/);
    assert.match(html, /1,990,000원/);
  }
  assert.deepEqual(payroll, before);
});
