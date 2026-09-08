import { applicableBusinessWorkLines, isTuitionShare, tuitionBasis } from "./payroll.js";

export const MAX_MONTHLY_WORK_HOURS = 744;

export function monthlyWorkInputId(month, teacherId) {
  return `${month}_${teacherId}`;
}

export function normalizeMonthlyHours(value) {
  const hours = Number(value);
  if (!Number.isFinite(hours) || hours < 0) return 0;
  return Math.min(MAX_MONTHLY_WORK_HOURS, hours);
}

export function buildBusinessHours(rates, values = {}) {
  return Object.fromEntries((rates || []).filter((rate) => !isTuitionShare(rate)).map((rate) => [
    rate.id,
    normalizeMonthlyHours(values[rate.id])
  ]));
}

export function businessHoursFromWorkLines(rates, workLines = []) {
  const byRate = new Map((workLines || []).filter((line) => line.rateId).map((line) => [line.rateId, line.hours]));
  return buildBusinessHours(rates, Object.fromEntries(byRate));
}

export function submittedTuitionBasis(input = null) {
  return tuitionBasis(input && Object.hasOwn(input, "groups")
    ? { tuitionGroups: input.groups }
    : { tuitionAmount: input?.tuitionAmount });
}

export function mergeMonthlyWorkInput(rates, payrollOverride = {}, monthlyInput = null) {
  if (!monthlyInput) return payrollOverride;

  const approvedRateIds = new Set((rates || []).map((rate) => rate.id));
  const adminOnlyLines = applicableBusinessWorkLines(rates || [], payrollOverride.businessWorkLines || [])
    .filter((line) => !line.rateId || !approvedRateIds.has(line.rateId));
  const businessWorkLines = (rates || []).map((rate) => {
    if (!isTuitionShare(rate)) return {
      ...rate, rateId: rate.id, hours: normalizeMonthlyHours(monthlyInput.businessHours?.[rate.id])
    };
    const saved = (payrollOverride.businessWorkLines || []).find((line) => line.rateId === rate.id);
    const savedBasis = tuitionBasis(saved || {});
    const submitted = monthlyInput.tuitionInput?.rateId === rate.id ? monthlyInput.tuitionInput : null;
    // An administrator's completed tuition entry wins over later teacher submissions.
    const basis = savedBasis.tuitionPending && submitted
      ? submittedTuitionBasis(submitted) : savedBasis;
    return {
      ...rate, rateId: rate.id, ...basis,
      tuitionShareRate: saved?.tuitionShareRate ?? rate.tuitionShareRate,
      hours: 0
    };
  });

  return {
    ...payrollOverride,
    employeeWorkHours: normalizeMonthlyHours(monthlyInput.employeeWorkHours),
    businessWorkLines: [...businessWorkLines, ...adminOnlyLines]
  };
}

