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
    displayName: "정강사",
    email: "teacher05@example.invalid",
    status: "pending",
    requestedAt: "2026-08-25T09:00:00Z"
  }
];

export const demoTeachers = [
  {
    id: "teacher-01",
    authUid: "demo-teacher-01",
    name: "김강사",
    email: "teacher01@example.invalid",
    status: "active",
    employmentType: "insured",
    baseMonthlyPay: 3200000,
    subjects: ["초등 수학", "중등 수학"],
    contractSummary: "정규 월급제",
    paymentDay: 10,
    taxProfile: { dependentCount: 2, children8To20: 0, withholdingRatio: 1 }
  },
  {
    id: "teacher-02",
    authUid: "demo-teacher-02",
    name: "박강사",
    email: "teacher02@example.invalid",
    status: "active",
    employmentType: "freelancer",
    baseMonthlyPay: 2160000,
    subjects: ["중등 영어"],
    contractSummary: "프리랜서 월 지급",
    paymentDay: 10,
    taxProfile: { dependentCount: 1, children8To20: 0, withholdingRatio: 1 }
  },
  {
    id: "teacher-03",
    authUid: "demo-teacher-03",
    name: "이강사",
    email: "teacher03@example.invalid",
    status: "active",
    employmentType: "insured",
    baseMonthlyPay: 3000000,
    subjects: ["고등 수학", "논술 특강"],
    contractSummary: "정규 월급제",
    paymentDay: 12,
    taxProfile: { dependentCount: 4, children8To20: 2, withholdingRatio: 1 }
  },
  {
    id: "teacher-04",
    authUid: "demo-teacher-04",
    name: "최강사",
    email: "teacher04@example.invalid",
    status: "active",
    employmentType: "freelancer",
    baseMonthlyPay: 1200000,
    subjects: ["과학 실험"],
    contractSummary: "프리랜서 월 지급",
    paymentDay: 12,
    taxProfile: { dependentCount: 1, children8To20: 0, withholdingRatio: 1 }
  },
  {
    id: "teacher-05",
    authUid: null,
    name: "정강사",
    email: "teacher05@example.invalid",
    status: "active",
    employmentType: "freelancer",
    baseMonthlyPay: 0,
    subjects: ["중등 과학"],
    contractSummary: "계정 연결 대기",
    paymentDay: 10,
    taxProfile: { dependentCount: 1, children8To20: 0, withholdingRatio: 1 }
  }
];

export const demoRateRules = [
  { id: "rate-01", teacherId: "teacher-01", subjectId: "math-elementary", subjectName: "초등 수학", hourlyRate: 35000, treatment: "employee", insuranceCovered: true, effectiveFrom: "2026-01-01" },
  { id: "rate-02", teacherId: "teacher-01", subjectId: "math-middle", subjectName: "중등 수학", hourlyRate: 42000, treatment: "employee", insuranceCovered: true, effectiveFrom: "2026-01-01" },
  { id: "rate-03", teacherId: "teacher-02", subjectId: "english-middle", subjectName: "중등 영어", hourlyRate: 45000, treatment: "business", insuranceCovered: false, effectiveFrom: "2026-03-01" },
  { id: "rate-04", teacherId: "teacher-03", subjectId: "math-high", subjectName: "고등 수학", hourlyRate: 55000, treatment: "employee", insuranceCovered: true, effectiveFrom: "2026-01-01" },
  { id: "rate-05", teacherId: "teacher-03", subjectId: "essay-special", subjectName: "논술 특강", hourlyRate: 70000, treatment: "business", insuranceCovered: false, effectiveFrom: "2026-06-01" },
  { id: "rate-06", teacherId: "teacher-04", subjectId: "science-lab", subjectName: "과학 실험", hourlyRate: 50000, treatment: "exempt", insuranceCovered: false, effectiveFrom: "2026-01-01" }
];

export const demoEntries = [
  ...monthEntries("2026-08", [
    ["teacher-01", "math-elementary", "초등 수학", 34, 35000, "employee", true],
    ["teacher-01", "math-middle", "중등 수학", 22, 42000, "employee", true],
    ["teacher-02", "english-middle", "중등 영어", 48, 45000, "business", false],
    ["teacher-03", "math-high", "고등 수학", 30, 55000, "employee", true],
    ["teacher-03", "essay-special", "논술 특강", 9, 70000, "business", false],
    ["teacher-04", "science-lab", "과학 실험", 24, 50000, "exempt", false]
  ]),
  ...monthEntries("2026-07", [
    ["teacher-01", "math-elementary", "초등 수학", 32, 35000, "employee", true],
    ["teacher-01", "math-middle", "중등 수학", 24, 42000, "employee", true],
    ["teacher-02", "english-middle", "중등 영어", 45, 45000, "business", false],
    ["teacher-03", "math-high", "고등 수학", 28, 55000, "employee", true],
    ["teacher-03", "essay-special", "논술 특강", 8, 70000, "business", false],
    ["teacher-04", "science-lab", "과학 실험", 22, 50000, "exempt", false]
  ]),
  ...monthEntries("2026-06", [
    ["teacher-01", "math-elementary", "초등 수학", 30, 35000, "employee", true],
    ["teacher-02", "english-middle", "중등 영어", 42, 45000, "business", false],
    ["teacher-03", "math-high", "고등 수학", 26, 55000, "employee", true],
    ["teacher-03", "essay-special", "논술 특강", 6, 70000, "business", false],
    ["teacher-04", "science-lab", "과학 실험", 20, 50000, "exempt", false]
  ])
];

export const demoPayrollRuns = [
  { month: "2026-08", status: "draft", publishedAt: null },
  { month: "2026-07", status: "published", publishedAt: "2026-08-08T08:30:00Z" },
  { month: "2026-06", status: "published", publishedAt: "2026-07-08T08:30:00Z" }
];

export const demoOverrides = {
  "2026-08:teacher-02": {
    id: "2026-08_teacher-02",
    month: "2026-08",
    teacherId: "teacher-02",
    grossPay: 2250000,
    grossPayNote: "월 지급액 조정"
  }
};

function monthEntries(month, rows) {
  return rows.map((row, index) => ({
    id: `${month}-entry-${index + 1}`,
    month,
    workedOn: `${month}-15`,
    teacherId: row[0],
    subjectId: row[1],
    subjectName: row[2],
    hours: row[3],
    hourlyRate: row[4],
    treatment: row[5],
    insuranceCovered: row[6],
    source: "demo"
  }));
}
