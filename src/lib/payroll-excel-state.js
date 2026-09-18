export function excelSnapshot(value) {
  const normalize = (item) => {
    if (item == null || typeof item !== "object") return item;
    if (typeof item.toMillis === "function") return item.toMillis();
    if (Array.isArray(item)) return item.map(normalize);
    return Object.fromEntries(Object.keys(item).sort().filter((key) => item[key] !== undefined).map((key) => [key, normalize(item[key])]));
  };
  if (!value) return "null";
  const { id, ...data } = value;
  return JSON.stringify(normalize(data));
}

export const EXCEL_PAY_FIELDS = {
  employeeGrossPay: "근로소득 월급", businessGrossPay: "사업소득 강사료",
  employeeWorkHours: "근로 수업시간", businessHours: "사업 수업시간",
  transportTrips: "교통 횟수", transportAmount: "직접 입력 교통비 (영수증 제외)", otherPaymentAmount: "기타 지급 (주차비 제외)",
  excelLectureWithholding: "H 강사료 원천징수 합계", excelAdditionalWithholding: "L 추가 지급 원천징수 합계",
  employeeIncomeTax: "R 근로소득세 참고액 (공제 제외)", employeeLocalTax: "S 근로소득 지방세 참고액 (공제 제외)",
  healthInsurance: "T 건강보험", longTermCare: "U 장기요양", nationalPension: "V 국민연금", employmentInsurance: "W 고용보험"
};

export function validateExcelPay(value) {
  if (value == null) return;
  if (typeof value !== "object" || Array.isArray(value)) throw new Error("엑셀 직접 입력값 형식이 올바르지 않습니다.");
  const categorical = ["transportTreatment", "otherTreatment", "otherInsuranceCovered", "excelAdditionalIncomeType", "healthAndLongTermCare"];
  for (const [key, amount] of Object.entries(value)) {
    if (Object.hasOwn(EXCEL_PAY_FIELDS, key)) {
      const hours = key === "employeeWorkHours" || key === "businessHours";
      const max = hours || key === "transportTrips" ? 10000 : 10000000000;
      if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0 || amount > max || !hours && !Number.isInteger(amount)) throw new Error(`${EXCEL_PAY_FIELDS[key]} 값을 확인해 주세요.`);
    } else if (!categorical.includes(key)) throw new Error("허용하지 않는 엑셀 입력 항목입니다.");
    else if (["transportTreatment", "otherTreatment"].includes(key) && !["employee", "business", "other", "exempt", "pending"].includes(amount)) throw new Error("추가 지급의 소득 구분을 확인해 주세요.");
    else if (key === "excelAdditionalIncomeType" && !["employee", "business"].includes(amount)) throw new Error("추가 원천징수 명세서 구분을 확인해 주세요.");
    else if (key === "otherInsuranceCovered" && typeof amount !== "boolean") throw new Error("보험 적용 여부를 확인해 주세요.");
    else if (key === "healthAndLongTermCare" && amount !== null) throw new Error("건강보험과 요양보험을 별도로 입력해 주세요.");
  }
}
