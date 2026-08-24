export const TREATMENT_LABELS = {
  employee: "근로소득",
  business: "사업소득",
  other: "기타소득",
  exempt: "공제 없음"
};

const won = (value) => Math.round(Number(value) || 0);

export function calculateEarning(entry) {
  const quantity = Number(entry.hours ?? entry.quantity ?? 0);
  const rate = Number(entry.hourlyRate ?? entry.unitRate ?? 0);
  return won(quantity * rate + Number(entry.adjustment || 0));
}

export function calculatePayroll(entries, policy, overrides = {}) {
  const earningLines = entries.map((entry) => ({
    ...entry,
    amount: calculateEarning(entry),
    treatment: entry.treatment || "exempt"
  }));

  const grossByTreatment = earningLines.reduce((totals, line) => {
    totals[line.treatment] = (totals[line.treatment] || 0) + line.amount;
    return totals;
  }, { employee: 0, business: 0, other: 0, exempt: 0 });

  const insuredBase = earningLines
    .filter((line) => line.treatment === "employee" && line.insuranceCovered)
    .reduce((sum, line) => sum + line.amount, 0);

  const employeeTax = won(overrides.employeeIncomeTax);
  const employeeLocalTax = overrides.employeeLocalTax == null
    ? won(employeeTax * policy.employee.localIncomeTaxRate)
    : won(overrides.employeeLocalTax);

  const deductions = {
    nationalPension: overrides.nationalPension == null
      ? applyRateWithBounds(insuredBase, policy.employee.nationalPension)
      : won(overrides.nationalPension),
    healthInsurance: overrides.healthInsurance == null
      ? applyRateWithBounds(insuredBase, policy.employee.healthInsurance)
      : won(overrides.healthInsurance),
    longTermCare: 0,
    employmentInsurance: overrides.employmentInsurance == null
      ? applyRateWithBounds(insuredBase, policy.employee.employmentInsurance)
      : won(overrides.employmentInsurance),
    employeeIncomeTax: employeeTax,
    employeeLocalTax,
    businessIncomeTax: won(grossByTreatment.business * policy.business.incomeTaxRate),
    businessLocalTax: won(grossByTreatment.business * policy.business.localIncomeTaxRate),
    otherIncomeTax: won(grossByTreatment.other * policy.other.withholdingRate),
    custom: won(overrides.custom)
  };

  deductions.longTermCare = overrides.longTermCare == null
    ? won(deductions.healthInsurance * policy.employee.longTermCareRate)
    : won(overrides.longTermCare);

  const gross = Object.values(grossByTreatment).reduce((sum, amount) => sum + amount, 0);
  const totalDeductions = Object.values(deductions).reduce((sum, amount) => sum + amount, 0);

  return {
    earningLines,
    grossByTreatment,
    insuredBase,
    gross,
    deductions,
    totalDeductions,
    net: gross - totalDeductions,
    policyVersion: policy.version
  };
}

function applyRateWithBounds(base, rule) {
  if (!base || !rule?.rate) return 0;
  const boundedBase = Math.max(Number(rule.minimumBase || 0), Math.min(base, Number(rule.maximumBase || Number.MAX_SAFE_INTEGER)));
  return won(boundedBase * Number(rule.rate));
}

export function summarizePayroll(payrolls) {
  return payrolls.reduce((summary, payroll) => {
    summary.gross += payroll.gross;
    summary.deductions += payroll.totalDeductions;
    summary.net += payroll.net;
    summary.insuredBase += payroll.insuredBase;
    return summary;
  }, { gross: 0, deductions: 0, net: 0, insuredBase: 0 });
}

export function resolveRateRule(rules, entry) {
  const workedOn = new Date(entry.workedOn);
  const candidates = rules.filter((rule) => {
    const starts = !rule.effectiveFrom || workedOn >= new Date(rule.effectiveFrom);
    const ends = !rule.effectiveTo || workedOn <= new Date(rule.effectiveTo);
    const teacherMatches = rule.teacherId === entry.teacherId;
    const subjectMatches = !rule.subjectId || rule.subjectId === entry.subjectId;
    const classMatches = !rule.classId || rule.classId === entry.classId;
    return starts && ends && teacherMatches && subjectMatches && classMatches;
  });

  return candidates.sort((a, b) => specificity(b) - specificity(a))[0] || null;
}

function specificity(rule) {
  return Number(Boolean(rule.teacherId)) + Number(Boolean(rule.subjectId)) + Number(Boolean(rule.classId));
}

