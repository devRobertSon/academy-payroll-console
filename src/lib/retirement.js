export const DC_GUIDANCE_URL = "https://www.moel.go.kr/minwon/fastcounsel/fastcounselView.do?inetDcssMngId=202505120240591690507";
export const RETIREMENT_MAX_AMOUNT = 10000000000;

export function retirementId(month, teacherId) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || !teacherId || /[\/]/.test(teacherId)) {
    throw new Error("퇴직연금 대상 월과 선생님을 확인해 주세요.");
  }
  return `${month}_${teacherId}`;
}

function money(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > RETIREMENT_MAX_AMOUNT) {
    throw new Error("퇴직연금 금액은 0원 이상 100억 원 이하의 정수여야 합니다.");
  }
  return value;
}

export function retirementBasis(payroll, describe = () => "") {
  const lines = payroll?.earningLines || [];
  if (lines.length > 200) throw new Error("퇴직연금 산정 항목이 너무 많습니다. 관리자에게 문의해 주세요.");
  return lines.map((line, index) => {
    // Tax treatment does not establish employee status or wage eligibility.
    const included = ["employeeSalary", "lectureFee"].includes(line.earningCategory)
      || (!line.earningCategory && ["monthly", "hourly-business", "tuition-share-business"].includes(line.kind));
    return {
      key: String(index), label: String(line.subjectName || "지급 항목").slice(0, 200),
      amount: money(line.amount), included,
      calculation: String(describe(line) || "확정 지급액").slice(0, 500),
      category: String(line.earningCategory || "other"),
      reason: included ? "기본 급여·강사료" : line.source === "approved-expense-receipt" ? "영수증 실비 여부 확인" : "수당의 임금성 확인 필요"
    };
  });
}

export function retirementEstimate(basis) {
  if (!Array.isArray(basis) || basis.length > 200) throw new Error("퇴직연금 산정 근거를 확인해 주세요.");
  const baseAmount = basis.reduce((sum, line) => {
    money(line.amount);
    if (typeof line.included !== "boolean") throw new Error("임금 산입 여부를 확인해 주세요.");
    return sum + (line.included ? line.amount : 0);
  }, 0);
  money(baseAmount);
  return { baseAmount, expectedAmount: Math.ceil(baseAmount / 12) };
}

export function buildRetirementConfirmation({ teacherId, month, payslip, basis, actualAmount, paidOn, note = "", correctionReason = "", reviewed, previous = null }) {
  retirementId(month, teacherId);
  if (!payslip || payslip.status !== "published" || payslip.teacherId !== teacherId || payslip.month !== month || payslip.incomeType) {
    throw new Error("해당 월의 확정된 전체 급여를 먼저 확인해 주세요.");
  }
  if (!reviewed) throw new Error("임금 산입 항목과 납입 내역을 확인해 주세요.");
  const source = retirementBasis(payslip.calculation);
  if (!basis.length || basis.length !== source.length || basis.some((line, i) =>
    line.key !== source[i].key || line.amount !== source[i].amount || line.label !== source[i].label
    || typeof line.calculation !== "string" || line.calculation.length > 500)) {
    throw new Error("급여 산정 근거가 변경되었습니다. 다시 열어 확인해 주세요.");
  }
  if (!["string", "number"].includes(typeof actualAmount) || String(actualAmount).trim() === "") throw new Error("실제 납입액을 입력해 주세요. 미납입은 0원으로 기록합니다.");
  const actual = money(Number(actualAmount));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(paidOn) || Number.isNaN(Date.parse(paidOn)) || new Date(paidOn).toISOString().slice(0, 10) !== paidOn) {
    throw new Error("납입 확인일을 확인해 주세요.");
  }
  const estimate = retirementEstimate(basis);
  note = String(note).trim();
  correctionReason = String(correctionReason).trim();
  const changedBasis = basis.some((line, i) => line.included !== source[i].included);
  if ((changedBasis || actual !== estimate.expectedAmount) && !note) {
    throw new Error("산입 항목 변경 또는 예상액과의 차이 사유를 메모에 입력해 주세요.");
  }
  if (note.length > 1000 || correctionReason.length > 500 || (previous && correctionReason.length < 5)) {
    throw new Error("메모는 1,000자 이내, 정정 사유는 5~500자로 입력해 주세요.");
  }
  return {
    teacherId, month, status: "confirmed", revision: (previous?.revision || 0) + 1,
    sourcePayslipId: retirementId(month, teacherId), sourceRevision: payslip.revision || 1,
    basis: basis.map((line, i) => ({ ...source[i], included: line.included, calculation: line.calculation,
      reason: line.included === source[i].included ? source[i].reason : "관리자 검토 후 변경" })),
    ...estimate, actualAmount: actual, paidOn, note, correctionReason
  };
}
