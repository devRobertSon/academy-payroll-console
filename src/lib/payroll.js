export const TREATMENT_LABELS = {
  employee: "근로소득",
  business: "사업소득",
  other: "기타소득",
  exempt: "공제 없음"
};

const won = (value) => Math.round(Number(value) || 0);
const floorWon = (value) => Math.floor(Math.max(0, Number(value) || 0));
const floorTenWon = (value) => Math.floor(Math.max(0, Number(value) || 0) / 10) * 10;

export function calculateEarning(entry) {
  const quantity = Number(entry.hours ?? entry.quantity ?? 0);
  const rate = Number(entry.hourlyRate ?? entry.unitRate ?? 0);
  return won(quantity * rate + Number(entry.adjustment || 0));
}

export function calculatePayroll(entries, policyBundle, overrides = {}, taxProfile = {}) {
  const taxPolicy = policyBundle.taxPolicy || policyBundle.tax || policyBundle;
  const insurancePolicy = policyBundle.insurancePolicy || policyBundle.insurance || policyBundle;
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
  const employeeTaxablePay = Math.max(
    0,
    grossByTreatment.employee
      - won(overrides.employeeNonTaxableAmount)
      - won(overrides.employeeStudentLoanSupportAmount)
  );
  const calculatedEmployeeTax = calculateEmploymentIncomeTax(
    employeeTaxablePay,
    taxPolicy.employment,
    taxProfile
  );
  const employeeTax = overrides.employeeIncomeTax == null
    ? calculatedEmployeeTax
    : won(overrides.employeeIncomeTax);
  const employeeLocalTax = overrides.employeeLocalTax == null
    ? won(employeeTax * localTaxRatio(taxPolicy))
    : won(overrides.employeeLocalTax);

  const calculatedBusinessIncomeTax = floorWon(
    grossByTreatment.business * Number(taxPolicy.business?.incomeTaxRate || 0)
  );
  const businessIncomeTax = overrides.businessIncomeTax == null
    ? calculatedBusinessIncomeTax
    : won(overrides.businessIncomeTax);
  const businessLocalTax = overrides.businessLocalTax == null
    ? won(businessIncomeTax * Number(taxPolicy.business?.localIncomeTaxRateOfIncomeTax || 0))
    : won(overrides.businessLocalTax);

  const otherTax = calculateOtherIncomeTax(earningLines, taxPolicy.other);
  const otherIncomeTax = overrides.otherIncomeTax == null
    ? otherTax.incomeTax
    : won(overrides.otherIncomeTax);
  const otherLocalTax = overrides.otherLocalTax == null
    ? otherTax.localIncomeTax
    : won(overrides.otherLocalTax);

  const insurance = insurancePolicy.employee || {};
  const deductions = {
    nationalPension: overrides.nationalPension == null
      ? applyRateWithBounds(insuredBase, insurance.nationalPension)
      : won(overrides.nationalPension),
    healthInsurance: overrides.healthInsurance == null
      ? applyRateWithBounds(insuredBase, insurance.healthInsurance)
      : won(overrides.healthInsurance),
    longTermCare: 0,
    employmentInsurance: overrides.employmentInsurance == null
      ? applyRateWithBounds(insuredBase, insurance.employmentInsurance)
      : won(overrides.employmentInsurance),
    employeeIncomeTax: employeeTax,
    employeeLocalTax,
    businessIncomeTax,
    businessLocalTax,
    otherIncomeTax,
    otherLocalTax,
    custom: won(overrides.custom)
  };

  deductions.longTermCare = overrides.longTermCare == null
    ? won(deductions.healthInsurance * Number(insurance.longTermCareRate || 0))
    : won(overrides.longTermCare);

  const gross = Object.values(grossByTreatment).reduce((sum, amount) => sum + amount, 0);
  const totalDeductions = Object.values(deductions).reduce((sum, amount) => sum + amount, 0);

  return {
    earningLines,
    grossByTreatment,
    insuredBase,
    employeeTaxablePay,
    otherIncomeTaxableAmount: otherTax.taxableIncome,
    otherIncomeGroups: otherTax.groups,
    gross,
    deductions,
    totalDeductions,
    net: gross - totalDeductions,
    policyVersion: `${taxPolicy.version} / ${insurancePolicy.version}`,
    taxPolicyVersion: taxPolicy.version,
    insurancePolicyVersion: insurancePolicy.version
  };
}

export function calculateEmploymentIncomeTax(monthlyTaxablePay, rule, profile = {}) {
  const pay = floorWon(monthlyTaxablePay);
  if (!pay || !rule) return 0;
  const dependentCount = Math.max(1, Math.floor(Number(profile.dependentCount) || 1));
  const children = Math.max(0, Math.floor(Number(profile.children8To20) || 0));
  const ratio = Number(profile.withholdingRatio) || 1;
  const allowedRatios = rule.allowedWithholdingRatios || [0.8, 1, 1.2];
  if (!allowedRatios.includes(ratio)) throw new Error("근로소득 원천징수 비율은 정책에 허용된 값이어야 합니다.");

  const rowTaxes = pay > 10000000
    ? calculateHighIncomeTaxes(pay, rule)
    : taxesForTablePay(pay, rule);
  let tax = taxForDependentCount(rowTaxes, dependentCount);
  tax = Math.max(0, tax - childCredit(children, rule.childCredits));
  return floorTenWon(tax * ratio);
}

function taxesForTablePay(pay, rule) {
  if (pay === 10000000) return rule.taxAtTenMillion || [];
  const row = (rule.tableRows || []).find(([minimum, maximum]) => pay >= minimum && pay < maximum);
  return row?.[2] || Array(11).fill(0);
}

function calculateHighIncomeTaxes(pay, rule) {
  const bracket = (rule.highIncomeBrackets || []).find((item) => item.max == null || pay <= item.max);
  if (!bracket) throw new Error("고액 급여 간이세액 산식이 설정되지 않았습니다.");
  const addition = Number(bracket.baseAddition || 0)
    + (pay - Number(bracket.excessFrom || 0))
      * Number(bracket.excessFactor ?? 1)
      * Number(bracket.rate || 0);
  return (rule.taxAtTenMillion || []).map((baseTax) => floorTenWon(baseTax + addition));
}

function taxForDependentCount(taxes, dependentCount) {
  if (dependentCount <= 11) return Number(taxes[dependentCount - 1] || 0);
  const taxForTen = Number(taxes[9] || 0);
  const taxForEleven = Number(taxes[10] || 0);
  return Math.max(0, taxForEleven - (taxForTen - taxForEleven) * (dependentCount - 11));
}

function childCredit(children, credits = {}) {
  if (children <= 0) return 0;
  if (children === 1) return Number(credits.one || 0);
  if (children === 2) return Number(credits.two || 0);
  return Number(credits.two || 0) + (children - 2) * Number(credits.additional || 0);
}

export function calculateOtherIncomeTax(earningLines, rule) {
  const groups = new Map();
  earningLines.filter((line) => line.treatment === "other").forEach((line) => {
    const categoryId = line.otherIncomeCategory || rule?.defaultCategory;
    const groupId = line.otherPaymentGroup || "monthly-payment";
    const key = `${categoryId}:${groupId}`;
    const current = groups.get(key) || { categoryId, paymentGroup: groupId, gross: 0 };
    current.gross += line.amount;
    groups.set(key, current);
  });

  const results = [...groups.values()].map((group) => {
    const category = rule?.categories?.[group.categoryId];
    if (!category) throw new Error(`기타소득 분류 정책이 없습니다: ${group.categoryId}`);
    const taxableIncome = floorWon(group.gross * (1 - Number(category.expenseRate || 0)));
    const taxable = taxableIncome > Number(category.minimumTaxableIncomeAmount || 0);
    const incomeTax = taxable ? floorWon(taxableIncome * Number(category.incomeTaxRate || 0)) : 0;
    const localIncomeTax = won(incomeTax * Number(category.localIncomeTaxRateOfIncomeTax || 0));
    return { ...group, taxableIncome, incomeTax, localIncomeTax, taxable };
  });

  return results.reduce((total, group) => ({
    taxableIncome: total.taxableIncome + group.taxableIncome,
    incomeTax: total.incomeTax + group.incomeTax,
    localIncomeTax: total.localIncomeTax + group.localIncomeTax,
    groups: [...total.groups, group]
  }), { taxableIncome: 0, incomeTax: 0, localIncomeTax: 0, groups: [] });
}

function localTaxRatio(taxPolicy) {
  return Number(
    taxPolicy.employment?.localIncomeTaxRateOfIncomeTax
      ?? taxPolicy.business?.localIncomeTaxRateOfIncomeTax
      ?? 0.1
  );
}

function applyRateWithBounds(base, rule) {
  if (!base || !rule?.rate) return 0;
  const boundedBase = Math.max(
    Number(rule.minimumBase || 0),
    Math.min(base, Number(rule.maximumBase || Number.MAX_SAFE_INTEGER))
  );
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

export function resolveEffectivePolicy(policies, date, fallback = null) {
  const target = String(date).length === 7 ? `${date}-01` : String(date);
  return [...(policies || [])]
    .filter((policy) => {
      const starts = !policy.effectiveFrom || policy.effectiveFrom <= target;
      const ends = !policy.effectiveTo || policy.effectiveTo >= target;
      return starts && ends;
    })
    .sort((a, b) => String(b.effectiveFrom || "").localeCompare(String(a.effectiveFrom || "")))[0] || fallback;
}

export function parseEmploymentTaxTableRows(objects) {
  const taxHeaders = Array.from({ length: 11 }, (_, index) => `dependent${index + 1}`);
  const required = ["minMonthlyPay", "maxMonthlyPay", ...taxHeaders];
  if (!objects.length || required.some((key) => !(key in objects[0]))) {
    throw new Error("간이세액표 CSV 열 이름을 확인해 주세요.");
  }

  let taxAtTenMillion = null;
  const tableRows = objects.map((item, index) => {
    const minimum = Number(item.minMonthlyPay);
    const maximum = Number(item.maxMonthlyPay);
    const taxes = taxHeaders.map((header) => Number(item[header]));
    if (![minimum, maximum, ...taxes].every(Number.isFinite) || taxes.some((value) => value < 0)) {
      throw new Error(`간이세액표 CSV ${index + 2}행의 숫자를 확인해 주세요.`);
    }
    if (minimum === 10000000 && maximum === 10000000) {
      taxAtTenMillion = taxes;
      return null;
    }
    if (minimum >= maximum) throw new Error(`간이세액표 CSV ${index + 2}행의 급여 구간을 확인해 주세요.`);
    return [minimum, maximum, taxes];
  }).filter(Boolean).sort((a, b) => a[0] - b[0]);

  if (!tableRows.length || tableRows.at(-1)[1] !== 10000000 || !taxAtTenMillion) {
    throw new Error("간이세액표는 1천만원 미만 구간과 1천만원 기준 세액 행을 포함해야 합니다.");
  }
  if (tableRows.some((row, index) => index > 0 && tableRows[index - 1][1] !== row[0])) {
    throw new Error("간이세액표 급여 구간이 연속되지 않습니다.");
  }
  return { tableRows, taxAtTenMillion };
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
