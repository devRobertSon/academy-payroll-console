export const TREATMENT_LABELS = {
  employee: "근로소득",
  business: "사업소득",
  other: "기타소득",
  exempt: "비과세 실비",
  pending: "처리 미확인"
};

export const INSURANCE_LABELS = {
  nationalPension: "국민연금",
  healthInsurance: "건강보험·장기요양",
  employmentInsurance: "고용보험"
};

const won = (value) => Math.round(Number(value) || 0);
const floorWon = (value) => Math.floor(Math.max(0, Number(value) || 0));
const floorTenWon = (value) => Math.floor(Math.max(0, Number(value) || 0) / 10) * 10;

export function calculateEarning(entry) {
  const quantity = Number(entry.hours ?? entry.quantity ?? 0);
  const rate = Number(entry.hourlyRate ?? entry.unitRate ?? 0);
  return won(quantity * rate + Number(entry.adjustment || 0));
}

export function getTeacherPaySettings(teacher = {}) {
  const hasCurrentFields = teacher.insuranceEnrolled != null
    || teacher.insuranceSettings != null
    || teacher.defaultEmployeePay != null
    || teacher.defaultBusinessPay != null
    || Array.isArray(teacher.businessRates);
  if (hasCurrentFields) {
    const insuranceSettings = normalizeInsuranceSettings(
      teacher.insuranceSettings,
      teacher.insuranceEnrolled === true
    );
    return {
      insuranceEnrolled: Object.values(insuranceSettings).some((item) => item.enrolled),
      insuranceSettings,
      defaultEmployeePay: Math.max(0, won(teacher.defaultEmployeePay)),
      defaultBusinessPay: Math.max(0, won(teacher.defaultBusinessPay)),
      businessRates: normalizeBusinessRates(teacher.businessRates),
      transportPolicy: normalizeTransportPolicy(teacher.transportPolicy),
      source: "current"
    };
  }

  const legacyPay = Math.max(0, won(teacher.baseMonthlyPay));
  if (teacher.employmentType === "insured") {
    return {
      insuranceEnrolled: true,
      insuranceSettings: normalizeInsuranceSettings(null, true),
      defaultEmployeePay: legacyPay,
      defaultBusinessPay: 0,
      businessRates: [],
      transportPolicy: normalizeTransportPolicy(),
      source: "legacy"
    };
  }
  if (teacher.employmentType === "freelancer") {
    return {
      insuranceEnrolled: false,
      insuranceSettings: normalizeInsuranceSettings(),
      defaultEmployeePay: 0,
      defaultBusinessPay: legacyPay,
      businessRates: [],
      transportPolicy: normalizeTransportPolicy(),
      source: "legacy"
    };
  }
  return {
    insuranceEnrolled: false,
    insuranceSettings: normalizeInsuranceSettings(),
    defaultEmployeePay: 0,
    defaultBusinessPay: 0,
    businessRates: [],
    transportPolicy: normalizeTransportPolicy(),
    source: "unset"
  };
}

export function getMonthlyPayAmounts(teacher, override = {}) {
  const settings = getTeacherPaySettings(teacher);
  let employeeGrossPay;
  let businessGrossPay;
  let businessHours;
  let businessWorkLines;
  let source;

  if (Array.isArray(override.businessWorkLines)) {
    businessWorkLines = normalizeBusinessWorkLines(override.businessWorkLines);
    employeeGrossPay = override.employeeGrossPay == null
      ? settings.defaultEmployeePay
      : Math.max(0, won(override.employeeGrossPay));
    businessGrossPay = businessWorkLines.reduce((sum, line) => sum + line.amount, 0);
    businessHours = businessWorkLines.reduce((sum, line) => sum + line.hours, 0);
    source = "monthly-work-input";
  } else if (override.employeeGrossPay != null || override.businessGrossPay != null) {
    employeeGrossPay = override.employeeGrossPay == null
      ? settings.defaultEmployeePay
      : Math.max(0, won(override.employeeGrossPay));
    businessGrossPay = override.businessGrossPay == null
      ? settings.defaultBusinessPay
      : Math.max(0, won(override.businessGrossPay));
    businessHours = 0;
    businessWorkLines = [];
    source = "monthly-input";
  } else if (override.grossPay != null) {
    const legacyPay = Math.max(0, won(override.grossPay));
    if (teacher?.employmentType === "insured") {
      employeeGrossPay = legacyPay;
      businessGrossPay = settings.defaultBusinessPay;
    } else {
      employeeGrossPay = settings.defaultEmployeePay;
      businessGrossPay = teacher?.employmentType === "freelancer" ? legacyPay : settings.defaultBusinessPay;
    }
    businessHours = 0;
    businessWorkLines = [];
    source = "legacy-monthly-input";
  } else if (Array.isArray(teacher?.businessRates)) {
    employeeGrossPay = settings.defaultEmployeePay;
    businessGrossPay = 0;
    businessHours = 0;
    businessWorkLines = settings.businessRates.map((rate) => ({ ...rate, hours: 0, amount: 0 }));
    source = "teacher-default";
  } else {
    employeeGrossPay = settings.defaultEmployeePay;
    businessGrossPay = settings.defaultBusinessPay;
    businessHours = 0;
    businessWorkLines = [];
    source = settings.source === "unset" ? "unset" : "teacher-default";
  }

  const employeeWorkHours = Math.max(0, Number(override.employeeWorkHours) || 0);
  const transportTrips = Math.max(0, Math.floor(Number(override.transportTrips) || 0));
  const transportUnitAmount = override.transportUnitAmount == null
    ? settings.transportPolicy.unitAmount
    : Math.max(0, won(override.transportUnitAmount));
  const transportAmount = won(transportTrips * transportUnitAmount);
  const transportTreatment = normalizeTreatment(
    override.transportTreatment || settings.transportPolicy.treatment
  );
  const parkingAmount = Math.max(0, won(override.parkingAmount));
  const parkingTreatment = normalizeTreatment(override.parkingTreatment);
  const additionalEarnings = normalizeAdditionalEarnings(override.additionalEarnings);
  const additionalGrossPay = transportAmount
    + parkingAmount
    + additionalEarnings.reduce((sum, line) => sum + line.amount, 0);
  const unconfirmedCount = Number(transportAmount > 0 && transportTreatment === "pending")
    + Number(parkingAmount > 0 && parkingTreatment === "pending")
    + additionalEarnings.filter((line) => line.amount > 0 && line.treatment === "pending").length;

  return {
    employeeGrossPay,
    employeeWorkHours,
    businessGrossPay,
    businessHours,
    businessWorkLines,
    transportTrips,
    transportUnitAmount,
    transportAmount,
    transportTreatment,
    transportInsuranceCovered: override.transportInsuranceCovered === true,
    parkingAmount,
    parkingTreatment,
    parkingInsuranceCovered: override.parkingInsuranceCovered === true,
    additionalEarnings,
    additionalGrossPay,
    totalGrossPay: employeeGrossPay + businessGrossPay + additionalGrossPay,
    unconfirmedCount,
    source
  };
}

export function createMonthlyEarningLines(teacher, month, override = {}) {
  const settings = getTeacherPaySettings(teacher);
  const amounts = getMonthlyPayAmounts(teacher, override);
  const lines = [];

  if (amounts.employeeGrossPay > 0) {
    lines.push({
      id: `${month}_${teacher.id}_employee-pay`,
      month,
      teacherId: teacher.id,
      kind: "monthly",
      subjectName: "월 근로소득",
      earningCategory: "employeeSalary",
      workHours: amounts.employeeWorkHours,
      hours: 1,
      hourlyRate: amounts.employeeGrossPay,
      treatment: "employee",
      insuranceCovered: settings.insuranceEnrolled,
      note: override.grossPayNote || null,
      source: amounts.source
    });
  }
  if (amounts.businessWorkLines.length) {
    amounts.businessWorkLines.filter((line) => line.amount > 0).forEach((line, index) => lines.push({
      id: `${month}_${teacher.id}_business-${line.id || index + 1}`,
      month,
      teacherId: teacher.id,
      kind: "hourly-business",
      subjectName: line.subjectName || "사업소득 강의",
      earningCategory: "lectureFee",
      hours: line.hours,
      hourlyRate: line.hourlyRate,
      treatment: "business",
      insuranceCovered: false,
      note: override.grossPayNote || null,
      source: amounts.source
    }));
  } else if (amounts.businessGrossPay > 0) {
    lines.push({
      id: `${month}_${teacher.id}_business-pay`,
      month,
      teacherId: teacher.id,
      kind: "monthly",
      subjectName: "월 사업소득",
      earningCategory: "lectureFee",
      hours: 1,
      hourlyRate: amounts.businessGrossPay,
      treatment: "business",
      insuranceCovered: false,
      note: override.grossPayNote || null,
      source: amounts.source
    });
  }

  if (amounts.transportAmount > 0) {
    lines.push({
      id: `${month}_${teacher.id}_transport`,
      month,
      teacherId: teacher.id,
      kind: "unit",
      subjectName: "교통비",
      earningCategory: "transport",
      hours: amounts.transportTrips,
      hourlyRate: amounts.transportUnitAmount,
      quantity: amounts.transportTrips,
      unitRate: amounts.transportUnitAmount,
      treatment: amounts.transportTreatment,
      insuranceCovered: amounts.transportInsuranceCovered,
      source: amounts.source
    });
  }
  if (amounts.parkingAmount > 0) {
    lines.push({
      id: `${month}_${teacher.id}_parking`,
      month,
      teacherId: teacher.id,
      kind: "monthly",
      subjectName: "주차료",
      earningCategory: "parking",
      hours: 1,
      hourlyRate: amounts.parkingAmount,
      treatment: amounts.parkingTreatment,
      insuranceCovered: amounts.parkingInsuranceCovered,
      source: amounts.source
    });
  }
  amounts.additionalEarnings.forEach((line, index) => {
    if (line.amount <= 0) return;
    lines.push({
      id: `${month}_${teacher.id}_additional-${line.id || index + 1}`,
      month,
      teacherId: teacher.id,
      kind: "monthly",
      subjectName: line.label,
      earningCategory: "otherPayment",
      hours: 1,
      hourlyRate: line.amount,
      treatment: line.treatment,
      insuranceCovered: line.insuranceCovered,
      otherIncomeCategory: line.treatment === "other" ? "temporaryLecture" : null,
      otherPaymentGroup: line.treatment === "other" ? line.id : null,
      source: amounts.source
    });
  });
  return lines;
}

function normalizeInsuranceSettings(settings, legacyEnrolled = false) {
  return Object.fromEntries(Object.keys(INSURANCE_LABELS).map((key) => {
    const item = settings?.[key] || {};
    return [key, {
      enrolled: item.enrolled == null ? legacyEnrolled : item.enrolled === true,
      defaultBaseAmount: item.defaultBaseAmount == null ? null : Math.max(0, won(item.defaultBaseAmount)),
      effectiveFrom: item.effectiveFrom || null,
      effectiveTo: item.effectiveTo || null
    }];
  }));
}

function normalizeTransportPolicy(policy = {}) {
  return {
    regionLabel: String(policy?.regionLabel || "").trim(),
    unitAmount: Math.max(0, won(policy?.unitAmount)),
    treatment: normalizeTreatment(policy?.treatment)
  };
}

function normalizeTreatment(treatment) {
  return ["employee", "business", "other", "exempt", "pending"].includes(treatment)
    ? treatment
    : "pending";
}

function normalizeAdditionalEarnings(lines) {
  return (Array.isArray(lines) ? lines : []).map((line, index) => ({
    id: String(line.id || `additional-${index + 1}`),
    label: String(line.label || "기타 지급").trim(),
    amount: Math.max(0, won(line.amount)),
    treatment: normalizeTreatment(line.treatment),
    insuranceCovered: line.insuranceCovered === true
  })).filter((line) => line.label && line.amount > 0);
}

function normalizeBusinessRates(rates) {
  return (Array.isArray(rates) ? rates : []).map((rate, index) => ({
    id: String(rate.id || `business-rate-${index + 1}`),
    subjectName: String(rate.subjectName || "사업소득 강의").trim(),
    hourlyRate: Math.max(0, won(rate.hourlyRate))
  })).filter((rate) => rate.subjectName && rate.hourlyRate > 0);
}

function normalizeBusinessWorkLines(lines) {
  return (Array.isArray(lines) ? lines : []).map((line, index) => {
    const hours = Math.max(0, Number(line.hours) || 0);
    const hourlyRate = Math.max(0, won(line.hourlyRate));
    return {
      id: String(line.id || `business-work-${index + 1}`),
      rateId: line.rateId ? String(line.rateId) : null,
      subjectName: String(line.subjectName || "사업소득 강의").trim(),
      hours,
      hourlyRate,
      amount: won(hours * hourlyRate)
    };
  }).filter((line) => line.subjectName && line.hourlyRate > 0);
}

export function createMonthlyEarningLine(teacher, month, override = {}) {
  return createMonthlyEarningLines(teacher, month, override)[0] || null;
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
  }, { employee: 0, business: 0, other: 0, exempt: 0, pending: 0 });

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
  const month = earningLines.find((line) => line.month)?.month || overrides.month || null;
  const insuranceBases = resolveInsuranceBases(overrides, insuredBase, month);
  const combinedHealthOverride = overrides.healthAndLongTermCare == null
    ? null
    : won(overrides.healthAndLongTermCare);
  const deductions = {
    nationalPension: overrides.nationalPension == null
      ? applyRateWithBounds(insuranceBases.nationalPension, insurance.nationalPension)
      : won(overrides.nationalPension),
    healthInsurance: combinedHealthOverride != null
      ? combinedHealthOverride
      : overrides.healthInsurance == null
      ? applyRateWithBounds(insuranceBases.healthInsurance, insurance.healthInsurance)
      : won(overrides.healthInsurance),
    longTermCare: 0,
    employmentInsurance: overrides.employmentInsurance == null
      ? applyRateWithBounds(insuranceBases.employmentInsurance, insurance.employmentInsurance)
      : won(overrides.employmentInsurance),
    employeeIncomeTax: employeeTax,
    employeeLocalTax,
    businessIncomeTax,
    businessLocalTax,
    otherIncomeTax,
    otherLocalTax,
    custom: won(overrides.custom)
  };

  deductions.longTermCare = combinedHealthOverride != null
    ? 0
    : overrides.longTermCare == null
    ? won(deductions.healthInsurance * Number(insurance.longTermCareRate || 0))
    : won(overrides.longTermCare);

  const gross = Object.values(grossByTreatment).reduce((sum, amount) => sum + amount, 0);
  const totalDeductions = Object.values(deductions).reduce((sum, amount) => sum + amount, 0);
  const lectureFeeGross = earningLines
    .filter((line) => line.earningCategory === "lectureFee" && line.treatment === "business")
    .reduce((sum, line) => sum + line.amount, 0);
  const lectureIncomeTax = overrides.businessIncomeTax == null
    ? floorWon(lectureFeeGross * Number(taxPolicy.business?.incomeTaxRate || 0))
    : proportionalAmount(businessIncomeTax, lectureFeeGross, grossByTreatment.business);
  const lectureLocalTax = overrides.businessLocalTax == null
    ? won(lectureIncomeTax * Number(taxPolicy.business?.localIncomeTaxRateOfIncomeTax || 0))
    : proportionalAmount(businessLocalTax, lectureFeeGross, grossByTreatment.business);
  const insuranceTotal = deductions.nationalPension
    + deductions.healthInsurance
    + deductions.longTermCare
    + deductions.employmentInsurance;
  const taxTotal = totalDeductions - insuranceTotal - deductions.custom;
  const unconfirmedEarningLines = earningLines.filter((line) => line.treatment === "pending" && line.amount > 0);
  const reporting = {
    reportedGross: gross,
    classHours: earningLines.reduce((sum, line) => sum + Number(line.workHours ?? (line.earningCategory === "lectureFee" ? line.hours : 0) ?? 0), 0),
    lectureFeeGross,
    lectureWithholding: lectureIncomeTax + lectureLocalTax,
    additionalPaymentWithholding: (businessIncomeTax + businessLocalTax - lectureIncomeTax - lectureLocalTax)
      + otherIncomeTax + otherLocalTax,
    transportTrips: earningLines
      .filter((line) => line.earningCategory === "transport")
      .reduce((sum, line) => sum + Number(line.quantity ?? line.hours ?? 0), 0),
    transportAmount: categoryGross(earningLines, "transport"),
    parkingAmount: categoryGross(earningLines, "parking"),
    otherPaymentAmount: categoryGross(earningLines, "otherPayment"),
    employeeIncomeTax: deductions.employeeIncomeTax,
    employeeLocalTax: deductions.employeeLocalTax,
    healthAndLongTermCare: deductions.healthInsurance + deductions.longTermCare,
    nationalPension: deductions.nationalPension,
    employmentInsurance: deductions.employmentInsurance,
    insuranceTotal,
    taxTotal
  };

  return {
    earningLines,
    grossByTreatment,
    insuredBase,
    insuranceBases,
    employeeTaxablePay,
    otherIncomeTaxableAmount: otherTax.taxableIncome,
    otherIncomeGroups: otherTax.groups,
    gross,
    deductions,
    totalDeductions,
    net: gross - totalDeductions,
    reporting,
    unconfirmedEarningLines,
    policyVersion: `${taxPolicy.version} / ${insurancePolicy.version}`,
    taxPolicyVersion: taxPolicy.version,
    insurancePolicyVersion: insurancePolicy.version
  };
}

function resolveInsuranceBases(overrides, fallbackBase, month) {
  const configured = overrides.insuranceSettings;
  const baseFields = {
    nationalPension: "nationalPensionBase",
    healthInsurance: "healthInsuranceBase",
    employmentInsurance: "employmentInsuranceBase"
  };
  return Object.fromEntries(Object.entries(baseFields).map(([key, field]) => {
    if (!configured) {
      return [key, overrides[field] == null ? fallbackBase : Math.max(0, won(overrides[field]))];
    }
    const item = configured[key] || {};
    const active = item.enrolled === true && isActiveForMonth(item, month);
    if (!active) return [key, 0];
    const selected = overrides[field] ?? item.defaultBaseAmount ?? fallbackBase;
    return [key, Math.max(0, won(selected))];
  }));
}

function isActiveForMonth(item, month) {
  if (!month) return true;
  const target = String(month).length === 7 ? `${month}-01` : String(month);
  return (!item.effectiveFrom || item.effectiveFrom <= target)
    && (!item.effectiveTo || item.effectiveTo >= target);
}

function proportionalAmount(total, part, whole) {
  if (!whole || !part) return 0;
  return Math.min(total, won(total * part / whole));
}

function categoryGross(lines, category) {
  return lines.filter((line) => line.earningCategory === category)
    .reduce((sum, line) => sum + line.amount, 0);
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
  const amount = won(boundedBase * Number(rule.rate));
  return Math.max(
    Number(rule.minimumAmount || 0),
    Math.min(amount, Number(rule.maximumAmount || Number.MAX_SAFE_INTEGER))
  );
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

