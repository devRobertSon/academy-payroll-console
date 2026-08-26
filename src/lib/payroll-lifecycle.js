import { sanitizePersonNameInput } from "./person-name.js";

export function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

export function matchingTeachersForAccessRequest(request, teachers) {
  const requestEmail = normalizeEmail(request?.email);
  return teachers.filter((teacher) => (
    teacher.status === "active"
    && !teacher.authUid
    && normalizeEmail(teacher.email) === requestEmail
  ));
}

export function validateTeacherAccessApproval(request, teacher) {
  if (!request || request.status !== "pending") {
    throw new Error("이미 처리됐거나 유효하지 않은 접근 요청입니다.");
  }
  if (!teacher || teacher.status !== "active") {
    throw new Error("활성 상태인 선생님을 선택해 주세요.");
  }
  if (teacher.authUid) {
    throw new Error("이미 Google 계정이 연결된 선생님입니다.");
  }
  if (normalizeEmail(request.email) !== normalizeEmail(teacher.email)) {
    throw new Error("접근 요청과 선생님의 Google 이메일이 일치하지 않습니다.");
  }
  return true;
}

const TEACHER_DELETION_REFERENCE_SOURCES = [
  ["현재 급여명세서", "payslips"],
  ["급여명세서 발행 이력", "payslipVersions"],
  ["명세서 열람 기록", "payslipReceipts"],
  ["명세서 발송 기록", "payslipDeliveries"]
];

const TEACHER_DELETION_CLEANUP_SOURCES = [
  ["monthlyWorkInputs", "teacherMonthlyInputs"],
  ["overrides", "payrollOverrides"],
  ["adminNotifications", "adminNotifications"]
];

function collectionValues(value) {
  return Array.isArray(value) ? value : Object.values(value || {});
}

export function teacherDeletionBlockers(workspaceData, teacherId) {
  const teacherPayrollMonths = new Set([
    ...collectionValues(workspaceData?.monthlyWorkInputs),
    ...collectionValues(workspaceData?.overrides)
  ].filter((item) => item?.teacherId === teacherId && item.month).map((item) => item.month));
  const approvedPayrollCount = collectionValues(workspaceData?.payrollRuns)
    .filter((run) => ["published", "cancelled"].includes(run?.status) && teacherPayrollMonths.has(run.month))
    .length;
  const blockers = TEACHER_DELETION_REFERENCE_SOURCES.flatMap(([label, key]) => {
    const count = collectionValues(workspaceData?.[key])
      .filter((item) => item?.teacherId === teacherId).length;
    return count ? [{ key, label, count }] : [];
  });
  return approvedPayrollCount
    ? [{ key: "approvedPayrolls", label: "확정 급여", count: approvedPayrollCount }, ...blockers]
    : blockers;
}

export function teacherDeletionCleanupReferences(workspaceData, teacherId) {
  return TEACHER_DELETION_CLEANUP_SOURCES.flatMap(([key, collection]) => (
    collectionValues(workspaceData?.[key])
      .filter((item) => item?.teacherId === teacherId && item.id)
      .map((item) => ({ key, collection, id: item.id }))
  ));
}

export function validateTeacherDeletion(teacher, confirmationEmail, workspaceData) {
  if (!teacher?.id || !teacher.email) {
    throw new Error("삭제할 선생님 정보를 확인할 수 없습니다.");
  }
  if (normalizeEmail(confirmationEmail) !== normalizeEmail(teacher.email)) {
    throw new Error("등록된 Google 이메일을 정확히 입력해 주세요.");
  }
  const blockers = teacherDeletionBlockers(workspaceData, teacher.id);
  if (blockers.length) {
    const summary = blockers.map(({ label, count }) => `${label} ${count}건`).join(", ");
    throw new Error(`확정 급여 또는 급여명세서 기록이 있어 삭제할 수 없습니다. 계정을 비활성화해 주세요. (${summary})`);
  }
  return true;
}

export function nextPayrollRevision(run) {
  const current = Math.max(0, Number(run?.revision) || 0);
  return run?.status === "cancelled" ? current + 1 : Math.max(1, current);
}

export function artifactRevision(value) {
  return Math.max(1, Number(value?.revision) || 1);
}

export function payslipId(month, teacherId, incomeType = null) {
  const suffix = ["employee", "business"].includes(incomeType) ? `_${incomeType}` : "";
  return `${month}_${teacherId}${suffix}`;
}

export function provisionalTeacherForAccessRequest(request) {
  const uid = String(request?.uid || request?.id || "").replaceAll("/", "_");
  const email = normalizeEmail(request?.email);
  const displayName = sanitizePersonNameInput(request?.displayName).trim();
  const emailName = sanitizePersonNameInput(email.split("@")[0]).trim();
  return {
    id: `teacher-${uid}`,
    authUid: null,
    name: displayName || emailName || "신규 선생님",
    email,
    phone: "",
    status: "active",
    incomeComposition: "business",
    insuranceEnrolled: false,
    insuranceSettings: {
      nationalPension: { enrolled: false, defaultBaseAmount: null, effectiveFrom: null, effectiveTo: null },
      healthInsurance: { enrolled: false, defaultBaseAmount: null, effectiveFrom: null, effectiveTo: null },
      employmentInsurance: { enrolled: false, defaultBaseAmount: null, effectiveFrom: null, effectiveTo: null }
    },
    defaultEmployeePay: 0,
    defaultBusinessHourlyRate: 0,
    usesMultipleRates: false,
    businessRates: [],
    transportPolicy: { regionLabel: "", unitAmount: 0, treatment: "pending" },
    contractSummary: "사업소득",
    paymentDay: 10,
    taxProfile: { dependentCount: 1, children8To20: 0, withholdingRatio: 1 },
    profileCompleted: false,
    createdFromAccessRequest: true
  };
}

export function payslipVersionId(month, teacherId, revision, incomeType = null) {
  return `${payslipId(month, teacherId, incomeType)}_v${revision}`;
}

export function currentArtifactForRevision(items, teacherId, month, revision) {
  return items
    .filter((item) => item.teacherId === teacherId && item.month === month)
    .filter((item) => artifactRevision(item) === artifactRevision({ revision }))
    .sort((a, b) => timestampValue(b.sentAt || b.viewedAt) - timestampValue(a.sentAt || a.viewedAt))[0];
}

function timestampValue(value) {
  const date = value?.toDate ? value.toDate() : new Date(value || 0);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}
