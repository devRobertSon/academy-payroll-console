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

export const INCOME_COMPOSITION_LABELS = {
  employee: "근로소득",
  business: "사업소득",
  mixed: "근로소득 + 사업소득"
};

export const DEFAULT_BUSINESS_RATE_ID = "default-business-rate";

export function businessRateLabel(index = 0) {
  const normalizedIndex = Math.max(0, Math.floor(Number(index) || 0));
  return `시급 ${normalizedIndex + 1}`;
}

const INCOME_COMPOSITIONS = new Set(Object.keys(INCOME_COMPOSITION_LABELS));

const won = (value) => Math.round(Number(value) || 0);
const floorWon = (value) => Math.floor(Math.max(0, Number(value) || 0));
const floorTenWon = (value) => Math.floor(Math.max(0, Number(value) || 0) / 10) * 10;
const floorToUnit = (value, unit = 1) => {
  const normalizedUnit = Math.max(1, Math.floor(Number(unit) || 1));
  return Math.floor(Math.max(0, Number(value) || 0) / normalizedUnit) * normalizedUnit;
};

export function calculateEarning(entry) {
  const quantity = Number(entry.hours ?? entry.quantity ?? 0);
  const rate = Number(entry.hourlyRate ?? entry.unitRate ?? 0);
  return won(quantity * rate + Number(entry.adjustment || 0));
}

export function resolveIncomeComposition(teacher = {}) {
  if (INCOME_COMPOSITIONS.has(teacher.incomeComposition)) return teacher.incomeComposition;

  const hasEmployeeIncome = Number(teacher.defaultEmployeePay) > 0
    || teacher.insuranceEnrolled === true
    || Object.values(teacher.insuranceSettings || {}).some((item) => item?.enrolled === true);
  const hasBusinessIncome = Number(teacher.defaultBusinessHourlyRate) > 0
    || (Array.isArray(teacher.businessRates) && teacher.businessRates.length > 0);

  if (hasEmployeeIncome && hasBusinessIncome) return "mixed";
  if (hasBusinessIncome) return "business";
  return "employee";
}

export function getTeacherPaySettings(teacher = {}) {
  const incomeComposition = resolveIncomeComposition(teacher);
  const hasEmployeeIncome = incomeComposition === "employee" || incomeComposition === "mixed";
  const hasBusinessIncome = incomeComposition === "business" || incomeComposition === "mixed";
  const insuranceSettings = hasEmployeeIncome
    ? normalizeInsuranceSettings(teacher.insuranceSettings, teacher.insuranceEnrolled === true)
    : normalizeInsuranceSettings();
  const configuredBusinessRates = hasBusinessIncome ? normalizeBusinessRates(teacher.businessRates) : [];
  const defaultBusinessHourlyRate = hasBusinessIncome
    ? Math.max(0, won(teacher.defaultBusinessHourlyRate))
    : 0;
  const usesMultipleRates = hasBusinessIncome && teacher.usesMultipleRates === true;
  const businessRates = usesMultipleRates
    ? configuredBusinessRates
    : defaultBusinessHourlyRate > 0
      ? [{ id: DEFAULT_BUSINESS_RATE_ID, hourlyRate: defaultBusinessHourlyRate }]
      : [];
  return {
    incomeComposition,
    insuranceEnrolled: Object.values(insuranceSettings).some((item) => item.enrolled),
    insuranceSettings,
    defaultEmployeePay: hasEmployeeIncome ? Math.max(0, won(teacher.defaultEmployeePay)) : 0,
    defaultBusinessHourlyRate,
    usesMultipleRates,
    configuredBusinessRates,
    businessRates,
    transportPolicy: normalizeTransportPolicy(teacher.transportPolicy),
    source: "current"
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
  } else {
    employeeGrossPay = override.employeeGrossPay == null
      ? settings.defaultEmployeePay
      : Math.max(0, won(override.employeeGrossPay));
    businessGrossPay = 0;
    businessHours = 0;
    businessWorkLines = settings.businessRates.map((rate) => ({
      ...rate,
      rateId: rate.id,
      hours: 0,
      amount: 0
    }));
    source = "teacher-default";
  }

  const employeeWorkHours = Math.max(0, Number(override.employeeWorkHours) || 0);
  const transportTrips = Math.max(0, Math.floor(Number(override.transportTrips) || 0));
  const transportUnitAmount = override.transportUnitAmount == null
    ? settings.transportPolicy.unitAmount
    : Math.max(0, won(override.transportUnitAmount));
  const manualTransportAmount = won(transportTrips * transportUnitAmount);
  const transportTreatment = normalizeTreatment(
    override.transportTreatment || settings.transportPolicy.treatment
  );
  const manualParkingAmount = Math.max(0, won(override.parkingAmount));
  const parkingTreatment = normalizeTreatment(override.parkingTreatment);
  const approvedReceiptEarnings = normalizeApprovedReceiptEarnings(override.approvedReceiptEarnings);
  const receiptTransportAmount = approvedReceiptEarnings
    .filter((line) => line.category === "transport")
    .reduce((sum, line) => sum + line.amount, 0);
  const receiptParkingAmount = approvedReceiptEarnings
    .filter((line) => line.category === "parking")
    .reduce((sum, line) => sum + line.amount, 0);
  const transportAmount = manualTransportAmount + receiptTransportAmount;
  const parkingAmount = manualParkingAmount + receiptParkingAmount;
  const additionalEarnings = normalizeAdditionalEarnings(override.additionalEarnings);
  const otherPaymentAmount = additionalEarnings.reduce((sum, line) => sum + line.amount, 0);
  const additionalGrossPay = transportAmount
    + parkingAmount
    + otherPaymentAmount;
  const unconfirmedCount = Number(manualTransportAmount > 0 && transportTreatment === "pending")
    + Number(manualParkingAmount > 0 && parkingTreatment === "pending")
    + approvedReceiptEarnings.filter((line) => line.treatment === "pending").length
    + additionalEarnings.filter((line) => line.amount > 0 && line.treatment === "pending").length;

  return {
    employeeGrossPay,
    employeeWorkHours,
    businessGrossPay,
    businessHours,
    businessWorkLines,
    transportTrips,
    transportUnitAmount,
    manualTransportAmount,
    receiptTransportAmount,
    transportAmount,
    transportTreatment,
    transportInsuranceCovered: override.transportInsuranceCovered === true,
    manualParkingAmount,
    receiptParkingAmount,
    parkingAmount,
    parkingTreatment,
    parkingInsuranceCovered: override.parkingInsuranceCovered === true,
    approvedReceiptEarnings,
    additionalEarnings,
    otherPaymentAmount,
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
      subjectName: businessRateLabel(index),
      earningCategory: "lectureFee",
      hours: line.hours,
      hourlyRate: line.hourlyRate,
      treatment: "business",
      insuranceCovered: false,
      note: override.grossPayNote || null,
      source: amounts.source
    }));
  }

  if (amounts.manualTransportAmount > 0) {
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
  if (amounts.manualParkingAmount > 0) {
    lines.push({
      id: `${month}_${teacher.id}_parking`,
      month,
      teacherId: teacher.id,
      kind: "monthly",
      subjectName: "주차료",
      earningCategory: "parking",
      hours: 1,
      hourlyRate: amounts.manualParkingAmount,
      treatment: amounts.parkingTreatment,
      insuranceCovered: amounts.parkingInsuranceCovered,
      source: amounts.source
    });
  }
  amounts.approvedReceiptEarnings.forEach((receipt) => {
    lines.push({
      id: `${month}_${teacher.id}_receipt-${receipt.id}`,
      month,
      teacherId: teacher.id,
      kind: "monthly",
      subjectName: `${receipt.category === "transport" ? "교통비" : "주차료"} 영수증 정산`,
      earningCategory: receipt.category,
      hours: 1,
      quantity: 0,
      hourlyRate: receipt.amount,
      treatment: receipt.treatment,
      insuranceCovered: receipt.insuranceCovered,
      expenseReceiptId: receipt.id,
      note: receipt.expenseDate,
      source: "approved-expense-receipt"
    });
  });
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

function normalizeApprovedReceiptEarnings(lines) {
  return (Array.isArray(lines) ? lines : []).map((line, index) => ({
    id: String(line.id || `receipt-${index + 1}`),
    category: line.category === "parking" ? "parking" : "transport",
    amount: Math.max(0, won(line.amount)),
    treatment: normalizeTreatment(line.treatment),
    insuranceCovered: line.insuranceCovered === true,
    expenseDate: line.expenseDate || null
  })).filter((line) => line.amount > 0);
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
    hourlyRate: Math.max(0, won(rate.hourlyRate))
  })).filter((rate) => rate.hourlyRate > 0);
}

function normalizeBusinessWorkLines(lines) {
  return (Array.isArray(lines) ? lines : []).map((line, index) => {
    const hours = Math.max(0, Number(line.hours) || 0);
    const hourlyRate = Math.max(0, won(line.hourlyRate));
    return {
      id: String(line.id || `business-work-${index + 1}`),
      rateId: line.rateId ? String(line.rateId) : null,
      hours,
      hourlyRate,
      amount: won(hours * hourlyRate)
    };
  }).filter((line) => line.hourlyRate > 0);
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
    ? floorToUnit(
      deductions.healthInsurance * Number(insurance.longTermCareRate || 0),
      insurance.longTermCareRoundingUnit || insurance.healthInsurance?.roundingUnit || 1
    )
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

export function splitPayrollByIncome(payroll, policyBundle, taxProfile = {}) {
  const earningLines = Array.isArray(payroll?.earningLines) ? payroll.earningLines : [];
  if (!earningLines.length) return [];

  const hasEmployeeIncome = Number(payroll.grossByTreatment?.employee) > 0;
  const hasBusinessIncome = Number(payroll.grossByTreatment?.business) > 0;
  const specifications = hasEmployeeIncome && hasBusinessIncome
    ? [
      { incomeType: "employee", lines: earningLines.filter((line) => line.treatment !== "business") },
      { incomeType: "business", lines: earningLines.filter((line) => line.treatment === "business") }
    ]
    : [{ incomeType: hasBusinessIncome ? "business" : "employee", lines: earningLines }];
  const deductions = payroll.deductions || {};
  const bases = payroll.insuranceBases || {};

  return specifications.filter(({ lines }) => lines.length).map(({ incomeType, lines }) => {
    const employeeDocument = incomeType === "employee";
    const includesOtherIncome = lines.some((line) => line.treatment === "other");
    const split = calculatePayroll(lines, policyBundle, {
      nationalPension: employeeDocument ? deductions.nationalPension : 0,
      healthInsurance: employeeDocument ? deductions.healthInsurance : 0,
      longTermCare: employeeDocument ? deductions.longTermCare : 0,
      employmentInsurance: employeeDocument ? deductions.employmentInsurance : 0,
      employeeIncomeTax: employeeDocument ? deductions.employeeIncomeTax : 0,
      employeeLocalTax: employeeDocument ? deductions.employeeLocalTax : 0,
      businessIncomeTax: incomeType === "business" ? deductions.businessIncomeTax : 0,
      businessLocalTax: incomeType === "business" ? deductions.businessLocalTax : 0,
      otherIncomeTax: includesOtherIncome ? deductions.otherIncomeTax : 0,
      otherLocalTax: includesOtherIncome ? deductions.otherLocalTax : 0,
      custom: employeeDocument || !hasEmployeeIncome ? deductions.custom : 0,
      nationalPensionBase: employeeDocument ? bases.nationalPension : 0,
      healthInsuranceBase: employeeDocument ? bases.healthInsurance : 0,
      employmentInsuranceBase: employeeDocument ? bases.employmentInsurance : 0
    }, taxProfile);

    return {
      incomeType,
      incomeLabel: INCOME_COMPOSITION_LABELS[incomeType],
      payroll: {
        ...split,
        policyVersion: payroll.policyVersion || split.policyVersion,
        taxPolicyVersion: payroll.taxPolicyVersion || split.taxPolicyVersion,
        insurancePolicyVersion: payroll.insurancePolicyVersion || split.insurancePolicyVersion
      }
    };
  });
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
  const calculationBase = floorToUnit(boundedBase, rule.baseUnit || 1);
  const calculatedAmount = Number((calculationBase * Number(rule.rate)).toFixed(8));
  const amount = floorToUnit(
    calculatedAmount,
    rule.roundingUnit || 1
  );
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

