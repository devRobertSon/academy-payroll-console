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
  return Object.fromEntries((rates || []).map((rate) => [
    rate.id,
    normalizeMonthlyHours(values[rate.id])
  ]));
}

export function businessHoursFromWorkLines(rates, workLines = []) {
  const byRate = new Map((workLines || []).filter((line) => line.rateId).map((line) => [line.rateId, line.hours]));
  return buildBusinessHours(rates, Object.fromEntries(byRate));
}

export function mergeMonthlyWorkInput(rates, payrollOverride = {}, monthlyInput = null) {
  if (!monthlyInput) return payrollOverride;

  const approvedRateIds = new Set((rates || []).map((rate) => rate.id));
  const adminOnlyLines = (payrollOverride.businessWorkLines || [])
    .filter((line) => !line.rateId || !approvedRateIds.has(line.rateId));
  const businessWorkLines = (rates || []).map((rate) => ({
    ...rate,
    rateId: rate.id,
    hours: normalizeMonthlyHours(monthlyInput.businessHours?.[rate.id])
  }));

  return {
    ...payrollOverride,
    employeeWorkHours: normalizeMonthlyHours(monthlyInput.employeeWorkHours),
    businessWorkLines: [...businessWorkLines, ...adminOnlyLines]
  };
}

