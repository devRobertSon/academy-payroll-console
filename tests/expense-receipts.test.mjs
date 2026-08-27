import test from "node:test";
import assert from "node:assert/strict";

import {
  approvedReceiptEarnings,
  approvedReceiptTotals,
  expenseReceiptNotificationId,
  unreadExpenseReceiptNotifications,
  validateExpenseReceiptDraft,
  validateReceiptFile
} from "../src/lib/expense-receipts.js";
import { createMonthlyEarningLines, getMonthlyPayAmounts } from "../src/lib/payroll.js";

const receipts = [
  { id: "r1", teacherId: "t1", month: "2026-08", category: "transport", amount: 12500, status: "approved", treatment: "exempt" },
  { id: "r2", teacherId: "t1", month: "2026-08", category: "parking", amount: 8000, status: "approved", treatment: "employee", insuranceCovered: true },
  { id: "r3", teacherId: "t1", month: "2026-08", category: "transport", amount: 5000, status: "pending" },
  { id: "r4", teacherId: "t2", month: "2026-08", category: "transport", amount: 7000, status: "approved", treatment: "exempt" }
];

test("approvedReceiptTotals includes only approved receipts for the teacher and month", () => {
  assert.deepEqual(approvedReceiptTotals(receipts, "t1", "2026-08"), {
    transport: 12500,
    parking: 8000,
    total: 20500
  });
});

test("approvedReceiptEarnings preserves accounting treatment for payroll", () => {
  assert.deepEqual(approvedReceiptEarnings(receipts, "t1", "2026-08"), [
    { id: "r1", category: "transport", amount: 12500, treatment: "exempt", insuranceCovered: false, expenseDate: null },
    { id: "r2", category: "parking", amount: 8000, treatment: "employee", insuranceCovered: true, expenseDate: null }
  ]);
});

test("receipt notification helpers isolate unread receipt submissions", () => {
  assert.equal(expenseReceiptNotificationId("abc"), "expense-receipt_abc");
  assert.deepEqual(unreadExpenseReceiptNotifications([
    { id: "a", type: "expense_receipt_submitted", status: "unread" },
    { id: "b", type: "expense_receipt_submitted", status: "read" },
    { id: "c", type: "teacher_monthly_input_submitted", status: "unread" }
  ]).map((item) => item.id), ["a"]);
});

test("receipt draft and file validation enforce bounded inputs", () => {
  assert.equal(validateExpenseReceiptDraft({
    month: "2026-08",
    expenseDate: "2026-08-27",
    category: "parking",
    amount: 1,
    note: ""
  }), null);
  assert.match(validateExpenseReceiptDraft({ month: "2026-08", expenseDate: "2026-08-27", category: "parking", amount: 0 }), /금액/);
  assert.equal(validateReceiptFile({ type: "application/pdf", size: 1024 }), null);
  assert.match(validateReceiptFile({ type: "image/gif", size: 1024 }), /JPG/);
  assert.match(validateReceiptFile({ type: "image/jpeg", size: 6 * 1024 * 1024 }), /5MB/);
});

test("approved transport and parking receipts add to manual monthly amounts without replacing them", () => {
  const teacher = {
    id: "t1",
    incomeComposition: "employee",
    defaultEmployeePay: 2000000,
    insuranceSettings: {},
    transportPolicy: { unitAmount: 1500, treatment: "exempt" }
  };
  const override = {
    transportTrips: 4,
    parkingAmount: 10000,
    parkingTreatment: "exempt",
    approvedReceiptEarnings: [
      { id: "r1", category: "transport", amount: 7000, treatment: "exempt" },
      { id: "r2", category: "parking", amount: 9000, treatment: "employee" }
    ]
  };
  const amounts = getMonthlyPayAmounts(teacher, override);
  assert.equal(amounts.manualTransportAmount, 6000);
  assert.equal(amounts.receiptTransportAmount, 7000);
  assert.equal(amounts.transportAmount, 13000);
  assert.equal(amounts.manualParkingAmount, 10000);
  assert.equal(amounts.receiptParkingAmount, 9000);
  assert.equal(amounts.parkingAmount, 19000);

  const lines = createMonthlyEarningLines(teacher, "2026-08", override);
  assert.equal(lines.filter((line) => line.earningCategory === "transport").length, 2);
  assert.equal(lines.filter((line) => line.earningCategory === "parking").length, 2);
  assert.equal(lines.find((line) => line.expenseReceiptId === "r2").treatment, "employee");
});
