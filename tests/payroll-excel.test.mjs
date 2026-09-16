import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import vm from "node:vm";
import { buildExcelPay, readPayrollWorkbook, createPayrollWorkbook, matchExcelTeacher, numericCell, excelSummaryWarnings } from "../src/lib/payroll-excel.js";
import { excelSnapshot, validateExcelPay } from "../src/lib/payroll-excel-state.js";
import { calculatePayroll, createMonthlyEarningLines, getMonthlyPayAmounts, splitPayrollByIncome } from "../src/lib/payroll.js";
import { demoPolicy } from "../src/data/demo-data.js";

const module = { exports: {} };
new Function("module", "exports", "require", await readFile(new URL("../vendor/exceljs.min.js", import.meta.url), "utf8"))(module, module.exports, createRequire(import.meta.url));
const ExcelJS = module.exports;
const teacher = { id: "test", name: "테스트강사", phone: "01000000000", email: "teacher@example.invalid", status: "active", incomeComposition: "business", businessRates: [{ id: "hourly", hourlyRate: 50000 }], transportPolicy: { unitAmount: 1500, treatment: "business" } };
const month = "2026-09";
const override = { businessWorkLines: [{ id: "hourly", rateId: "hourly", hours: 20, hourlyRate: 50000 }], transportTrips: 10 };
const row = (values) => ({ number: 5, name: teacher.name, phone: teacher.phone, values, errors: [], hasInputs: true });
const calc = (person = teacher, value = override) => calculatePayroll(createMonthlyEarningLines(person, month, value), demoPolicy, { ...value, month, insuranceSettings: person.insuranceSettings || {} });

test("엑셀 G 직접 금액은 시급 근거를 조작하지 않고 H와 L은 한 번씩 공제한다", () => {
  const excelPay = buildExcelPay(row({ basePay: 1200000, hours: 23, transport: 50000, lectureTax: 40000, additionalTax: 1700 }), teacher, override);
  const result = calc(teacher, { ...override, excelPay });
  assert.equal(result.gross, 1250000);
  assert.equal(result.totalDeductions, 41700);
  assert.equal(result.net, 1208300);
  assert.equal(result.reporting.classHours, 23);
  assert.equal(result.reporting.lectureWithholding, 40000);
  assert.equal(result.reporting.additionalPaymentWithholding, 1700);
  assert.equal(result.deductions.businessIncomeTax, 0);
  assert.equal(result.deductions.businessLocalTax, 0);
  assert.equal(override.businessWorkLines[0].hours, 20);
  assert.equal(calc(teacher, { ...override, excelPay: null }).gross, 1015000);
});

test("부분 세액 입력은 해당 공제만 바꾸고 빈칸과 0원을 구분한다", () => {
  for (const [values, expected] of [[{ lectureTax: 0 }, 495], [{ additionalTax: 0 }, 33000], [{ lectureTax: null, additionalTax: null }, 33495]]) {
    assert.equal(calc(teacher, { ...override, excelPay: buildExcelPay(row(values), teacher, override) }).totalDeductions, expected);
  }
  const current = { ...override, excelPay: { businessGrossPay: 800000 } };
  assert.equal(buildExcelPay(row({ basePay: null }), teacher, current).businessGrossPay, 800000);
  assert.equal(buildExcelPay(row({ basePay: 0 }), teacher, current).businessGrossPay, 0);
});

test("시간·횟수만 입력해도 비어 있는 금액 열의 지급액을 유지한다", () => {
  const direct = buildExcelPay(row({ hours: 1, trips: 1 }), teacher, override);
  const result = calc(teacher, { ...override, excelPay: direct });
  assert.equal(result.gross, calc().gross);
  assert.equal(result.reporting.classHours, 1);
  assert.equal(result.reporting.transportTrips, 1);
});

test("빈 공제는 기존 수동값을 보존하고 자동 공제만 재계산한다", () => {
  const input = row({ basePay: 2000000 });
  const direct = buildExcelPay(input, teacher, override);
  assert.equal(calc(teacher, { ...override, excelPay: direct }).reporting.lectureWithholding, 66000);
  const manual = { ...override, excelPay: { excelLectureWithholding: 30000 } };
  assert.equal(calc(teacher, { ...manual, excelPay: buildExcelPay(input, teacher, manual) }).reporting.lectureWithholding, 30000);
  const health = buildExcelPay(row({ healthInsurance: 100000 }), teacher, override);
  assert.equal(Object.hasOwn(health, "longTermCare"), false);
  assert.ok(calc(teacher, { ...override, excelPay: health }).deductions.longTermCare > 0);
});

test("H 또는 L만 입력한 혼합 명세서에서도 보고용 원천징수 합계가 같다", () => {
  const mixed = { ...teacher, incomeComposition: "mixed", defaultEmployeePay: 2000000 };
  for (const values of [{ lectureTax: 25000 }, { additionalTax: 500 }]) {
    const payroll = calc(mixed, { ...override, excelPay: buildExcelPay(row(values), mixed, override) });
    const documents = splitPayrollByIncome(payroll, demoPolicy);
    for (const key of ["lectureWithholding", "additionalPaymentWithholding"]) assert.equal(documents.reduce((sum, item) => sum + item.payroll.reporting[key], 0), payroll.reporting[key]);
    assert.equal(documents.reduce((sum, item) => sum + item.payroll.net, 0), payroll.net);
  }
});

test("혼합 급여 배분 확인과 명세서 합계 일치", () => {
  const mixed = { ...teacher, incomeComposition: "mixed", defaultEmployeePay: 2000000 };
  const input = row({ basePay: 3500000, hours: 50, transport: 50000, lectureTax: 50000, additionalTax: 2000, employeeIncomeTax: 25000, employeeLocalTax: 2500, healthInsurance: 100000, longTermCare: 13000, nationalPension: 90000, employmentInsurance: 18000 });
  assert.throws(() => buildExcelPay(input, mixed, override), /배분/);
  for (const destination of ["employee", "business"]) {
    const direct = buildExcelPay(input, mixed, override, { allocationConfirmed: true, employeeGrossPay: 2000000, employeeWorkHours: 20, additionalIncomeType: destination });
    const combined = calc(mixed, { ...override, excelPay: direct });
    const split = splitPayrollByIncome(combined, demoPolicy);
    assert.equal(combined.gross, 3550000);
    assert.equal(combined.reporting.classHours, 50);
    assert.equal(split.reduce((sum, item) => sum + item.payroll.net, 0), combined.net);
    assert.equal(split.find((item) => item.incomeType === destination).payroll.deductions.excelAdditionalWithholding, 2000);
    assert.equal(split.reduce((sum, item) => sum + item.payroll.reporting.lectureWithholding, 0), 50000);
  }
});

test("단일 소득 명세서도 직접 입력된 공제를 누락하지 않는다", () => {
  const direct = buildExcelPay(row({ basePay: 1000000, healthInsurance: 12345, employeeIncomeTax: 1200 }), teacher, override);
  const combined = calc(teacher, { ...override, excelPay: direct });
  const documents = splitPayrollByIncome(combined, demoPolicy);
  assert.equal(documents.length, 1);
  assert.equal(documents[0].payroll.net, combined.net);
  assert.equal(documents[0].payroll.deductions.healthInsurance, 12345);
});

test("영수증과 주차비를 중복 합산하지 않는다", () => {
  const current = { ...override, parkingAmount: 10000, parkingTreatment: "exempt", approvedReceiptEarnings: [{ id: "r", category: "transport", amount: 20000, treatment: "exempt" }] };
  const direct = buildExcelPay(row({ transport: 50000, other: 30000 }), teacher, current, { otherTreatment: "business" });
  const amounts = getMonthlyPayAmounts(teacher, { ...current, excelPay: direct });
  assert.equal(amounts.transportAmount, 50000);
  assert.equal(amounts.parkingAmount, 10000);
  assert.equal(amounts.otherPaymentAmount, 20000);
  assert.throws(() => buildExcelPay(row({ transport: 10000 }), teacher, current), /영수증/);
  assert.throws(() => buildExcelPay(row({ other: 5000 }), teacher, current), /주차비/);
});

test("건강보험 한 칸만 입력하면 요양의 현재 금액을 유지한다", () => {
  const direct = buildExcelPay(row({ healthInsurance: 10000 }), teacher, { ...override, healthAndLongTermCare: 50000 }, { currentHealthInsurance: 45000, currentLongTermCare: 5000 });
  const result = calc(teacher, { ...override, healthAndLongTermCare: 50000, excelPay: direct });
  assert.equal(result.deductions.healthInsurance, 10000);
  assert.equal(result.deductions.longTermCare, 5000);
});

test("비율제 직접 금액은 학원비 미입력 대기를 대체하지만 계약은 보존한다", () => {
  const person = { ...teacher, businessRates: [{ id: "share", tuitionShareRate: 40 }] };
  const value = { excelPay: buildExcelPay(row({ basePay: 2000000 }), person, {}) };
  assert.equal(getMonthlyPayAmounts(person, value).tuitionPending, false);
  assert.equal(calc(person, value).gross, 2000000);
  assert.equal(getMonthlyPayAmounts(person, {}).tuitionPending, true);
});

test("이름과 연락처 매칭, 중복·불일치는 선택 대기", () => {
  assert.equal(matchExcelTeacher(row({}), [teacher]), teacher.id);
  assert.equal(matchExcelTeacher({ ...row({}), phone: "01099999999" }, [teacher]), "");
  assert.equal(matchExcelTeacher(row({}), [teacher, { ...teacher, id: "second" }]), "");
  assert.equal(matchExcelTeacher({ ...row({}), phone: "1000000000" }, [teacher]), teacher.id);
});

test("형식 오류·수식 캐시 누락·음수·문자·과대한 값은 0으로 바꾸지 않는다", () => {
  for (const value of [{ formula: "1+2" }, { error: "#VALUE!" }, true, "=1+1", -1, "10원", "1,,2", "12,34", 10000000001, 1.1]) {
    assert.throws(() => numericCell({ address: "G5", value }, "basePay"));
  }
  assert.equal(numericCell({ address: "G5", value: { formula: "1-1", result: 0 } }, "basePay"), 0);
  assert.equal(numericCell({ address: "G5", value: "  " }, "basePay"), null);
  assert.equal(numericCell({ address: "G5", value: "1,000" }, "basePay"), 1000);
  assert.equal(numericCell({ address: "M5", value: -100 }, "net"), -100);
});

test("원본 양식 내보내기와 재불러오기 및 개인정보 열 제외", async () => {
  const book = createPayrollWorkbook(ExcelJS, month, [{ teacher, payroll: calc() }]);
  const sheet = book.worksheets[0];
  for (const col of ["C", "D", "N", "O"]) assert.equal(sheet.getCell(`${col}5`).value, null);
  sheet.getCell("C5").value = "PRIVATE-IDENTITY";
  sheet.getCell("D5").value = "PRIVATE-ADDRESS";
  sheet.getCell("N5").value = "PRIVATE-BANK";
  sheet.getCell("O5").value = "PRIVATE-ACCOUNT";
  const bytes = await book.xlsx.writeBuffer();
  const reloaded = new ExcelJS.Workbook();
  await reloaded.xlsx.load(bytes);
  const parsed = readPayrollWorkbook(reloaded);
  assert.equal(parsed[0].rows.length, 1);
  assert.equal(parsed[0].rows[0].values.basePay, 1000000);
  assert.equal(parsed[0].rows[0].values.reported, 1015000);
  assert.equal(JSON.stringify(parsed).includes("PRIVATE-"), false);
  const direct = buildExcelPay(parsed[0].rows[0], teacher, override);
  const imported = calc(teacher, { ...override, excelPay: direct });
  assert.equal(imported.net, calc().net);
  assert.deepEqual(excelSummaryWarnings(parsed[0].rows[0], imported), []);
  assert.equal(reloaded.worksheets[0].getCell("A1").value, "2026년 9월 강사료");
});

test("신고액 수식만 있는 빈 급여 행은 반영 대상이 아니다", () => {
  const book = createPayrollWorkbook(ExcelJS, month, []);
  book.worksheets[0].getCell("A5").value = "테스트강사";
  book.worksheets[0].getCell("E5").value = { formula: "G5+J5", result: 0 };
  assert.equal(readPayrollWorkbook(book)[0].rows[0].hasInputs, false);
});

test("원본의 보혐료 제목 오타와 수식의 캐시 0을 읽는다", async () => {
  const book = createPayrollWorkbook(ExcelJS, month, [{ teacher, payroll: calc() }]);
  book.worksheets[0].getCell("X3").value = "보혐료 총합";
  const reloaded = new ExcelJS.Workbook();
  await reloaded.xlsx.load(await book.xlsx.writeBuffer());
  const parsed = readPayrollWorkbook(reloaded)[0].rows[0];
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.values.insuranceTotal, 0);
});

test("신고액·지급액·보험료 불일치를 보고한다", () => {
  assert.equal(excelSummaryWarnings(row({ reported: 1, net: 2, insuranceTotal: 3 }), calc()).length, 3);
});

test("직접 입력 허용 항목과 숫자 형식을 제한한다", () => {
  validateExcelPay({ businessGrossPay: 0, healthAndLongTermCare: null });
  for (const direct of [{ businessGrossPay: -1 }, { businessGrossPay: "100" }, { employeeWorkHours: 10001 }, { residentRegistrationNumber: "secret" }, { transportTreatment: "bad" }]) assert.throws(() => validateExcelPay(direct));
});

const storeSource = await readFile(new URL("../src/lib/firebase-store.js", import.meta.url), "utf8");
function importStore(documents) {
  const writes = [];
  const start = storeSource.indexOf("  async function saveMonthlyExcelImport(");
  const end = storeSource.indexOf("  async function publishPayrollRun(", start);
  const operation = vm.runInNewContext(`${storeSource.slice(start, end)}\nsaveMonthlyExcelImport`, {
    excelSnapshot, validateExcelPay, db: {}, auth: { currentUser: { uid: "admin" } }, firestoreSdk: {
      doc: (_db, collection, id) => `${collection}/${id}`, serverTimestamp: () => "server-time",
      runTransaction: async (_db, callback) => callback({
        get: async (id) => ({ exists: () => documents[id] != null, data: () => documents[id] }),
        set: (...args) => writes.push(args)
      })
    }
  });
  return { operation, writes };
}
const change = { teacherId: teacher.id, excelPay: { businessGrossPay: 1000000 }, expected: { teacher: excelSnapshot(teacher), override: "null", input: "null" } };

test("확정 월·검토 후 수정·중복 대상은 쓰기 전에 거부한다", async () => {
  for (const [docs, changes, reason] of [
    [{ [`teachers/${teacher.id}`]: teacher, [`payrollRuns/${month}`]: { status: "published" } }, [change], /확정/],
    [{ [`teachers/${teacher.id}`]: { ...teacher, name: "수정됨" } }, [change], /변경/],
    [{ [`teachers/${teacher.id}`]: teacher }, [change, change], /중복/]
  ]) {
    const store = importStore(docs);
    await assert.rejects(store.operation(month, changes), reason);
    assert.equal(store.writes.length, 0);
  }
});

test("일괄 저장은 excelPay 맵 전체만 교체하고 기존 시수·계약·다른 입력은 보존한다", async () => {
  const store = importStore({ [`teachers/${teacher.id}`]: teacher });
  await store.operation(month, [change]);
  assert.equal(store.writes.length, 1);
  const [path, data, options] = store.writes[0];
  assert.equal(path, `payrollOverrides/${month}_${teacher.id}`);
  assert.deepEqual([...options.mergeFields], Object.keys(data));
  assert.equal(Object.hasOwn(data, "businessWorkLines"), false);
  assert.equal(Object.hasOwn(data, "employeeGrossPay"), false);
});
