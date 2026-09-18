import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { EXCEL_PAY_FIELDS } from "../src/lib/payroll-excel-state.js";
import { escapeHtml } from "../src/lib/format.js";

const app = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
const styles = await readFile(new URL("../styles.css", import.meta.url), "utf8");
const inputs = [...app.matchAll(/<input\b[^\n]*?\/>/g)].map(([input]) => input);
const numericInputs = inputs.filter((input) => input.includes('type="number"'));

test("all monetary inputs hide spinners without changing hours, counts, dates or percentages", () => {
  const nonMoneyNames = new Set([
    "employeeWorkHours", "transportTrips", "paymentDay", "transportPaymentDay",
    "${e(prefix)}-tuition-share-rate", "businessIncomeTaxRate", "localIncomeTaxRatio",
    "otherExpenseRate", "otherIncomeTaxRate", "pensionRate", "healthRate",
    "longTermCareRate", "employmentRate"
  ]);
  let moneyCount = 0;
  let nonMoneyCount = 0;
  for (const input of numericInputs) {
    const name = input.match(/\bname="([^"]+)"/)?.[1];
    if (name === "${key}") continue;
    const nonMoney = nonMoneyNames.has(name)
      || /\bdata-(?:business-hour|work-hours|work-share)\b/.test(input)
      || input.includes('data-choice="employeeWorkHours"');
    assert.equal(input.includes('class="money-input"'), !nonMoney, input);
    if (nonMoney) nonMoneyCount++;
    else moneyCount++;
  }
  assert.ok(moneyCount >= 30);
  assert.ok(nonMoneyCount >= 15);
  for (const input of inputs.filter((input) => input.includes('type="date"'))) {
    assert.doesNotMatch(input, /money-input/);
  }
});

test("money styles target number spinners in Firefox and WebKit without removing focus styling", () => {
  assert.match(styles, /input\.money-input\[type="number"\] \{[^}]*-moz-appearance: textfield;[^}]*appearance: textfield;/);
  assert.match(styles, /input\.money-input\[type="number"\]::-webkit-inner-spin-button,\s*input\.money-input\[type="number"\]::-webkit-outer-spin-button \{ -webkit-appearance: none; margin: 0; \}/);
  for (const rule of styles.matchAll(/([^{}]+)\{([^{}]*(?:appearance|spin-button)[^{}]*)\}/g)) {
    assert.match(rule[1], /money-input/);
    assert.doesNotMatch(rule[2], /outline|pointer-events|display|visibility/);
  }
});

test("salary, hourly rate and receipt inputs retain numeric limits and steps", () => {
  for (const input of numericInputs.filter((input) => input.includes('name="defaultEmployeePay"') || input.includes("data-rate-hourly"))) {
    assert.match(input, /min="0"/);
    assert.match(input, /step="1"/);
  }
  const receipt = numericInputs.find((input) => input.includes('id="receipt-amount"'));
  assert.match(receipt, /min="1" max="10000000" step="1"/);
  assert.match(receipt, /inputmode="numeric" required/);
});

test("Excel direct input renders money-only styling and preserves values and validation", () => {
  const start = app.indexOf("function openExcelPayModal(");
  const end = app.indexOf("\nfunction openMonthlyPayModal(", start);
  assert.ok(start >= 0 && end > start);
  let html;
  const context = {
    EXCEL_PAY_FIELDS, e: escapeHtml,
    state: { month: "2026-09", data: { overrides: { "2026-09:demo": {
      excelPay: { employeeGrossPay: 2000000, businessGrossPay: 0, businessHours: 2.5 }
    } } } },
    excelExpectedState: () => ({}),
    monthlyPayAmounts: () => ({ transportTreatment: "pending" }),
    treatmentOptions: () => "",
    openModal: (_title, content) => { html = content; }
  };
  runInNewContext(`${app.slice(start, end)}\nopenExcelPayModal({ id: "demo", name: "Demo", incomeComposition: "mixed" });`, context);
  const renderedInputs = [...html.matchAll(/<input\b[^>]*>/g)].map(([input]) => input);
  for (const key of Object.keys(EXCEL_PAY_FIELDS)) {
    const input = renderedInputs.find((item) => item.includes(`name="${key}"`));
    assert.ok(input, key);
    const hours = key === "employeeWorkHours" || key === "businessHours";
    const nonMoney = hours || key === "transportTrips";
    assert.equal(input.includes('class="money-input"'), !nonMoney, key);
    assert.match(input, /type="number"/);
    assert.match(input, /min="0"/);
    assert.ok(input.includes(`max="${nonMoney ? 10000 : 10000000000}"`), key);
    assert.ok(input.includes(`step="${hours ? "0.01" : "1"}"`), key);
    const expectedValue = { employeeGrossPay: "2000000", businessGrossPay: "0", businessHours: "2.5" }[key] ?? "";
    assert.ok(input.includes(`value="${expectedValue}"`), key);
  }
});
