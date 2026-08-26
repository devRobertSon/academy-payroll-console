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
  const displayName = String(request?.displayName || "").trim();
  const email = normalizeEmail(request?.email);
  return {
    id: `teacher-${uid}`,
    authUid: null,
    name: displayName || email.split("@")[0] || "신규 선생님",
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
    defaultBusinessPay: 0,
    defaultBusinessHourlyRate: 0,
    usesSubjectRates: false,
    businessRates: [],
    subjects: [],
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
