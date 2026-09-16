import { getMonthlyPayAmounts } from "./payroll.js";

export const EXCEL_COLUMNS = {
  E: "reported", F: "hours", G: "basePay", H: "lectureTax", I: "trips",
  J: "transport", K: "other", L: "additionalTax", M: "net",
  R: "employeeIncomeTax", S: "employeeLocalTax", T: "healthInsurance",
  U: "longTermCare", V: "nationalPension", W: "employmentInsurance", X: "insuranceTotal"
};
const SUMMARY_FIELDS = new Set(["reported", "net", "insuranceTotal"]);
const TAX_FIELDS = ["employeeIncomeTax", "employeeLocalTax", "healthInsurance", "longTermCare", "nationalPension", "employmentInsurance"];
const MAX_AMOUNT = 10000000000;

function cellValue(cell) {
  const value = cell.value;
  if (value && typeof value === "object") {
    if (value.formula || value.sharedFormula) {
      const result = cell.result ?? value.result;
      if (result == null || result === "") throw new Error(`${cell.address}: 수식 계산 결과가 없습니다. 엑셀에서 다시 계산하고 저장해 주세요.`);
      return result;
    }
    if (value.richText) return value.richText.map((part) => part.text).join("");
    throw new Error(`${cell.address}: 지원하지 않는 셀 형식입니다.`);
  }
  return value;
}

export function numericCell(cell, field) {
  const raw = cellValue(cell);
  if (raw == null || raw === "" || typeof raw === "string" && !raw.trim()) return null;
  const cleaned = typeof raw === "string" ? raw.trim() : raw;
  if (typeof cleaned === "string" && !/^-?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(cleaned)) throw new Error(`${cell.address}: 숫자 표기를 확인해 주세요.`);
  const text = typeof cleaned === "string" ? cleaned.replace(/,/g, "") : cleaned;
  if (typeof text !== "number" && typeof text !== "string") {
    throw new Error(`${cell.address}: 0 이상의 숫자 또는 빈칸이어야 합니다.`);
  }
  const value = Number(text);
  const limit = field === "hours" || field === "trips" ? 10000 : MAX_AMOUNT;
  if (!Number.isFinite(value) || value < 0 && field !== "net" || Math.abs(value) > limit || field !== "hours" && !Number.isInteger(value)) {
    throw new Error(`${cell.address}: 금액·횟수는 정수, 시간은 소수로 입력해 주세요. 허용 범위를 초과한 값은 사용할 수 없습니다.`);
  }
  return value;
}

function textCell(cell, max = 100) {
  const value = cellValue(cell);
  if (value == null) return "";
  if (!["string", "number"].includes(typeof value)) throw new Error(`${cell.address}: 텍스트 형식을 확인해 주세요.`);
  const text = String(value).trim();
  if (text.length > max) throw new Error(`${cell.address}: 텍스트가 너무 깁니다.`);
  return text;
}

export function readPayrollWorkbook(workbook) {
  const sheets = [];
  if (workbook.worksheets.length > 20) throw new Error("시트가 너무 많습니다. 급여 시트만 남긴 파일을 선택해 주세요.");
  for (const sheet of workbook.worksheets) {
    if (sheet.name === "급여 입력 상세") continue;
    const headers = { A: "강사", B: "연락처", E: "신고액", F: "시간", G: "강사료", H: "강사료세액공제", I: "횟수", J: "교통비", K: "기타", L: "세액공제", M: "지급액", R: "소득세", S: "지방소득세", T: "건강", U: "요양" };
    if (!Object.entries(headers).every(([col, label]) => String(sheet.getCell(`${col}4`).text).replace(/\s/g, "") === label)) continue;
    if (!["국민연금", "고용보험", "보험료총합"].every((label, i) => String(sheet.getCell(`${["V", "W", "X"][i]}3`).text).replace(/\s/g, "").replace("보혐료", "보험료") === label)) continue;
    if (sheet.rowCount > 5000) throw new Error("급여 시트는 5,000행 이하로 줄여 주세요.");
    const rows = [];
    for (let number = 5; number <= sheet.rowCount; number++) {
      const name = textCell(sheet.getCell(`A${number}`));
      if (!name || /^(합계|총계|소계)$/.test(name.replace(/\s/g, ""))) continue;
      const errors = [];
      const values = {};
      let phone = "";
      try { phone = textCell(sheet.getCell(`B${number}`), 30); } catch (error) { errors.push(error.message); }
      // Private identity/address/bank columns and free-text remarks never leave the workbook reader.
      for (const [col, field] of Object.entries(EXCEL_COLUMNS)) {
        try { values[field] = numericCell(sheet.getCell(`${col}${number}`), field); }
        catch (error) { values[field] = null; errors.push(error.message); }
      }
      const hasInputs = Object.entries(values).some(([key, value]) => value != null && !SUMMARY_FIELDS.has(key));
      rows.push({ number, name, phone, values, errors, hasInputs });
      if (rows.length > 300) throw new Error("한 번에 최대 300명까지 불러올 수 있습니다.");
    }
    sheets.push({ name: sheet.name, title: textCell(sheet.getCell("A1"), 200), rows });
  }
  if (!sheets.length) throw new Error("양식의 3~4행 제목과 A~X열 순서를 확인해 주세요. 첨부하신 강사료 양식의 .xlsx 파일만 지원합니다.");
  return sheets;
}

const normalizedName = (name) => String(name || "").normalize("NFC").replace(/\s+/g, "").toLowerCase();
const normalizedPhone = (phone) => String(phone || "").replace(/\D/g, "").replace(/^10(\d{8})$/, "010$1");
export function matchExcelTeacher(row, teachers) {
  const candidates = teachers.filter((teacher) => teacher.status === "active" && normalizedName(teacher.name) === normalizedName(row.name));
  const matched = row.phone ? candidates.filter((teacher) => normalizedPhone(teacher.phone) === normalizedPhone(row.phone)) : candidates;
  return matched.length === 1 ? matched[0].id : "";
}

export function buildExcelPay(row, teacher, override, choices = {}) {
  if (row.errors.length) throw new Error(row.errors.join("\n"));
  if (!row.hasInputs) throw new Error("변경할 금액이나 시간이 없습니다.");
  const before = getMonthlyPayAmounts(teacher, override);
  const next = { ...(override.excelPay || {}) };
  const v = row.values;
  const mixed = teacher.incomeComposition === "mixed";
  const employeeOnly = teacher.incomeComposition === "employee";
  if (mixed && (v.basePay != null || v.hours != null) && !choices.allocationConfirmed) {
    throw new Error("근로소득·사업소득의 금액과 시간을 배분하고 확인해 주세요.");
  }
  if (v.basePay != null) {
    const employeePay = mixed ? Number(choices.employeeGrossPay) : employeeOnly ? v.basePay : 0;
    if (!Number.isInteger(employeePay) || employeePay < 0 || employeePay > v.basePay) throw new Error("근로소득 금액은 강사료 합계 이내의 정수여야 합니다.");
    next.employeeGrossPay = employeePay;
    next.businessGrossPay = v.basePay - employeePay;
  }
  if (v.hours != null) {
    const employeeHours = mixed ? Number(choices.employeeWorkHours) : employeeOnly ? v.hours : 0;
    if (!Number.isFinite(employeeHours) || employeeHours < 0 || employeeHours > v.hours) throw new Error("근로 수업시간은 전체 시간 이내여야 합니다.");
    next.employeeWorkHours = employeeHours;
    next.businessHours = v.hours - employeeHours;
    // A total hour count cannot replace the distribution across hourly rates.
    if (next.businessGrossPay == null && !employeeOnly) next.businessGrossPay = before.businessGrossPay;
  }
  if (v.trips != null) {
    next.transportTrips = v.trips;
    if (v.transport == null && next.transportAmount == null) next.transportAmount = before.manualTransportAmount;
  }
  if (v.transport != null) {
    if (v.transport < before.receiptTransportAmount) throw new Error("교통비가 이미 승인된 영수증 합계보다 작습니다.");
    next.transportAmount = v.transport - before.receiptTransportAmount;
    next.transportTreatment = choices.transportTreatment || before.transportTreatment;
  }
  if (v.other != null) {
    if (v.other < before.parkingAmount) throw new Error("기타 금액이 기존 주차비보다 작습니다. 주차비를 먼저 검토해 주세요.");
    next.otherPaymentAmount = v.other - before.parkingAmount;
    next.otherTreatment = choices.otherTreatment || "pending";
    next.otherInsuranceCovered = choices.otherInsuranceCovered === true;
  }
  for (const key of TAX_FIELDS) if (v[key] != null) next[key] = v[key];
  if (v.healthInsurance != null || v.longTermCare != null) {
    next.healthAndLongTermCare = null;
    if (override.healthAndLongTermCare != null && override.excelPay?.healthAndLongTermCare !== null) {
      if (v.healthInsurance == null) next.healthInsurance = choices.currentHealthInsurance ?? 0;
      if (v.longTermCare == null) next.longTermCare = choices.currentLongTermCare ?? 0;
    }
  }
  if (v.lectureTax != null) {
    if (v.lectureTax > 0 && employeeOnly) throw new Error("근로소득 전용 선생님은 R·S열 소득세·지방소득세를 사용해 주세요. H열 공제의 소득 구분을 확인해야 합니다.");
    next.excelLectureWithholding = v.lectureTax;
  }
  if (v.additionalTax != null) {
    next.excelAdditionalWithholding = v.additionalTax;
    next.excelAdditionalIncomeType = choices.additionalIncomeType || (employeeOnly ? "employee" : "business");
  }
  return next;
}

export function excelSummaryWarnings(row, payroll) {
  const comparisons = { reported: ["E열 신고액", payroll.gross], net: ["M열 지급액", payroll.net], insuranceTotal: ["X열 보험료 총합", payroll.reporting.insuranceTotal] };
  return Object.entries(comparisons).flatMap(([key, [label, computed]]) => row.values[key] != null && row.values[key] !== computed
    ? [`${label}: 엑셀 ${row.values[key].toLocaleString("ko-KR")}원 / 적용 후 ${computed.toLocaleString("ko-KR")}원`] : []);
}

export function createPayrollWorkbook(ExcelJS, month, rows) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("급여 월을 선택해 주세요.");
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet(`${Number(month.slice(5))}월 강사료`);
  sheet.getCell("A1").value = `${month.slice(0, 4)}년 ${Number(month.slice(5))}월 강사료`;
  sheet.mergeCells("A1:P1");
  sheet.getCell("A1").font = { name: "맑은 고딕", size: 14, bold: true };
  sheet.getCell("A2").value = "단위: 원 · G 강사료 = 근로소득 + 사업소득 · K 기타 = 주차비 + 기타 지급";
  sheet.mergeCells("A2:P2");
  sheet.mergeCells("T1:X1");
  sheet.mergeCells("T3:U3");
  sheet.getCell("T3").value = "건강보험";
  for (const [col, label] of [["V", "국민연금"], ["W", "고용보험"], ["X", "보험료 총합"]]) {
    sheet.mergeCells(`${col}3:${col}4`);
    sheet.getCell(`${col}3`).value = label;
  }
  const headers = ["강사", "연락처", "주민등록번호", "주소", "신고액", "시간", "강사료", "강사료 세액공제", "횟수", "교통비", "기타", "세액공제", "지급액", "입금은행", "계좌번호", "비고", "", "소득세", "지방소득세", "건강", "요양"];
  headers.forEach((label, index) => { sheet.getCell(4, index + 1).value = label; });
  for (let col = 1; col <= 24; col++) {
    sheet.getColumn(col).width = [1, 2, 3, 4, 14, 15, 16].includes(col) ? 18 : [6, 9].includes(col) ? 8 : col === 17 ? 3 : 16;
    for (let row = 3; row <= 4; row++) {
      const cell = sheet.getCell(row, col);
      cell.font = { name: "맑은 고딕", size: 10, bold: true };
      cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
      if (col !== 17) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: col >= 18 ? "FFDDEBF7" : "FFFCE4D6" } };
    }
  }
  sheet.getColumn(4).hidden = true;
  sheet.getRow(1).height = 28;
  sheet.getRow(2).height = 23;
  sheet.getRow(3).height = 23;
  sheet.getRow(4).height = 32;
  rows.forEach((item, index) => {
    const r = index + 5;
    const { teacher, payroll } = item;
    const report = payroll.reporting;
    const d = payroll.deductions;
    const salary = payroll.earningLines.filter((line) => ["employeeSalary", "lectureFee"].includes(line.earningCategory)).reduce((sum, line) => sum + line.amount, 0);
    const data = { A: teacher.name, B: teacher.phone || "", F: item.classHours ?? report.classHours, G: salary,
      H: report.lectureWithholding, I: item.transportTrips ?? report.transportTrips, J: report.transportAmount,
      K: report.parkingAmount + report.otherPaymentAmount, L: report.additionalPaymentWithholding,
      R: d.employeeIncomeTax, S: d.employeeLocalTax, T: d.healthInsurance, U: d.longTermCare,
      V: d.nationalPension, W: d.employmentInsurance };
    for (const [col, value] of Object.entries(data)) sheet.getCell(`${col}${r}`).value = value;
    sheet.getCell(`E${r}`).value = { formula: `SUM(G${r},J${r}:K${r})`, result: payroll.gross };
    sheet.getCell(`X${r}`).value = { formula: `SUM(T${r}:W${r})`, result: report.insuranceTotal };
    // The reference has no other-deduction column. Keep the actual net amount, including custom deductions.
    sheet.getCell(`M${r}`).value = payroll.net;
    sheet.getCell(`P${r}`).value = d.custom ? `기타 공제 ${d.custom}원 포함` : "";
    sheet.getRow(r).height = 26;
    for (let col = 1; col <= 24; col++) {
      const cell = sheet.getCell(r, col);
      cell.font = { name: "맑은 고딕", size: 10 };
      cell.alignment = { vertical: "middle", horizontal: typeof cell.value === "number" || cell.type === ExcelJS.ValueType.Formula ? "right" : "left" };
      if (col >= 5 && col <= 13 || col >= 18) cell.numFmt = col === 6 ? "0.##" : "#,##0";
      if (col !== 17) cell.border = { bottom: { style: "hair", color: { argb: "FFD9DEE5" } } };
    }
  });
  sheet.views = [{ state: "frozen", xSplit: 2, ySplit: 4 }];
  sheet.pageSetup = { orientation: "landscape", paperSize: 8, fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: "3:4" };
  sheet.pageSetup.printArea = `A1:X${Math.max(5, rows.length + 4)}`;
  return book;
}
