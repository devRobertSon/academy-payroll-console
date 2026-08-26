import {
  createCombinedPolicy,
  demoInsurancePolicy,
  ntsTaxPolicy2024
} from "./nts-tax-policy.js";

export const demoPolicy = createCombinedPolicy(ntsTaxPolicy2024, demoInsurancePolicy);

export const demoUsers = {
  admin: {
    uid: "demo-admin",
    name: "운영 관리자",
    email: "admin@example.invalid",
    role: "admin"
  },
  teacher: {
    uid: "demo-teacher-03",
    teacherId: "teacher-03",
    name: "이강사",
    email: "teacher03@example.invalid",
    role: "teacher"
  }
};

export const demoAccessRequests = [
  {
    id: "demo-pending-teacher",
    uid: "demo-pending-teacher",
    displayName: "신규강사",
    email: "teacher06@example.invalid",
    status: "pending",
    requestedAt: "2026-08-25T09:00:00Z"
  }
];

export const demoAdminNotifications = [
  {
    id: "work-hours_2026-08_teacher-03",
    type: "teacher_monthly_input_submitted",
    teacherId: "teacher-03",
    teacherUid: "demo-teacher-03",
    month: "2026-08",
    status: "unread",
    submittedAt: "2026-08-26T09:30:00Z",
    readAt: null,
    readBy: null
  }
];

export const demoTeachers = [
  {
    id: "teacher-01",
    authUid: "demo-teacher-01",
    name: "김강사",
    email: "teacher01@example.invalid",
    phone: "010-0000-0001",
    birthDateCode: "900101",
    genderCode: "1",
    status: "active",
    incomeComposition: "employee",
    insuranceEnrolled: true,
    insuranceSettings: {
      nationalPension: { enrolled: true, defaultBaseAmount: 3200000, effectiveFrom: "2026-01-01", effectiveTo: null },
      healthInsurance: { enrolled: true, defaultBaseAmount: 3200000, effectiveFrom: "2026-01-01", effectiveTo: null },
      employmentInsurance: { enrolled: true, defaultBaseAmount: 3200000, effectiveFrom: "2026-01-01", effectiveTo: null }
    },
    defaultEmployeePay: 3200000,
    defaultBusinessHourlyRate: 0,
    usesMultipleRates: false,
    businessRates: [],
    contractSummary: "근로소득",
    paymentDay: 10,
    profileCompleted: true,
    taxProfile: { dependentCount: 2, children8To20: 0, withholdingRatio: 1 }
  },
  {
    id: "teacher-02",
    authUid: "demo-teacher-02",
    name: "박강사",
    email: "teacher02@example.invalid",
    phone: "010-0000-0002",
    birthDateCode: "910202",
    genderCode: "2",
    status: "active",
    incomeComposition: "business",
    insuranceEnrolled: false,
    defaultEmployeePay: 0,
    defaultBusinessHourlyRate: 45000,
    usesMultipleRates: false,
    businessRates: [],
    transportPolicy: { regionLabel: "서울 시내", unitAmount: 1500, treatment: "business" },
    contractSummary: "사업소득",
    paymentDay: 10,
    profileCompleted: true,
    taxProfile: { dependentCount: 1, children8To20: 0, withholdingRatio: 1 }
  },
  {
    id: "teacher-03",
    authUid: "demo-teacher-03",
    name: "이강사",
    email: "teacher03@example.invalid",
    phone: "010-0000-0003",
    birthDateCode: "920303",
    genderCode: "1",
    status: "active",
    incomeComposition: "mixed",
    insuranceEnrolled: true,
    defaultEmployeePay: 3000000,
    defaultBusinessHourlyRate: 0,
    usesMultipleRates: true,
    businessRates: [
      { id: "business-rate-03-a", hourlyRate: 70000 },
      { id: "business-rate-03-b", hourlyRate: 85000 }
    ],
    contractSummary: "근로소득 + 사업소득",
    paymentDay: 12,
    profileCompleted: true,
    taxProfile: { dependentCount: 4, children8To20: 2, withholdingRatio: 1 }
  },
  {
    id: "teacher-04",
    authUid: "demo-teacher-04",
    name: "최강사",
    email: "teacher04@example.invalid",
    phone: "010-0000-0004",
    birthDateCode: "930404",
    genderCode: "2",
    status: "active",
    incomeComposition: "business",
    insuranceEnrolled: false,
    defaultEmployeePay: 0,
    defaultBusinessHourlyRate: 50000,
    usesMultipleRates: false,
    businessRates: [],
    contractSummary: "사업소득",
    paymentDay: 12,
    profileCompleted: true,
    taxProfile: { dependentCount: 1, children8To20: 0, withholdingRatio: 1 }
  },
  {
    id: "teacher-05",
    authUid: null,
    name: "정강사",
    email: "teacher05@example.invalid",
    phone: "010-0000-0005",
    birthDateCode: "940505",
    genderCode: "1",
    status: "active",
    incomeComposition: "business",
    insuranceEnrolled: false,
    defaultEmployeePay: 0,
    defaultBusinessHourlyRate: 50000,
    usesMultipleRates: false,
    businessRates: [],
    contractSummary: "사업소득",
    paymentDay: 10,
    profileCompleted: true,
    taxProfile: { dependentCount: 1, children8To20: 0, withholdingRatio: 1 }
  }
];

export const demoPayrollRuns = [
  { month: "2026-08", status: "draft", publishedAt: null },
  { month: "2026-07", status: "published", publishedAt: "2026-08-08T08:30:00Z" },
  { month: "2026-06", status: "published", publishedAt: "2026-07-08T08:30:00Z" }
];

export const demoOverrides = Object.fromEntries([
  ["2026-08", "teacher-02", [["default-business-rate", 45000, 50]]],
  ["2026-07", "teacher-02", [["default-business-rate", 45000, 45]]],
  ["2026-06", "teacher-02", [["default-business-rate", 45000, 42]]],
  ["2026-08", "teacher-03", [["business-rate-03-a", 70000, 10], ["business-rate-03-b", 85000, 2]]],
  ["2026-07", "teacher-03", [["business-rate-03-a", 70000, 8], ["business-rate-03-b", 85000, 1]]],
  ["2026-06", "teacher-03", [["business-rate-03-a", 70000, 6], ["business-rate-03-b", 85000, 1]]],
  ["2026-08", "teacher-04", [["default-business-rate", 50000, 24]]],
  ["2026-07", "teacher-04", [["default-business-rate", 50000, 22]]],
  ["2026-06", "teacher-04", [["default-business-rate", 50000, 20]]]
].map(([month, teacherId, rateRows]) => {
  const id = `${month}_${teacherId}`;
  return [`${month}:${teacherId}`, {
    id,
    month,
    teacherId,
    businessWorkLines: rateRows.map(([rateId, hourlyRate, hours], index) => ({
      id: `${id}_business-${index + 1}`,
      rateId,
      hourlyRate,
      hours
    })),
    ...(month === "2026-08" && teacherId === "teacher-02" ? {
      transportTrips: 20,
      transportUnitAmount: 1500,
      transportTreatment: "business",
      parkingAmount: 10000,
      parkingTreatment: "exempt",
      additionalEarnings: [{ id: `${id}_materials`, label: "교재 준비비", amount: 20000, treatment: "business", insuranceCovered: false }]
    } : {}),
    grossPayNote: month === "2026-08" ? "월 수업 시수 입력" : null
  }];
}));

export const demoTeacherMonthlyInputs = Object.fromEntries(Object.values(demoOverrides).map((override) => {
  const teacher = demoTeachers.find((item) => item.id === override.teacherId);
  const input = {
    id: `${override.month}_${override.teacherId}`,
    month: override.month,
    teacherId: override.teacherId,
    teacherUid: teacher?.authUid || "",
    employeeWorkHours: override.teacherId === "teacher-03" ? 30 : 0,
    businessHours: Object.fromEntries((override.businessWorkLines || [])
      .filter((line) => line.rateId)
      .map((line) => [line.rateId, line.hours])),
    submittedAt: `${override.month}-25T09:00:00Z`
  };
  return [`${override.month}:${override.teacherId}`, input];
}));
