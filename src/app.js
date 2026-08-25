import { appConfig } from "./config.js?v=20260826-notifications-r7";
import { helpArticles } from "./data/help-content.js?v=20260826-notifications-r7";
import {
  demoAccessRequests,
  demoAdminNotifications,
  demoEntries,
  demoOverrides,
  demoPayrollRuns,
  demoRateRules,
  demoTeacherMonthlyInputs,
  demoTeachers,
  demoUsers
} from "./data/demo-data.js?v=20260826-notifications-r7";
import {
  createCombinedPolicy,
  ntsTaxPolicy2024,
  officialInsurancePolicies
} from "./data/nts-tax-policy.js?v=20260826-notifications-r7";
import { createFirebaseStore } from "./lib/firebase-store.js?v=20260826-notifications-r7";
import { buildGeminiPrompt, buildLocalHelpAnswer, detectSensitiveInput, searchHelpArticles } from "./lib/help-assistant.js";
import { csvRowsToObjects, parseCsv } from "./lib/csv.js";
import { buildGmailMessage, fileToBytes } from "./lib/gmail.js";
import { createPayslipPdfFile, downloadFile, payslipFilename } from "./lib/payslip-file.js";
import {
  artifactRevision,
  currentArtifactForRevision,
  matchingTeachersForAccessRequest,
  nextPayrollRevision,
  normalizeEmail,
  payslipId,
  payslipVersionId,
  validateTeacherAccessApproval
} from "./lib/payroll-lifecycle.js";
import {
  calculatePayroll,
  createMonthlyEarningLines,
  getMonthlyPayAmounts,
  getTeacherPaySettings,
  INSURANCE_LABELS,
  parseEmploymentTaxTableRows,
  resolveEffectivePolicy,
  summarizePayroll,
  TREATMENT_LABELS
} from "./lib/payroll.js?v=20260826-notifications-r7";
import { downloadCsv, escapeHtml as e, formatHours, formatMonth, formatNumber, formatWon } from "./lib/format.js";
import { formatTeacherIdentity, validateOptionalTeacherIdentity, validateTeacherIdentity } from "./lib/teacher-identity.js?v=20260826-notifications-r7";
import { WORK_HOURS_NOTIFICATION_TYPE, unreadWorkHoursNotifications } from "./lib/admin-notifications.js?v=20260826-notifications-r7";
import {
  buildBusinessHours,
  businessHoursFromWorkLines,
  mergeMonthlyWorkInput,
  monthlyWorkInputId
} from "./lib/teacher-self-service.js?v=20260826-notifications-r7";

const state = {
  user: null,
  view: "dashboard",
  month: currentCalendarMonth(),
  search: "",
  selectedTeacherId: null,
  selectedPayslipMonth: currentCalendarMonth(),
  helpSearch: "",
  assistantMessages: [],
  assistantBusy: false,
  store: null,
  data: {
    teachers: [],
    rateRules: [],
    entries: [],
    payrollRuns: [],
    taxPolicies: [],
    insurancePolicies: [],
    overrides: {},
    monthlyWorkInputs: {},
    payslips: [],
    payslipVersions: [],
    payslipReceipts: [],
    payslipDeliveries: [],
    payrollCancellations: [],
    accessRequests: [],
    adminNotifications: []
  }
};

const elements = {
  login: document.querySelector("#login-view"),
  workspace: document.querySelector("#workspace"),
  loginStatus: document.querySelector("#login-status"),
  demoLogin: document.querySelector("#demo-login"),
  nav: document.querySelector("#main-nav"),
  pageTitle: document.querySelector("#page-title"),
  pageEyebrow: document.querySelector("#page-eyebrow"),
  topbarActions: document.querySelector("#topbar-actions"),
  content: document.querySelector("#page-content"),
  assistantEntry: document.querySelector("#assistant-entry"),
  helpNavButton: document.querySelector("#help-nav-button"),
  assistantToggle: document.querySelector("#assistant-toggle"),
  assistantPanel: document.querySelector("#assistant-panel"),
  assistantClose: document.querySelector("#assistant-close"),
  assistantMessages: document.querySelector("#assistant-messages"),
  assistantStatus: document.querySelector("#assistant-status"),
  assistantForm: document.querySelector("#assistant-form"),
  assistantInput: document.querySelector("#assistant-input"),
  modalRoot: document.querySelector("#modal-root"),
  toastRoot: document.querySelector("#toast-root")
};

const adminNav = [
  ["업무", "dashboard", "layout-dashboard", "급여 대시보드"],
  ["업무", "payrollInputs", "wallet-cards", "월 급여 입력"],
  ["관리", "teachers", "users-round", "선생님 관리"],
  ["보고", "ledger", "notebook-tabs", "월별 급여내역서"],
  ["시스템", "settings", "settings", "계산 · 보안 설정"]
];

const teacherNav = [
  ["내 업무", "workHours", "calendar-clock", "수업시간 입력"],
  ["내 급여", "payslips", "file-text", "급여명세서"],
  ["내 정보", "profile", "circle-user-round", "등록 정보"]
];

await bootstrap();

async function bootstrap() {
  document.querySelectorAll("#login-academy-name, #sidebar-academy-name").forEach((node) => {
    node.textContent = appConfig.academyName;
  });

  bindStaticEvents();
  if (appConfig.demoMode) {
    loadDemoData();
    elements.demoLogin.hidden = false;
  } else {
    try {
      state.store = await createFirebaseStore(appConfig.firebase);
      const restored = await state.store.restoreSession();
      if (restored) await openWorkspace(restored);
    } catch (error) {
      setLoginStatus(error.message || "Firebase 연결을 확인해 주세요.");
    }
  }
  refreshIcons();
}

function bindStaticEvents() {
  document.querySelector("#google-login").addEventListener("click", async () => {
    if (appConfig.demoMode) {
      setLoginStatus("현재 데모 모드입니다. 아래 관리자 또는 선생님 데모를 선택해 주세요.");
      return;
    }
    try {
      setLoginStatus("Google 계정을 확인하고 있습니다.", false);
      await openWorkspace(await state.store.signIn());
    } catch (error) {
      setLoginStatus(error.message || "로그인하지 못했습니다.");
    }
  });

  document.querySelectorAll("[data-demo-role]").forEach((button) => {
    button.addEventListener("click", () => openWorkspace(demoUsers[button.dataset.demoRole]));
  });
  document.querySelector("#logout-button").addEventListener("click", logout);
  document.querySelector("#mobile-menu").addEventListener("click", () => elements.workspace.classList.toggle("menu-open"));
  elements.assistantToggle.addEventListener("click", openAssistant);
  elements.helpNavButton.addEventListener("click", () => {
    state.view = "help";
    elements.workspace.classList.remove("menu-open");
    render();
    window.scrollTo({ top: 0, left: 0 });
  });
  elements.assistantClose.addEventListener("click", closeAssistant);
  elements.assistantForm.addEventListener("submit", submitAssistantQuestion);
  elements.assistantMessages.addEventListener("click", (event) => {
    const button = event.target.closest("[data-assistant-question]");
    if (!button) return;
    elements.assistantInput.value = button.dataset.assistantQuestion;
    elements.assistantForm.requestSubmit();
  });
  elements.nav.addEventListener("click", (event) => {
    const button = event.target.closest("[data-view]");
    if (!button) return;
    state.view = button.dataset.view;
    elements.workspace.classList.remove("menu-open");
    render();
    window.scrollTo({ top: 0, left: 0 });
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (!elements.assistantPanel.hidden) closeAssistant();
    else closeModal();
  });
}

function loadDemoData() {
  state.data = {
    teachers: structuredClone(demoTeachers),
    rateRules: structuredClone(demoRateRules),
    entries: structuredClone(demoEntries),
    payrollRuns: structuredClone(demoPayrollRuns),
    taxPolicies: [structuredClone(ntsTaxPolicy2024)],
    insurancePolicies: officialInsurancePolicies.map((policy) => structuredClone(policy)),
    overrides: structuredClone(demoOverrides),
    monthlyWorkInputs: structuredClone(demoTeacherMonthlyInputs),
    payslips: [],
    payslipVersions: [],
    payslipReceipts: [],
    payslipDeliveries: [],
    payrollCancellations: [],
    accessRequests: structuredClone(demoAccessRequests),
    adminNotifications: structuredClone(demoAdminNotifications)
  };
}

async function openWorkspace(user) {
  if (!user) return;
  state.user = user;
  state.view = user.role === "teacher" ? "workHours" : "dashboard";
  state.selectedTeacherId = user.teacherId || state.data.teachers[0]?.id || null;
  if (!appConfig.demoMode) {
    const loaded = await state.store.loadWorkspace(user);
    hydrateFirebaseData(loaded);
  }
  elements.login.hidden = true;
  elements.workspace.hidden = false;
  elements.assistantEntry.hidden = user.role !== "admin";
  if (user.role === "admin") initializeAssistant();
  else closeAssistant();
  document.querySelector("#user-name").textContent = user.name;
  document.querySelector("#user-role").textContent = roleLabel(user.role);
  document.querySelector("#user-avatar").textContent = user.name.slice(0, 1);
  render();
  const unreadCount = unreadAdminNotificationItems().length;
  if (user.role === "admin" && unreadCount) {
    showToast(`새 수업시간 제출 알림이 ${unreadCount}건 있습니다.`);
  }
}

function hydrateFirebaseData(loaded) {
  state.data.teachers = loaded.teachers || [];
  state.data.rateRules = loaded.rateRules || [];
  state.data.entries = loaded.entries || [];
  state.data.payrollRuns = loaded.payrollRuns || [];
  state.data.taxPolicies = mergeBuiltInTaxPolicies(loaded.taxPolicies || []);
  state.data.insurancePolicies = mergeBuiltInInsurancePolicies(loaded.insurancePolicies || []);
  state.data.payslips = loaded.payslips || [];
  state.data.payslipVersions = loaded.payslipVersions || [];
  state.data.payslipReceipts = loaded.payslipReceipts || [];
  state.data.payslipDeliveries = loaded.payslipDeliveries || [];
  state.data.payrollCancellations = loaded.payrollCancellations || [];
  state.data.accessRequests = loaded.accessRequests || [];
  state.data.adminNotifications = loaded.adminNotifications || [];
  state.data.overrides = Object.fromEntries((loaded.payrollOverrides || []).map((item) => [`${item.month}:${item.teacherId}`, item]));
  state.data.monthlyWorkInputs = Object.fromEntries((loaded.teacherMonthlyInputs || []).map((item) => [`${item.month}:${item.teacherId}`, item]));
  const latestRunMonth = state.data.payrollRuns.map((run) => run.month).sort().at(-1);
  const latestInputMonth = Object.values(state.data.monthlyWorkInputs).map((input) => input.month).sort().at(-1);
  if (state.user?.role === "teacher") {
    state.month = [currentCalendarMonth(), latestInputMonth].filter(Boolean).sort().at(-1);
  } else if (latestRunMonth) {
    state.month = latestRunMonth;
  }
}

async function logout() {
  if (state.store) await state.store.signOut();
  state.user = null;
  state.assistantMessages = [];
  closeAssistant();
  elements.assistantEntry.hidden = true;
  elements.workspace.hidden = true;
  elements.login.hidden = false;
  setLoginStatus("");
}

function render() {
  renderNav();
  const renderers = {
    dashboard: renderDashboard,
    payrollInputs: renderPayrollInputs,
    teachers: renderTeachers,
    ledger: renderLedger,
    settings: renderSettings,
    help: renderHelp,
    workHours: renderWorkHours,
    payslips: renderPayslips,
    profile: renderProfile,
    adminPayslip: renderPayslips
  };
  (renderers[state.view] || renderDashboard)();
  refreshIcons();
}

function renderNav() {
  const items = state.user.role === "teacher" ? teacherNav : adminNav;
  let section = null;
  elements.nav.innerHTML = items.map(([group, view, icon, label]) => {
    const sectionMarkup = group !== section ? `<div class="nav-section-label">${e(group)}</div>` : "";
    section = group;
    return `${sectionMarkup}<button class="nav-button ${state.view === view || (view === "payslips" && state.view === "adminPayslip") ? "active" : ""}" type="button" data-view="${view}"><i data-lucide="${icon}" aria-hidden="true"></i>${e(label)}</button>`;
  }).join("");
  elements.helpNavButton.classList.toggle("active", state.view === "help");
}

function setPage(title, eyebrow, actions = "") {
  elements.pageTitle.textContent = title;
  elements.pageEyebrow.textContent = eyebrow;
  const unreadCount = unreadAdminNotificationItems().length;
  const notificationAction = state.user?.role === "admin"
    ? `<button class="icon-button notification-button" type="button" title="수업시간 제출 알림" aria-label="수업시간 제출 알림${unreadCount ? ` ${unreadCount}건` : ""}" data-action="open-notifications"><i data-lucide="bell"></i>${unreadCount ? `<span class="notification-badge">${unreadCount > 99 ? "99+" : unreadCount}</span>` : ""}</button>`
    : "";
  elements.topbarActions.innerHTML = `${actions}${notificationAction}`;
  elements.topbarActions.querySelector("[data-action='open-notifications']")?.addEventListener("click", openAdminNotifications);
}

function unreadAdminNotificationItems() {
  if (state.user?.role !== "admin") return [];
  return unreadWorkHoursNotifications(state.data.adminNotifications);
}

function openAdminNotifications() {
  const notifications = [...state.data.adminNotifications]
    .filter((notification) => notification.type === WORK_HOURS_NOTIFICATION_TYPE)
    .sort((a, b) => deliveryTime(b.submittedAt) - deliveryTime(a.submittedAt));
  openModal("수업시간 제출 알림", notifications.length ? `
    <div class="notification-list">
      ${notifications.map((notification) => {
        const teacher = teacherById(notification.teacherId);
        const unread = notification.status === "unread";
        return `<button class="notification-item ${unread ? "unread" : ""}" type="button" data-open-notification="${e(notification.id)}">
          <span class="notification-item-icon" aria-hidden="true"><i data-lucide="${unread ? "bell-ring" : "check"}"></i></span>
          <span class="notification-item-copy"><strong>${e(teacher?.name || "선생님")} 선생님이 ${formatMonth(notification.month)} 수업시간을 제출했습니다.</strong><small>${e(formatDateTime(notification.submittedAt))} · ${unread ? "확인 필요" : "확인함"}</small></span>
          <i data-lucide="chevron-right" aria-hidden="true"></i>
        </button>`;
      }).join("")}
    </div>
  ` : `<div class="empty-state">새로운 수업시간 제출 알림이 없습니다.</div>`);
  elements.modalRoot.querySelectorAll("[data-open-notification]").forEach((button) => button.addEventListener("click", async () => {
    const notification = state.data.adminNotifications.find((item) => item.id === button.dataset.openNotification);
    if (notification) await openAdminNotification(notification);
  }));
}

async function openAdminNotification(notification) {
  const teacher = teacherById(notification.teacherId);
  if (!teacher) {
    showToast("연결된 선생님 정보를 찾을 수 없습니다.");
    return;
  }
  if (notification.status === "unread") {
    try {
      if (state.store) await state.store.markAdminNotificationRead(notification.id);
      notification.status = "read";
      notification.readAt = new Date().toISOString();
      notification.readBy = state.user.uid;
    } catch (error) {
      showToast(error.message || "알림을 읽음 처리하지 못했습니다.");
    }
  }
  state.month = notification.month;
  state.search = "";
  state.selectedTeacherId = teacher.id;
  state.view = "payrollInputs";
  closeModal();
  render();
  if (runForMonth(state.month).status === "published") {
    showToast("확정된 급여월입니다. 수정하려면 먼저 급여 확정을 취소해 주세요.");
    return;
  }
  requestAnimationFrame(() => openMonthlyPayModal(teacher));
}

function renderDashboard() {
  const payrolls = payrollsForMonth(state.month);
  const summary = summarizePayroll(payrolls.map((item) => item.payroll));
  const run = runForMonth(state.month);
  const cancellations = cancellationsForMonth(state.month);
  const unconfirmedItems = payrolls.flatMap(({ teacher, payroll }) => (payroll.unconfirmedEarningLines || []).map((line) => `${teacher.name} ${line.subjectName}`));
  setPage("급여 대시보드", formatMonth(state.month), `
    <button class="button button-secondary" type="button" data-action="copy-notice" ${run.status !== "published" ? "disabled" : ""}><i data-lucide="send"></i><span>안내문 복사</span></button>
    <button class="button button-secondary" type="button" data-action="export-ledger"><i data-lucide="download"></i><span>내역서 저장</span></button>
    ${run.status === "published"
      ? `<button class="button button-danger" type="button" data-action="cancel-run"><i data-lucide="rotate-ccw"></i><span>확정 취소</span></button>`
      : `<button class="button button-primary" type="button" data-action="publish-run"><i data-lucide="check-check"></i><span>${run.status === "cancelled" ? "수정본 재발행" : "급여 확정"}</span></button>`}
  `);
  elements.content.innerHTML = `
    ${run.status === "cancelled"
      ? `<div class="notice warning"><i data-lucide="history"></i><span>${formatMonth(state.month)} ${e(run.revision || 1)}차 확정본이 취소됐습니다. 월 지급액과 공제액을 수정한 뒤 새 차수로 재발행하세요. 기존 확정본과 취소 사유는 보존됩니다.</span></div>`
      : run.status !== "published" ? `<div class="notice warning"><i data-lucide="triangle-alert"></i><span>현재 계산 결과는 초안입니다. 선생님별 월 지급액과 공제액을 검토한 뒤 확정해 주세요. 사회보험·세액은 기장 회계사의 최종 확인이 필요합니다.</span></div>` : ""}
    ${unconfirmedItems.length ? `<div class="notice warning"><i data-lucide="badge-help"></i><span>과세 처리가 확인되지 않은 지급 항목이 있습니다: ${e(unconfirmedItems.join(", "))}. 월 급여 입력에서 처리 방식을 선택해야 확정할 수 있습니다.</span></div>` : ""}
    <div class="toolbar">
      <input class="month-control" type="month" value="${e(state.month)}" aria-label="급여 월" data-control="month" />
      <span class="status-chip ${e(run.status)}">${statusLabel(run.status)}</span>
      <span class="toolbar-spacer"></span>
      <div class="search-wrap"><i data-lucide="search"></i><input class="search-control" type="search" value="${e(state.search)}" placeholder="선생님 검색" aria-label="선생님 검색" data-control="search" /></div>
    </div>
    <section class="metrics" aria-label="급여 요약">
      ${metric("users-round", "대상 선생님", `${payrolls.length}명`, `활성 선생님 ${activeTeachers().length}명`)}
      ${metric("circle-dollar-sign", "총 지급액", formatWon(summary.gross), "공제 전 금액")}
      ${metric("receipt-text", "총 공제액", formatWon(summary.deductions), `보험 적용 기준 ${formatWon(summary.insuredBase)}`)}
      ${metric("wallet-cards", "실 지급액", formatWon(summary.net), "선생님 지급 예정 합계")}
    </section>
    <section class="content-section">
      <div class="section-heading"><div><h2>선생님별 급여</h2><p>선생님별 소득 구성과 보험별 신고 기준액으로 계산한 이번 달 초안</p></div></div>
      <div class="data-surface table-scroll">${payrollTable(payrolls)}</div>
    </section>
    <section class="content-section">
      <div class="section-heading"><div><h2>처리 진행 상황</h2><p>입력부터 명세서 공개까지의 월별 상태</p></div></div>
      <div class="progress-strip">
        ${progressStep("1", "월 급여 입력", `${payrolls.length}명`, true, payrolls.length > 0)}
        ${progressStep("2", "계산 검토", `${payrolls.length}명`, true, run.status !== "draft")}
        ${progressStep("3", "급여 확정", statusLabel(run.status), run.status !== "draft", run.status === "published")}
        ${progressStep("4", "명세서 공개", run.status === "published" ? "선생님 열람 가능" : run.status === "cancelled" ? "재발행 후 공개" : "확정 후 공개", run.status === "published", false)}
      </div>
    </section>
    ${cancellations.length ? `<section class="content-section"><div class="section-heading"><div><h2>취소·재발행 이력</h2><p>기존 확정본을 삭제하지 않고 변경 사유를 보존합니다.</p></div></div><div class="data-surface table-scroll"><table><thead><tr><th>취소 차수</th><th>사유</th><th>처리 시각</th><th>처리자</th></tr></thead><tbody>${cancellations.map((item) => `<tr><td>${e(item.revision)}차</td><td>${e(item.reason)}</td><td>${e(formatDateTime(item.createdAt))}</td><td>${e(item.actorUid || "관리자")}</td></tr>`).join("")}</tbody></table></div></section>` : ""}
  `;
  bindCommonControls();
  elements.topbarActions.querySelector("[data-action='export-ledger']").addEventListener("click", exportLedger);
  elements.topbarActions.querySelector("[data-action='publish-run']")?.addEventListener("click", openPublishModal);
  elements.topbarActions.querySelector("[data-action='cancel-run']")?.addEventListener("click", openCancelPayrollModal);
  if (run.status === "published") elements.topbarActions.querySelector("[data-action='copy-notice']").addEventListener("click", copyPayslipNotice);
  bindPayrollRows();
}

function renderPayrollInputs() {
  const run = runForMonth(state.month);
  const locked = run.status === "published";
  const teachers = activeTeachers().filter((teacher) => !state.search || teacher.name.includes(state.search));
  const missingInsuredSalary = teachers.filter((teacher) => {
    const settings = teacherPaySettings(teacher);
    return settings.insuranceEnrolled && monthlyPayAmounts(teacher, state.month).employeeGrossPay <= 0;
  });
  setPage("월 급여 입력", formatMonth(state.month));
  elements.content.innerHTML = `
    <div class="toolbar">
      <input class="month-control" type="month" value="${e(state.month)}" aria-label="급여 월" data-control="month" />
      <span class="status-chip ${e(run.status)}">${statusLabel(run.status)}</span>
      <span class="toolbar-spacer"></span>
      <div class="search-wrap"><i data-lucide="search"></i><input class="search-control" type="search" value="${e(state.search)}" placeholder="선생님 검색" aria-label="선생님 검색" data-control="search" /></div>
    </div>
    <div class="notice ${missingInsuredSalary.length ? "warning" : ""}"><i data-lucide="${missingInsuredSalary.length ? "triangle-alert" : "circle-check"}"></i><span>${missingInsuredSalary.length ? `근로소득 월급이 입력되지 않은 보험 가입 선생님이 ${missingInsuredSalary.length}명 있습니다.` : "근로소득은 월급으로, 사업소득은 과목별 시급 × 수업 시수로 계산한 뒤 3.3%를 원천징수합니다. 한 선생님에게 두 소득을 함께 적용할 수 있습니다."}</span></div>
    <section class="content-section">
      <div class="section-heading"><div><h2>${formatMonth(state.month)} 지급액</h2><p>근로소득·강사료·교통비·주차료·기타 지급과 보험 신고 기준액을 선생님별로 입력합니다.</p></div></div>
      <div class="data-surface table-scroll"><table><thead><tr><th>선생님</th><th>가입 보험</th><th class="numeric">이번 달 근로소득</th><th class="numeric">근로 수업시간</th><th class="numeric">수업 시수</th><th class="numeric">강사료</th><th class="numeric">강사료 3.3%</th><th class="numeric">교통·주차·기타</th><th class="numeric">신고액</th><th>입력 상태</th><th aria-label="작업"></th></tr></thead><tbody>
        ${teachers.map((teacher) => {
          const override = state.data.overrides[`${state.month}:${teacher.id}`];
          const settings = teacherPaySettings(teacher);
          const amounts = monthlyPayAmounts(teacher, state.month);
          const total = amounts.totalGrossPay;
          const custom = override?.employeeGrossPay != null || Array.isArray(override?.businessWorkLines) || override?.businessGrossPay != null || override?.grossPay != null || amounts.additionalGrossPay > 0;
          const missingSalary = settings.insuranceEnrolled && amounts.employeeGrossPay <= 0;
          const insuranceCount = Object.values(settings.insuranceSettings).filter((item) => item.enrolled).length;
          const statusText = missingSalary ? "근로소득 필요" : amounts.unconfirmedCount ? `처리 확인 ${amounts.unconfirmedCount}건` : total > 0 ? "입력 완료" : "금액 미입력";
          const statusClass = total > 0 && !missingSalary && !amounts.unconfirmedCount ? "paid" : "pending";
          return `<tr><td>${personCell(teacher)}</td><td><span class="status-chip ${insuranceCount ? "published" : "pending"}">${insuranceCount ? `${insuranceCount}종 가입` : "미가입"}</span></td><td class="numeric"><strong>${formatWon(amounts.employeeGrossPay)}</strong></td><td class="numeric">${formatHours(amounts.employeeWorkHours)}</td><td class="numeric">${formatHours(amounts.businessHours)}</td><td class="numeric"><strong>${formatWon(amounts.businessGrossPay)}</strong></td><td class="numeric">${formatWon(estimatedBusinessWithholding(amounts.businessGrossPay))}</td><td class="numeric">${formatWon(amounts.additionalGrossPay)}</td><td class="numeric"><strong>${formatWon(total)}</strong><div class="cell-subtext">${custom ? "이번 달 입력" : "기본값"}</div></td><td><span class="status-chip ${statusClass}">${e(statusText)}</span></td><td><button class="icon-button" type="button" title="이번 달 지급액 수정" aria-label="${e(teacher.name)} 이번 달 지급액 수정" data-edit-monthly-pay="${e(teacher.id)}" ${locked ? "disabled" : ""}><i data-lucide="pencil"></i></button></td></tr>`;
        }).join("") || emptyRow(11)}
      </tbody></table></div>
    </section>
  `;
  bindCommonControls();
  elements.content.querySelectorAll("[data-edit-monthly-pay]").forEach((button) => button.addEventListener("click", () => {
    const teacher = teacherById(button.dataset.editMonthlyPay);
    if (teacher) openMonthlyPayModal(teacher);
  }));
}

function renderEntries() {
  const locked = runForMonth(state.month).status === "published";
  setPage("수업 내역", formatMonth(state.month), `
    <button class="button button-secondary" type="button" data-action="csv-help" ${locked ? "disabled" : ""}><i data-lucide="file-up"></i><span>CSV 업로드</span></button>
    <button class="button button-primary" type="button" data-action="add-entry" ${locked ? "disabled" : ""}><i data-lucide="plus"></i><span>수업 추가</span></button>
  `);
  const entries = entriesForMonth(state.month).filter((entry) => teacherById(entry.teacherId)?.name.includes(state.search));
  elements.content.innerHTML = `
    <div class="toolbar">
      <input class="month-control" type="month" value="${e(state.month)}" aria-label="수업 월" data-control="month" />
      <span class="toolbar-spacer"></span>
      <div class="search-wrap"><i data-lucide="search"></i><input class="search-control" type="search" value="${e(state.search)}" placeholder="선생님 검색" aria-label="선생님 검색" data-control="search" /></div>
    </div>
    <div class="notice"><i data-lucide="info"></i><span>각 수업 내역에 시급, 소득 구분, 보험 적용 여부가 스냅샷으로 저장됩니다. 계약 조건이 나중에 바뀌어도 확정된 과거 급여는 유지됩니다.</span></div>
    <section class="content-section">
      <div class="section-heading"><div><h2>${formatMonth(state.month)} 수업</h2><p>${entries.length}건 · 총 ${formatHours(entries.reduce((sum, item) => sum + Number(item.hours), 0))}</p></div></div>
      <div class="data-surface table-scroll">
        <table><thead><tr><th>수업일</th><th>선생님</th><th>과목</th><th class="numeric">시간</th><th class="numeric">시급</th><th>소득 구분</th><th>보험</th><th class="numeric">금액</th></tr></thead>
        <tbody>${entries.map((entry) => `<tr><td>${e(entry.workedOn)}</td><td>${e(teacherById(entry.teacherId)?.name)}</td><td>${e(entry.subjectName)}</td><td class="numeric">${e(entry.hours)}</td><td class="numeric">${formatWon(entry.hourlyRate)}</td><td>${e(TREATMENT_LABELS[entry.treatment])}</td><td>${entry.insuranceCovered ? "적용" : "미적용"}</td><td class="numeric">${formatWon(entry.hours * entry.hourlyRate)}</td></tr>`).join("") || emptyRow(8)}</tbody></table>
      </div>
    </section>
  `;
  bindCommonControls();
  if (!locked) {
    elements.topbarActions.querySelector("[data-action='add-entry']").addEventListener("click", openEntryModal);
    elements.topbarActions.querySelector("[data-action='csv-help']").addEventListener("click", openCsvHelpModal);
  }
}

function renderTeachers() {
  setPage("선생님 관리", "인사 · 접근 권한", `<button class="button button-secondary" type="button" data-action="copy-portal"><i data-lucide="link"></i><span>포털 링크 복사</span></button><button class="button button-primary" type="button" data-action="add-teacher"><i data-lucide="user-plus"></i><span>선생님 등록</span></button>`);
  const selected = teacherById(state.selectedTeacherId) || state.data.teachers[0];
  if (selected) state.selectedTeacherId = selected.id;
  const filtered = state.data.teachers.filter((teacher) => teacher.name.includes(state.search));
  const pendingRequests = state.data.accessRequests.filter((request) => request.status === "pending");
  elements.content.innerHTML = `
    <div class="toolbar"><div class="search-wrap"><i data-lucide="search"></i><input class="search-control" type="search" value="${e(state.search)}" placeholder="이름 검색" aria-label="이름 검색" data-control="search" /></div></div>
    <section class="content-section account-requests">
      <div class="section-heading"><div><h2>Google 계정 승인 요청</h2><p>선생님이 포털에서 처음 로그인하면 여기에 표시됩니다.</p></div><span class="status-chip ${pendingRequests.length ? "draft" : "published"}">${pendingRequests.length ? `${pendingRequests.length}건 대기` : "대기 없음"}</span></div>
      <div class="data-surface table-scroll"><table><thead><tr><th>요청자</th><th>Google 이메일</th><th>요청 시각</th><th>연결 가능</th><th aria-label="작업"></th></tr></thead><tbody>
        ${pendingRequests.map((request) => {
          const matches = matchingTeachersForAccessRequest(request, state.data.teachers);
          return `<tr><td><strong>${e(request.displayName || "이름 미확인")}</strong></td><td>${e(request.email)}</td><td>${e(formatDateTime(request.requestedAt))}</td><td>${matches.length === 1 ? `<span class="status-chip ready">${e(matches[0].name)}</span>` : `<span class="status-chip pending">이메일 확인 필요</span>`}</td><td><div class="row-actions"><button class="button button-secondary button-compact" type="button" data-approve-access="${e(request.uid || request.id)}"><i data-lucide="user-check"></i><span>계정 연결</span></button></div></td></tr>`;
        }).join("") || emptyRow(5)}
      </tbody></table></div>
    </section>
    <div class="split-layout">
      <section class="data-surface table-scroll">
        <table><thead><tr><th>선생님</th><th>가입 보험</th><th>급여 구성</th><th class="numeric">기본 근로소득</th><th>사업 시급</th><th>상태</th></tr></thead><tbody>
          ${filtered.map((teacher) => { const settings = teacherPaySettings(teacher); const hasBusiness = settings.businessRates.length > 0 || settings.defaultBusinessPay > 0; const insuranceCount = Object.values(settings.insuranceSettings).filter((item) => item.enrolled).length; return `<tr data-select-teacher="${e(teacher.id)}" tabindex="0"><td>${personCell(teacher)}</td><td>${insuranceCount ? `${insuranceCount}종 가입` : "미가입"}</td><td>${e(payCompositionLabel(settings.defaultEmployeePay, hasBusiness ? 1 : 0))}</td><td class="numeric">${formatWon(settings.defaultEmployeePay)}</td><td>${settings.businessRates.length ? `${settings.businessRates.length}개 과목` : settings.defaultBusinessPay > 0 ? "기존 월액" : "미등록"}</td><td><span class="status-chip ${teacher.status === "active" ? "paid" : "cancelled"}">${teacher.status === "active" ? "활성" : "비활성"}</span></td></tr>`; }).join("") || emptyRow(6)}
        </tbody></table>
      </section>
      ${selected ? `<aside class="detail-panel">
        <div class="detail-panel-header detail-title-row"><div><h2>${e(selected.name)}</h2><p>${e(selected.email)}</p></div><button class="icon-button" type="button" title="선생님 정보 수정" aria-label="${e(selected.name)} 정보 수정" data-edit-teacher><i data-lucide="pencil"></i></button></div>
        <div class="detail-block"><h3>연락·식별 정보</h3><dl class="definition-list"><div><dt>연락처</dt><dd>${e(selected.phone || "미등록")}</dd></div><div><dt>생년월일·성별번호</dt><dd>${e(formatTeacherIdentity(selected) || "미등록")}</dd></div><div><dt>전체 주민등록번호</dt><dd>저장하지 않음</dd></div></dl></div>
        <div class="detail-block"><h3>접근 연결</h3><dl class="definition-list"><div><dt>로그인 UID</dt><dd>${e(selected.authUid || "승인 대기")}</dd></div><div><dt>상태</dt><dd>${selected.status === "active" ? "활성" : "비활성"}</dd></div></dl></div>
        ${teacherPayDetails(selected)}
        ${teacherPaySettings(selected).insuranceEnrolled || teacherPaySettings(selected).defaultEmployeePay > 0 ? `<div class="detail-block"><div class="detail-title-row"><h3>근로소득 원천징수 정보</h3><button class="icon-button" type="button" title="원천징수 정보 수정" aria-label="${e(selected.name)} 원천징수 정보 수정" data-edit-tax-profile><i data-lucide="pencil"></i></button></div><dl class="definition-list"><div><dt>공제대상가족</dt><dd>${e(taxProfileForTeacher(selected).dependentCount)}명</dd></div><div><dt>8~20세 자녀</dt><dd>${e(taxProfileForTeacher(selected).children8To20)}명</dd></div><div><dt>원천징수 비율</dt><dd>${ratePercent(taxProfileForTeacher(selected).withholdingRatio)}</dd></div></dl></div>` : `<div class="detail-block"><h3>원천징수</h3><p class="form-help">사업소득 지급액에는 사업소득 원천징수 기준이 적용됩니다.</p></div>`}
        <div class="detail-block"><h3>담당 과목</h3><div class="tag-list">${selected.subjects.map((subject) => `<span class="tag">${e(subject)}</span>`).join("")}</div></div>
      </aside>` : ""}
    </div>
  `;
  bindCommonControls();
  elements.topbarActions.querySelector("[data-action='add-teacher']").addEventListener("click", openTeacherModal);
  elements.topbarActions.querySelector("[data-action='copy-portal']").addEventListener("click", copyPortalLink);
  elements.content.querySelector("[data-edit-teacher]")?.addEventListener("click", () => openTeacherEditModal(selected));
  elements.content.querySelector("[data-edit-tax-profile]")?.addEventListener("click", () => openTaxProfileModal(selected));
  elements.content.querySelectorAll("[data-approve-access]").forEach((button) => button.addEventListener("click", () => {
    const request = state.data.accessRequests.find((item) => (item.uid || item.id) === button.dataset.approveAccess);
    if (request) openAccessApprovalModal(request);
  }));
  elements.content.querySelectorAll("[data-select-teacher]").forEach((row) => row.addEventListener("click", () => {
    state.selectedTeacherId = row.dataset.selectTeacher;
    renderTeachers();
  }));
}

function renderRates() {
  setPage("시급 · 계약 조건", "적용 기간별 규칙", `<button class="button button-primary" type="button" data-action="add-rate"><i data-lucide="plus"></i><span>조건 추가</span></button>`);
  elements.content.innerHTML = `
    <div class="notice"><i data-lucide="layers-3"></i><span>한 선생님에게 과목별 시급과 서로 다른 소득 구분을 동시에 지정할 수 있습니다. 고용관계가 있으면 근로소득, 독립적으로 계속·반복하는 강의는 사업소득, 일시적 강의는 기타소득으로 검토하며 앱이 계약 실질을 자동 판정하지는 않습니다.</span></div>
    <section class="content-section">
      <div class="section-heading"><div><h2>현재 적용 조건</h2><p>선생님 + 과목 + 적용 기간 기준</p></div></div>
      <div class="data-surface table-scroll"><table><thead><tr><th>선생님</th><th>과목</th><th class="numeric">시급</th><th>소득 구분</th><th>4대보험</th><th>적용 시작</th></tr></thead><tbody>
        ${state.data.rateRules.map((rule) => `<tr><td>${e(teacherById(rule.teacherId)?.name)}</td><td>${e(rule.subjectName)}</td><td class="numeric">${formatWon(rule.hourlyRate)}</td><td>${e(TREATMENT_LABELS[rule.treatment])}</td><td>${rule.insuranceCovered ? "적용" : "미적용"}</td><td>${e(rule.effectiveFrom)}</td></tr>`).join("") || emptyRow(6)}
      </tbody></table></div>
    </section>
  `;
  elements.topbarActions.querySelector("[data-action='add-rate']").addEventListener("click", openRateModal);
}

function renderLedger() {
  const payrolls = payrollsForMonth(state.month);
  const summary = summarizePayroll(payrolls.map((item) => item.payroll));
  setPage("월별 급여내역서", formatMonth(state.month), `
    <button class="button button-secondary" type="button" data-action="print"><i data-lucide="printer"></i><span>인쇄</span></button>
    <button class="button button-primary" type="button" data-action="export-ledger"><i data-lucide="download"></i><span>CSV 저장</span></button>
  `);
  elements.content.innerHTML = `
    <div class="toolbar"><input class="month-control" type="month" value="${e(state.month)}" aria-label="급여 월" data-control="month" /></div>
    <section class="content-section"><div class="section-heading"><div><h2>${e(appConfig.academyName)} 급여내역서</h2><p>기장 전달용 · ${formatMonth(state.month)}</p></div></div>
    <div class="data-surface table-scroll">${ledgerTable(payrolls, summary)}</div></section>
  `;
  bindCommonControls();
  elements.topbarActions.querySelector("[data-action='print']").addEventListener("click", () => window.print());
  elements.topbarActions.querySelector("[data-action='export-ledger']").addEventListener("click", exportLedger);
}

function renderSettings() {
  const taxPolicy = taxPolicyForMonth(state.month);
  const insurancePolicy = insurancePolicyForMonth(state.month);
  const lectureRule = taxPolicy.other?.categories?.temporaryLecture || {};
  setPage("계산 · 보안 설정", "관리자 전용", `
    <button class="button button-secondary" type="button" data-action="export-tax-table"><i data-lucide="file-down"></i><span>간이세액표 CSV</span></button>
    <button class="button button-primary" type="button" data-action="add-tax-policy"><i data-lucide="plus"></i><span>새 세금 기준</span></button>
  `);
  elements.content.innerHTML = `
    <div class="notice"><i data-lucide="landmark"></i><span>원천징수는 국세청 안내와 소득세법 시행령 별표 2를 기준으로 계산합니다. 법령이 바뀌면 기존 기준을 수정하지 않고 새 시행일의 버전을 추가하세요. 확정 명세서에는 적용 버전이 그대로 보존됩니다.</span></div>
    <div class="split-layout">
      <section class="detail-panel">
        <div class="detail-panel-header"><h2>${e(taxPolicy.name || "세금 기준")}</h2><p>${e(taxPolicy.version)} · ${e(taxPolicy.effectiveFrom)}부터 적용</p></div>
        <div class="detail-block"><h3>근로소득</h3><dl class="definition-list"><div><dt>간이세액표</dt><dd>${e(taxPolicy.employment?.tableRevision)} 개정</dd></div><div><dt>급여 구간</dt><dd>${formatNumber(taxPolicy.employment?.tableRows?.length)}개</dd></div><div><dt>원천징수 선택</dt><dd>80% · 100% · 120%</dd></div><div><dt>8~20세 자녀 공제</dt><dd>인원별 적용</dd></div></dl></div>
        <div class="detail-block"><h3>사업소득</h3><dl class="definition-list"><div><dt>소득세</dt><dd>${ratePercent(taxPolicy.business?.incomeTaxRate)}</dd></div><div><dt>지방소득세</dt><dd>소득세의 ${ratePercent(taxPolicy.business?.localIncomeTaxRateOfIncomeTax)}</dd></div><div><dt>합계 효과세율</dt><dd>${ratePercent(Number(taxPolicy.business?.incomeTaxRate || 0) * (1 + Number(taxPolicy.business?.localIncomeTaxRateOfIncomeTax || 0)))}</dd></div></dl></div>
        <div class="detail-block"><h3>일시적 강의 기타소득</h3><dl class="definition-list"><div><dt>필요경비율</dt><dd>${ratePercent(lectureRule.expenseRate)}</dd></div><div><dt>소득세율</dt><dd>${ratePercent(lectureRule.incomeTaxRate)}</dd></div><div><dt>과세최저한</dt><dd>건별 소득금액 ${formatWon(lectureRule.minimumTaxableIncomeAmount)} 이하</dd></div><div><dt>최저한 초과 효과세율</dt><dd>${ratePercent((1 - Number(lectureRule.expenseRate || 0)) * Number(lectureRule.incomeTaxRate || 0) * (1 + Number(lectureRule.localIncomeTaxRateOfIncomeTax || 0)))}</dd></div></dl></div>
        <div class="detail-block"><h3>공식 근거</h3><div class="source-list">${(taxPolicy.sources || []).map((source) => `<a href="${e(safeHttpUrl(source.url))}" target="_blank" rel="noopener noreferrer"><i data-lucide="external-link"></i>${e(source.title)}</a>`).join("")}</div></div>
      </section>
      <section class="detail-panel">
        <div class="detail-panel-header"><h2>사회보험 정책</h2><p>${e(insurancePolicy.version)} · 국세청 기준과 별도 관리</p></div>
        <div class="detail-block"><h3>근로소득 보험</h3><dl class="definition-list"><div><dt>국민연금</dt><dd>${ratePercent(insurancePolicy.employee?.nationalPension?.rate)}</dd></div><div><dt>건강보험</dt><dd>${ratePercent(insurancePolicy.employee?.healthInsurance?.rate)}</dd></div><div><dt>장기요양</dt><dd>건강보험료의 ${ratePercent(insurancePolicy.employee?.longTermCareRate)}</dd></div><div><dt>고용보험</dt><dd>${ratePercent(insurancePolicy.employee?.employmentInsurance?.rate)}</dd></div></dl></div>
        <div class="detail-block"><h3>공식 근거</h3><div class="source-list">${(insurancePolicy.sources || []).map((source) => `<a href="${e(safeHttpUrl(source.url))}" target="_blank" rel="noopener noreferrer"><i data-lucide="external-link"></i>${e(source.title)}</a>`).join("")}</div></div>
        <div class="detail-block"><div class="notice warning compact"><i data-lucide="triangle-alert"></i><span>자동 계산은 선생님별 국민연금·건강보험·고용보험 신고 기준액을 사용한 예상값입니다. 공단 고지액, 입·퇴사월, 두루누리 지원, 휴직·정산 등은 급여 확정 전에 수동 공제액으로 맞추세요.</span></div></div>
        <div class="detail-block"><button class="button button-secondary" type="button" data-action="add-insurance-policy"><i data-lucide="plus"></i><span>새 사회보험 기준</span></button></div>
        <div class="detail-block"><h3>보안 점검</h3><dl class="definition-list"><div><dt>저장소 개인정보</dt><dd>포함 금지</dd></div><div><dt>Firestore 기본 권한</dt><dd>전면 거부</dd></div><div><dt>선생님 명세서</dt><dd>본인 UID만</dd></div><div><dt>확정본 수정</dt><dd>금지</dd></div></dl></div>
        <div class="detail-block"><h3>현재 실행 모드</h3><span class="status-chip ${appConfig.demoMode ? "draft" : "published"}">${appConfig.demoMode ? "데모 데이터" : "Firebase 연결"}</span></div>
      </section>
    </div>
    <section class="content-section policy-history">
      <div class="section-heading"><div><h2>세금 기준 적용 이력</h2><p>시행일이 가장 최근인 유효 버전이 자동 적용됩니다.</p></div></div>
      <div class="data-surface table-scroll"><table><thead><tr><th>버전</th><th>기준명</th><th>시행일</th><th>확인일</th><th>상태</th></tr></thead><tbody>${[...state.data.taxPolicies].sort((a, b) => String(b.effectiveFrom).localeCompare(String(a.effectiveFrom))).map((policy) => `<tr><td><strong>${e(policy.version)}</strong></td><td>${e(policy.name)}</td><td>${e(policy.effectiveFrom)}</td><td>${e(policy.verifiedAt || "-")}</td><td><span class="status-chip published">${policy.builtIn ? "내장 공식본" : "등록 완료"}</span></td></tr>`).join("")}</tbody></table></div>
    </section>
    <section class="content-section policy-history">
      <div class="section-heading"><div><h2>사회보험 기준 적용 이력</h2><p>국민연금 상·하한처럼 연중 변경되는 기준도 시행일별로 보존합니다.</p></div></div>
      <div class="data-surface table-scroll"><table><thead><tr><th>버전</th><th>기준명</th><th>시행일</th><th>종료일</th><th>상태</th></tr></thead><tbody>${[...state.data.insurancePolicies].sort((a, b) => String(b.effectiveFrom).localeCompare(String(a.effectiveFrom))).map((policy) => `<tr><td><strong>${e(policy.version)}</strong></td><td>${e(policy.name)}</td><td>${e(policy.effectiveFrom)}</td><td>${e(policy.effectiveTo || "계속")}</td><td><span class="status-chip published">${policy.builtIn ? "내장 공식본" : "등록 완료"}</span></td></tr>`).join("")}</tbody></table></div>
    </section>
  `;
  elements.topbarActions.querySelector("[data-action='export-tax-table']").addEventListener("click", downloadTaxTableTemplate);
  elements.topbarActions.querySelector("[data-action='add-tax-policy']").addEventListener("click", openTaxPolicyModal);
  elements.content.querySelector("[data-action='add-insurance-policy']").addEventListener("click", openInsurancePolicyModal);
}

function renderHelp() {
  const query = state.helpSearch.trim();
  const visibleArticles = query
    ? searchHelpArticles(query, helpArticles, helpArticles.length)
    : helpArticles;
  setPage("사용 설명서", "관리자 도움말", `
    <button class="button button-primary" type="button" title="AI 도움말 열기" aria-label="AI 도움말 열기" data-action="open-assistant"><i data-lucide="message-circle-question"></i><span>AI 도움말</span></button>
  `);
  elements.content.innerHTML = `
    <div class="notice"><i data-lucide="book-check"></i><span>관리자 업무 순서와 화면별 사용법입니다. 실제 개인정보를 넣기 전에 테스트 계정과 가상 급여로 전체 절차를 확인하세요.</span></div>
    <div class="help-toolbar">
      <div class="search-wrap"><i data-lucide="search"></i><input class="search-control" type="search" value="${e(state.helpSearch)}" placeholder="설명서 검색" aria-label="사용 설명서 검색" data-help-search /></div>
      <span>${visibleArticles.length}개 항목</span>
    </div>
    <div class="help-layout">
      <aside class="help-toc" aria-label="사용 설명서 목차">
        <strong>목차</strong>
        ${helpArticles.map((article, index) => `<button type="button" data-help-jump="${e(article.id)}"><span>${index + 1}</span>${e(article.title)}</button>`).join("")}
      </aside>
      <section class="help-content" aria-label="사용 설명서 내용">
        ${visibleArticles.map((article, index) => `
          <article id="help-${e(article.id)}" class="help-article">
            <header><span>${String(index + 1).padStart(2, "0")}</span><div><h2>${e(article.title)}</h2><p>${e(article.summary)}</p></div></header>
            <ol>${article.steps.map((step) => `<li>${e(step)}</li>`).join("")}</ol>
            ${article.cautions.map((caution) => `<div class="help-caution"><i data-lucide="triangle-alert"></i><span>${e(caution)}</span></div>`).join("")}
            <button class="button button-secondary button-compact" type="button" data-help-ask="${e(article.title)}"><i data-lucide="message-circle-question"></i><span>이 항목 질문하기</span></button>
          </article>
        `).join("") || `<div class="empty-state"><strong>일치하는 설명서가 없습니다.</strong><span>기능 이름으로 다시 검색하거나 AI 도움말에 질문해 주세요.</span></div>`}
      </section>
    </div>
  `;
  elements.topbarActions.querySelector("[data-action='open-assistant']").addEventListener("click", openAssistant);
  elements.content.querySelector("[data-help-search]").addEventListener("input", (event) => {
    const caret = event.target.selectionStart;
    state.helpSearch = event.target.value;
    renderHelp();
    const nextInput = elements.content.querySelector("[data-help-search]");
    nextInput.focus();
    nextInput.setSelectionRange(caret, caret);
  });
  elements.content.querySelectorAll("[data-help-jump]").forEach((button) => button.addEventListener("click", () => {
    if (state.helpSearch) {
      state.helpSearch = "";
      renderHelp();
    }
    requestAnimationFrame(() => document.querySelector(`#help-${button.dataset.helpJump}`)?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }));
  elements.content.querySelectorAll("[data-help-ask]").forEach((button) => button.addEventListener("click", () => {
    openAssistant();
    elements.assistantInput.value = `${button.dataset.helpAsk} 사용 방법을 알려줘`;
    elements.assistantInput.focus();
  }));
}

function renderWorkHours() {
  const teacher = teacherById(state.user.teacherId);
  const run = runForMonth(state.month);
  const locked = run.status === "published";
  const settings = teacher ? teacherPaySettings(teacher) : getTeacherPaySettings({});
  const current = teacher ? monthlyWorkInput(teacher.id) : null;
  const legacyOverride = teacher ? state.data.overrides[`${state.month}:${teacher.id}`] || {} : {};
  const employeeWorkHours = current?.employeeWorkHours ?? legacyOverride.employeeWorkHours ?? 0;
  const businessHours = current?.businessHours
    || businessHoursFromWorkLines(settings.businessRates, legacyOverride.businessWorkLines);
  const canEnterEmployeeHours = settings.defaultEmployeePay > 0 || settings.insuranceEnrolled;
  const hasWorkTypes = canEnterEmployeeHours || settings.businessRates.length > 0;

  setPage("수업시간 입력", formatMonth(state.month), `
    <button class="button button-primary" type="button" title="수업시간 저장" aria-label="수업시간 저장" data-action="save-work-hours" ${!teacher || locked || !hasWorkTypes ? "disabled" : ""}><i data-lucide="save"></i><span>수업시간 저장</span></button>
  `);
  elements.content.innerHTML = teacher ? `
    <div class="toolbar">
      <input class="month-control" type="month" value="${e(state.month)}" aria-label="수업 월" data-control="month" />
      <span class="status-chip ${e(run.status)}">${locked ? "입력 마감" : current ? "제출 완료" : "입력 전"}</span>
    </div>
    <div class="notice ${locked ? "warning" : ""}"><i data-lucide="${locked ? "lock" : "shield-check"}"></i><span>${locked ? `${formatMonth(state.month)} 급여가 확정되어 수업시간을 수정할 수 없습니다.` : "수업시간만 입력할 수 있습니다. 이메일, 월급, 시급, 보험과 세금 정보는 관리자가 등록하고 검토합니다."}</span></div>
    <section class="content-section">
      <div class="section-heading"><div><h2>${formatMonth(state.month)} 수업시간</h2><p>관리자가 등록한 급여 유형과 과목에 해당 월의 총 수업시간을 입력합니다.</p></div>${current?.submittedAt ? `<span class="cell-subtext">최근 저장 ${e(formatDateTime(current.submittedAt))}</span>` : ""}</div>
      ${hasWorkTypes ? `<form id="teacher-work-hours-form" class="data-surface teacher-work-hours-form">
        ${canEnterEmployeeHours ? `<div class="teacher-work-hour-row"><div><strong>근로소득 수업</strong><span>월급과 별도로 수업시간만 기록됩니다.</span></div><div class="input-suffix"><input name="employeeWorkHours" type="number" min="0" max="744" step="0.5" value="${e(employeeWorkHours)}" ${locked ? "disabled" : ""} aria-label="근로소득 수업시간" /><span>시간</span></div></div>` : ""}
        ${settings.businessRates.map((rate) => `<div class="teacher-work-hour-row"><div><strong>${e(rate.subjectName)}</strong><span>사업소득 수업</span></div><div class="input-suffix"><input type="number" min="0" max="744" step="0.5" value="${e(businessHours[rate.id] || 0)}" data-business-hour="${e(rate.id)}" ${locked ? "disabled" : ""} aria-label="${e(rate.subjectName)} 수업시간" /><span>시간</span></div></div>`).join("")}
      </form>` : `<div class="empty-state">관리자가 먼저 근로소득 월급 또는 사업소득 과목을 등록해야 합니다.</div>`}
    </section>
  ` : `<div class="empty-state">연결된 선생님 정보가 없습니다.</div>`;
  bindCommonControls();
  elements.topbarActions.querySelector("[data-action='save-work-hours']")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    const form = document.querySelector("#teacher-work-hours-form");
    if (!form?.reportValidity()) return;
    const hourValues = [
      Number(form.elements.employeeWorkHours?.value || 0),
      ...[...form.querySelectorAll("[data-business-hour]")].map((input) => Number(input.value || 0))
    ];
    if (hourValues.some((hours) => !Number.isFinite(hours) || hours < 0 || hours > 744)) {
      showToast("수업시간은 0 이상 744 이하로 입력해 주세요.");
      return;
    }
    const rawBusinessHours = Object.fromEntries([...form.querySelectorAll("[data-business-hour]")]
      .map((input) => [input.dataset.businessHour, Number(input.value || 0)]));
    const input = {
      id: monthlyWorkInputId(state.month, teacher.id),
      teacherId: teacher.id,
      teacherUid: state.user.uid,
      month: state.month,
      employeeWorkHours: Number(form.elements.employeeWorkHours?.value || 0),
      businessHours: buildBusinessHours(settings.businessRates, rawBusinessHours),
      submittedAt: new Date().toISOString()
    };
    button.disabled = true;
    try {
      if (state.store) await state.store.saveTeacherMonthlyInput(input);
      state.data.monthlyWorkInputs[`${state.month}:${teacher.id}`] = input;
      showToast(`${formatMonth(state.month)} 수업시간을 저장했습니다.`);
      renderWorkHours();
    } catch (error) {
      showToast(error.message || "수업시간을 저장하지 못했습니다.");
    } finally {
      button.disabled = false;
    }
  });
}

function renderPayslips() {
  const teacherId = state.user.role === "teacher" ? state.user.teacherId : state.selectedTeacherId;
  const teacher = teacherById(teacherId);
  const months = availablePayslipMonths(teacherId);
  if (!months.includes(state.selectedPayslipMonth)) state.selectedPayslipMonth = months[0] || state.month;
  const payroll = payrollForTeacher(teacherId, state.selectedPayslipMonth);
  const run = { ...runForMonth(state.selectedPayslipMonth), status: payslipStatus(teacherId, state.selectedPayslipMonth) };
  const isAdmin = state.user.role === "admin";
  const delivery = deliveryFor(teacherId, state.selectedPayslipMonth);
  setPage(state.user.role === "teacher" ? "급여명세서" : `${teacher?.name || "선생님"} 급여명세서`, "발행된 월별 내역", `
    <button class="button button-secondary" type="button" title="PDF 다운로드" aria-label="급여명세서 PDF 다운로드" data-action="download-payslip" ${payroll ? "" : "disabled"}><i data-lucide="download"></i><span>PDF 다운로드</span></button>
    <button class="button button-secondary" type="button" title="인쇄" aria-label="급여명세서 인쇄" data-action="print-payslip" ${payroll ? "" : "disabled"}><i data-lucide="printer"></i><span>인쇄</span></button>
    ${isAdmin ? `<button class="button button-primary" type="button" title="이메일 발송" aria-label="급여명세서 이메일 발송" data-action="email-payslip" ${payroll && run.status === "published" ? "" : "disabled"}><i data-lucide="mail-plus"></i><span>이메일 발송</span></button>` : ""}
  `);
  const notice = state.user.role === "teacher"
    ? "본인에게 발행된 급여명세서만 표시됩니다. 파일을 내려받은 공용 기기에서는 사용 후 삭제해 주세요."
    : run.status !== "published"
      ? "관리자 미리보기입니다. 이메일 첨부 발송은 급여 확정 후 사용할 수 있습니다."
      : delivery
        ? `${delivery.recipientEmail} 주소로 ${formatDeliveryAt(delivery.sentAt)}에 첨부 발송했습니다.`
        : "확정된 명세서입니다. 수신자와 금액을 확인한 뒤 PDF 다운로드 또는 이메일 첨부 발송을 진행하세요.";
  elements.content.innerHTML = `
    <div class="notice"><i data-lucide="${delivery ? "mail-check" : "lock-keyhole"}"></i><span>${e(notice)}</span></div>
    <div class="payslip-layout">
      <aside class="payslip-list"><div class="payslip-list-header"><h2>명세서 내역</h2></div>
        ${months.map((month) => { const item = payrollForTeacher(teacherId, month); return `<button class="payslip-item ${month === state.selectedPayslipMonth ? "active" : ""}" type="button" data-payslip-month="${e(month)}"><strong>${formatMonth(month)}</strong><span>${payslipStatus(teacherId, month) === "published" ? "발행 완료" : "관리자 미리보기"}</span><span class="amount">${formatWon(item?.payroll.net)}</span></button>`; }).join("") || `<div class="empty-state">발행된 명세서가 없습니다.</div>`}
      </aside>
      ${payroll && teacher ? payslipSheet(teacher, payroll.payroll, state.selectedPayslipMonth, run) : `<div class="empty-state">확인할 명세서가 없습니다.</div>`}
    </div>
  `;
  elements.topbarActions.querySelector("[data-action='download-payslip']")?.addEventListener("click", downloadCurrentPayslip);
  elements.topbarActions.querySelector("[data-action='print-payslip']")?.addEventListener("click", () => window.print());
  elements.topbarActions.querySelector("[data-action='email-payslip']")?.addEventListener("click", () => openPayslipEmailModal(teacher, payroll?.payroll, run));
  elements.content.querySelectorAll("[data-payslip-month]").forEach((button) => button.addEventListener("click", () => {
    state.selectedPayslipMonth = button.dataset.payslipMonth;
    renderPayslips();
  }));
  if (state.user.role === "teacher" && payroll && run.status === "published") recordPayslipViewed(teacherId, state.selectedPayslipMonth);
}

function renderProfile() {
  const teacher = teacherById(state.user.teacherId);
  setPage("등록 정보", "내 계정", `<button class="button button-primary" type="button" data-action="edit-my-profile" ${teacher ? "" : "disabled"}><i data-lucide="pencil"></i><span>내 정보 수정</span></button>`);
  elements.content.innerHTML = teacher ? `
    <div class="split-layout"><section class="detail-panel"><div class="detail-panel-header"><h2>${e(teacher.name)}</h2><p>${e(teacher.email)}</p></div><div class="detail-block"><h3>개인 정보</h3><dl class="definition-list"><div><dt>연락처</dt><dd>${e(teacher.phone || "미등록")}</dd></div><div><dt>생년월일·성별번호</dt><dd>${e(formatTeacherIdentity(teacher) || "미등록")}</dd></div></dl></div><div class="detail-block"><h3>담당 과목</h3><div class="tag-list">${(teacher.subjects || []).map((item) => `<span class="tag">${e(item)}</span>`).join("") || `<span class="form-help">미등록</span>`}</div></div></section>
    <section><div class="notice"><i data-lucide="user-pen"></i><span>이름, 연락처, 생년월일·성별번호와 담당 과목은 직접 수정할 수 있습니다.</span></div><div class="notice"><i data-lucide="lock-keyhole"></i><span>Google 이메일, 계정 상태, 월급, 시급, 보험, 세금과 공제 정보는 관리자만 수정할 수 있습니다.</span></div></section></div>
  ` : `<div class="empty-state">연결된 선생님 정보가 없습니다.</div>`;
  elements.topbarActions.querySelector("[data-action='edit-my-profile']")?.addEventListener("click", () => openTeacherSelfProfileModal(teacher));
}

function initializeAssistant() {
  if (!state.assistantMessages.length) {
    state.assistantMessages.push({
      role: "assistant",
      text: "프로그램 사용법을 질문해 주세요. 실제 이름, 이메일, 전화번호, 계좌번호, 주민번호와 급여액은 입력하지 마세요.",
      source: "사용 설명서"
    });
  }
  elements.assistantStatus.textContent = appConfig.assistant?.enabled
    ? "Gemini · 사용 설명서 전용"
    : "내장 설명서 · Gemini 연결 전";
  renderAssistantMessages();
}

function openAssistant() {
  if (state.user?.role !== "admin") return;
  initializeAssistant();
  elements.assistantPanel.hidden = false;
  elements.assistantToggle.setAttribute("aria-expanded", "true");
  refreshIcons();
  requestAnimationFrame(() => elements.assistantInput.focus());
}

function closeAssistant() {
  elements.assistantPanel.hidden = true;
  elements.assistantToggle.setAttribute("aria-expanded", "false");
}

async function submitAssistantQuestion(event) {
  event.preventDefault();
  if (state.assistantBusy || state.user?.role !== "admin") return;
  const question = elements.assistantInput.value.trim();
  if (!question) return;
  elements.assistantInput.value = "";
  state.assistantMessages.push({ role: "user", text: question });
  state.assistantBusy = true;
  renderAssistantMessages(true);

  const localAnswer = buildLocalHelpAnswer(question, helpArticles, currentViewLabel());
  let answer = localAnswer;
  let source = "사용 설명서";
  const canUseGemini = appConfig.assistant?.enabled
    && appConfig.assistant?.provider === "gemini"
    && !appConfig.demoMode
    && state.store
    && detectSensitiveInput(question).length === 0;

  if (canUseGemini) {
    try {
      const prompt = buildGeminiPrompt(question, helpArticles, currentViewLabel());
      answer = await state.store.askHelpAssistant(prompt, appConfig.assistant.model);
      source = "Gemini · 사용 설명서";
      elements.assistantStatus.textContent = "Gemini · 사용 설명서 전용";
    } catch (error) {
      console.warn("Gemini 도움말을 사용할 수 없어 내장 설명서로 답합니다.", error);
      elements.assistantStatus.textContent = "내장 설명서 · Gemini 응답 불가";
    }
  }

  state.assistantMessages.push({ role: "assistant", text: answer, source });
  state.assistantBusy = false;
  renderAssistantMessages();
}

function renderAssistantMessages(showPending = false) {
  const suggestions = state.assistantMessages.length === 1 ? `
    <div class="assistant-suggestions" aria-label="추천 질문">
      ${["근로소득과 사업소득을 함께 입력하려면?", "이번 달 급여는 어디서 입력해?", "명세서를 이메일로 보내려면?"].map((question) => `<button type="button" data-assistant-question="${e(question)}">${e(question)}</button>`).join("")}
    </div>
  ` : "";
  elements.assistantMessages.innerHTML = state.assistantMessages.map((message) => `
    <div class="assistant-message ${message.role}">
      <div>${assistantMessageHtml(message.text)}</div>
      ${message.source ? `<small>${e(message.source)}</small>` : ""}
    </div>
  `).join("") + suggestions + (showPending ? `<div class="assistant-message assistant pending"><div>설명서를 확인하고 있습니다.</div></div>` : "");
  const submit = elements.assistantForm.querySelector("button[type='submit']");
  submit.disabled = state.assistantBusy;
  elements.assistantInput.disabled = state.assistantBusy;
  elements.assistantMessages.scrollTop = elements.assistantMessages.scrollHeight;
  refreshIcons();
}

function currentViewLabel() {
  if (state.view === "adminPayslip") return "개인 급여명세서";
  if (state.view === "help") return "사용 설명서";
  return adminNav.find(([, view]) => view === state.view)?.[3] || "관리자 화면";
}

function assistantMessageHtml(value) {
  return e(value).replace(/\n/g, "<br>");
}

function payrollsForMonth(month) {
  const search = state.search.trim();
  return activeTeachers()
    .filter((teacher) => !search || teacher.name.includes(search))
    .map((teacher) => payrollForTeacher(teacher.id, month))
    .filter((item) => item && item.payroll.earningLines.length);
}

function payrollForTeacher(teacherId, month) {
  if (!appConfig.demoMode && state.data.payslips.length) {
    const saved = state.data.payslips.find((item) => item.month === month && item.teacherId === teacherId);
    if (saved?.status === "published") return { teacher: teacherById(teacherId), payroll: saved.calculation || saved };
    if (state.user?.role === "teacher") return null;
  }
  const teacher = teacherById(teacherId);
  if (!teacher) return null;
  const settings = teacherPaySettings(teacher);
  const key = `${month}:${teacherId}`;
  const override = mergeMonthlyWorkInput(
    settings.businessRates,
    state.data.overrides[key],
    state.data.monthlyWorkInputs[key]
  );
  const earningLines = createMonthlyEarningLines({ ...teacher, businessRates: settings.businessRates }, month, override);
  if (!earningLines.length) return null;
  return {
    teacher,
    payroll: calculatePayroll(
      earningLines,
      policyForMonth(month),
      { ...override, insuranceSettings: settings.insuranceSettings },
      teacher.taxProfile
    )
  };
}

function entriesForMonth(month) { return state.data.entries.filter((entry) => entry.month === month); }
function teacherById(id) { return state.data.teachers.find((teacher) => teacher.id === id); }
function activeTeachers() { return state.data.teachers.filter((teacher) => teacher.status === "active"); }
function teacherPaySettings(teacher) {
  const settings = getTeacherPaySettings(teacher);
  if (!Array.isArray(teacher?.businessRates)) {
    settings.businessRates = state.data.rateRules
      .filter((rule) => rule.teacherId === teacher?.id && rule.treatment === "business")
      .map((rule) => ({ id: rule.id, subjectName: rule.subjectName, hourlyRate: Number(rule.hourlyRate) }));
  }
  return settings;
}
function monthlyPayAmounts(teacher, month) {
  const key = `${month}:${teacher.id}`;
  const settings = teacherPaySettings(teacher);
  const override = mergeMonthlyWorkInput(
    settings.businessRates,
    state.data.overrides[key],
    state.data.monthlyWorkInputs[key]
  );
  return getMonthlyPayAmounts({ ...teacher, businessRates: settings.businessRates }, override);
}

function monthlyWorkInput(teacherId, month = state.month) {
  return state.data.monthlyWorkInputs[`${month}:${teacherId}`] || null;
}
function payCompositionLabel(employeePay, businessPay) {
  if (employeePay > 0 && businessPay > 0) return "근로 + 사업";
  if (employeePay > 0) return "근로소득";
  if (businessPay > 0) return "사업소득";
  return "금액 미설정";
}
function payrollCompositionLabel(payroll) {
  const label = payCompositionLabel(payroll?.grossByTreatment?.employee || 0, payroll?.grossByTreatment?.business || 0);
  return label === "금액 미설정" && payroll?.gross > 0 ? "추가 지급" : label;
}
function teacherPayDetails(teacher) {
  const settings = teacherPaySettings(teacher);
  const rates = settings.businessRates.length
    ? settings.businessRates.map((rate) => `<div><dt>${e(rate.subjectName)}</dt><dd>${formatWon(rate.hourlyRate)}/시간</dd></div>`).join("")
    : `<div><dt>사업소득 시급</dt><dd>${settings.defaultBusinessPay > 0 ? "기존 고정 월액 사용 중" : "미등록"}</dd></div>`;
  const insuranceRows = Object.entries(INSURANCE_LABELS).map(([key, label]) => {
    const item = settings.insuranceSettings[key];
    const period = item.effectiveFrom || item.effectiveTo
      ? `${item.effectiveFrom || "시작일 미정"} ~ ${item.effectiveTo || "계속"}`
      : "기간 미설정";
    return `<div><dt>${e(label)}</dt><dd>${item.enrolled ? `가입 · ${item.defaultBaseAmount == null ? "기준액 미입력" : formatWon(item.defaultBaseAmount)}<span class="definition-subtext">${e(period)}</span>` : "미가입"}</dd></div>`;
  }).join("");
  return `<div class="detail-block"><h3>급여 조건</h3><dl class="definition-list"><div><dt>기본 근로소득</dt><dd>${formatWon(settings.defaultEmployeePay)}</dd></div>${rates}<div><dt>교통비 기본값</dt><dd>${settings.transportPolicy.unitAmount ? `${formatWon(settings.transportPolicy.unitAmount)}/회 · ${e(TREATMENT_LABELS[settings.transportPolicy.treatment])}` : "미등록"}</dd></div><div><dt>계약 요약</dt><dd>${e(teacher.contractSummary)}</dd></div><div><dt>지급 예정일</dt><dd>매월 ${e(teacher.paymentDay)}일</dd></div></dl></div><div class="detail-block"><h3>보험별 가입·신고 기준</h3><dl class="definition-list">${insuranceRows}</dl></div>`;
}
function runForMonth(month) { return state.data.payrollRuns.find((run) => run.month === month) || { month, status: "draft", publishedAt: null }; }
function cancellationsForMonth(month) {
  return state.data.payrollCancellations
    .filter((item) => item.month === month)
    .sort((a, b) => Number(b.revision) - Number(a.revision));
}
function taxPolicyForMonth(month) {
  return resolveEffectivePolicy(state.data.taxPolicies, month, ntsTaxPolicy2024);
}

function insurancePolicyForMonth(month) {
  return resolveEffectivePolicy(state.data.insurancePolicies, month, officialInsurancePolicies.at(-1));
}

function policyForMonth(month) {
  return createCombinedPolicy(taxPolicyForMonth(month), insurancePolicyForMonth(month));
}

function mergeBuiltInTaxPolicies(policies) {
  const byVersion = new Map([[ntsTaxPolicy2024.version, structuredClone(ntsTaxPolicy2024)]]);
  policies.forEach((policy) => byVersion.set(policy.version || policy.id, policy));
  return [...byVersion.values()];
}

function mergeBuiltInInsurancePolicies(policies) {
  const byVersion = new Map(officialInsurancePolicies.map((policy) => [policy.version, structuredClone(policy)]));
  policies.forEach((policy) => byVersion.set(policy.version || policy.id, policy));
  return [...byVersion.values()];
}

function availablePayslipMonths(teacherId) {
  if (!appConfig.demoMode && state.data.payslips.length) {
    return state.data.payslips
      .filter((item) => item.teacherId === teacherId && (state.user.role === "admin" || item.status === "published"))
      .map((item) => item.month)
      .sort()
      .reverse();
  }
  return [...new Set(state.data.payrollRuns.map((run) => run.month))]
    .filter((month) => state.user.role !== "teacher" || runForMonth(month).status === "published")
    .sort().reverse();
}

function payslipStatus(teacherId, month) {
  const saved = state.data.payslips.find((item) => item.teacherId === teacherId && item.month === month);
  return saved?.status || runForMonth(month).status;
}

function currentPayslip(teacherId, month) {
  return state.data.payslips.find((item) => item.teacherId === teacherId && item.month === month);
}

function payrollTable(items) {
  return `<table><thead><tr><th>선생님</th><th>급여 구성</th><th class="numeric">총 지급액</th><th class="numeric">공제액</th><th class="numeric">실 지급액</th><th>발행</th><th>열람</th><th>전달</th><th aria-label="작업"></th></tr></thead><tbody>${items.map(({ teacher, payroll }) => {
    const receipt = receiptFor(teacher.id, state.month);
    const delivery = deliveryFor(teacher.id, state.month);
    const published = runForMonth(state.month).status === "published";
    const insured = Object.values(insuranceBasesFor(payroll)).some((amount) => amount > 0);
    return `<tr><td>${personCell(teacher)}</td><td><span class="status-chip ${payroll.grossByTreatment.employee > 0 ? "published" : "ready"}">${e(payrollCompositionLabel(payroll))}</span><div class="cell-subtext">사회보험 ${insured ? "적용" : "미적용"}</div></td><td class="numeric">${formatWon(payroll.gross)}</td><td class="numeric">${formatWon(payroll.totalDeductions)}</td><td class="numeric"><strong>${formatWon(payroll.net)}</strong></td><td><span class="status-chip ${runForMonth(state.month).status}">${statusLabel(runForMonth(state.month).status)}</span></td><td>${receipt ? `<span class="status-chip published" title="${e(formatViewedAt(receipt.viewedAt))}">열람 완료</span>` : `<span class="status-chip pending">${published ? "미열람" : "발행 전"}</span>`}</td><td>${delivery ? `<span class="status-chip published" title="${e(formatDeliveryAt(delivery.sentAt))}">메일 발송</span>` : `<span class="status-chip pending">${published ? "미발송" : "발행 전"}</span>`}</td><td><div class="row-actions">${published ? "" : `<button class="icon-button" type="button" title="과세·공제 조정" aria-label="${e(teacher.name)} 과세 및 공제 조정" data-adjust-payroll="${e(teacher.id)}"><i data-lucide="calculator"></i></button>`}<button class="icon-button" type="button" title="명세서 보기" aria-label="${e(teacher.name)} 명세서 보기" data-view-payslip="${e(teacher.id)}"><i data-lucide="file-search"></i></button></div></td></tr>`;
  }).join("") || emptyRow(9)}</tbody></table>`;
}

function ledgerTable(items, summary) {
  return `<table class="accounting-ledger"><thead><tr><th>성명</th><th>연락처</th><th>생년월일·성별번호</th><th class="numeric">신고액</th><th class="numeric">수업시간</th><th class="numeric">강사료</th><th class="numeric">강사료 세액공제</th><th class="numeric">교통 횟수</th><th class="numeric">교통비</th><th class="numeric">주차료</th><th class="numeric">기타</th><th class="numeric">추가 지급 원천징수</th><th class="numeric">세액공제 합계</th><th class="numeric">소득세</th><th class="numeric">지방소득세</th><th class="numeric">건강+요양</th><th class="numeric">국민연금</th><th class="numeric">고용보험</th><th class="numeric">보험료 합계</th><th class="numeric">국민연금 기준액</th><th class="numeric">건강보험 기준액</th><th class="numeric">고용보험 기준액</th><th class="numeric">공제액 합계</th><th class="numeric">지급액</th></tr></thead><tbody>${items.map(({ teacher, payroll }) => {
    const report = accountingReportFor(payroll);
    const bases = insuranceBasesFor(payroll);
    const withholdingTotal = report.lectureWithholding + report.additionalPaymentWithholding;
    return `<tr><td>${e(teacher.name)}</td><td>${e(teacher.phone || "")}</td><td>${e(formatTeacherIdentity(teacher))}</td><td class="numeric">${formatNumber(report.reportedGross)}</td><td class="numeric">${formatHours(report.classHours)}</td><td class="numeric">${formatNumber(report.lectureFeeGross)}</td><td class="numeric">${formatNumber(report.lectureWithholding)}</td><td class="numeric">${formatNumber(report.transportTrips)}</td><td class="numeric">${formatNumber(report.transportAmount)}</td><td class="numeric">${formatNumber(report.parkingAmount)}</td><td class="numeric">${formatNumber(report.otherPaymentAmount)}</td><td class="numeric">${formatNumber(report.additionalPaymentWithholding)}</td><td class="numeric">${formatNumber(withholdingTotal)}</td><td class="numeric">${formatNumber(report.employeeIncomeTax)}</td><td class="numeric">${formatNumber(report.employeeLocalTax)}</td><td class="numeric">${formatNumber(report.healthAndLongTermCare)}</td><td class="numeric">${formatNumber(report.nationalPension)}</td><td class="numeric">${formatNumber(report.employmentInsurance)}</td><td class="numeric">${formatNumber(report.insuranceTotal)}</td><td class="numeric">${formatNumber(bases.nationalPension)}</td><td class="numeric">${formatNumber(bases.healthInsurance)}</td><td class="numeric">${formatNumber(bases.employmentInsurance)}</td><td class="numeric">${formatNumber(payroll.totalDeductions)}</td><td class="numeric"><strong>${formatNumber(payroll.net)}</strong></td></tr>`;
  }).join("")}<tr class="ledger-total"><td colspan="3"><strong>합계</strong></td><td class="numeric"><strong>${formatNumber(summary.gross)}</strong></td><td colspan="18"></td><td class="numeric"><strong>${formatNumber(summary.deductions)}</strong></td><td class="numeric"><strong>${formatNumber(summary.net)}</strong></td></tr></tbody></table>`;
}

function insuranceBasesFor(payroll) {
  return payroll.insuranceBases || {
    nationalPension: payroll.insuredBase || 0,
    healthInsurance: payroll.insuredBase || 0,
    employmentInsurance: payroll.insuredBase || 0
  };
}

function accountingReportFor(payroll) {
  if (payroll.reporting) return payroll.reporting;
  const lines = payroll.earningLines || [];
  const deductions = payroll.deductions || {};
  const categoryAmount = (category) => lines.filter((line) => line.earningCategory === category).reduce((sum, line) => sum + Number(line.amount || 0), 0);
  const insuranceTotal = Number(deductions.nationalPension || 0) + Number(deductions.healthInsurance || 0) + Number(deductions.longTermCare || 0) + Number(deductions.employmentInsurance || 0);
  return {
    reportedGross: payroll.gross || 0,
    classHours: lines.reduce((sum, line) => sum + Number(line.workHours ?? (line.earningCategory === "lectureFee" || line.treatment === "business" ? line.hours : 0) ?? 0), 0),
    lectureFeeGross: categoryAmount("lectureFee") || payroll.grossByTreatment?.business || 0,
    lectureWithholding: Number(deductions.businessIncomeTax || 0) + Number(deductions.businessLocalTax || 0),
    additionalPaymentWithholding: Number(deductions.otherIncomeTax || 0) + Number(deductions.otherLocalTax || 0),
    transportTrips: lines.filter((line) => line.earningCategory === "transport").reduce((sum, line) => sum + Number(line.quantity ?? line.hours ?? 0), 0),
    transportAmount: categoryAmount("transport"),
    parkingAmount: categoryAmount("parking"),
    otherPaymentAmount: categoryAmount("otherPayment"),
    employeeIncomeTax: Number(deductions.employeeIncomeTax || 0),
    employeeLocalTax: Number(deductions.employeeLocalTax || 0),
    healthAndLongTermCare: Number(deductions.healthInsurance || 0) + Number(deductions.longTermCare || 0),
    nationalPension: Number(deductions.nationalPension || 0),
    employmentInsurance: Number(deductions.employmentInsurance || 0),
    insuranceTotal
  };
}

function payslipSheet(teacher, payroll, month, run) {
  const deductionRows = Object.entries(deductionLabels()).filter(([key]) => payroll.deductions[key] > 0);
  return `<article class="payslip-sheet">
    <header class="payslip-title"><div><h2>${formatMonth(month)} 급여명세서</h2><p>${e(appConfig.academyName)} · 지급 예정일 매월 ${e(teacher.paymentDay)}일</p></div><span class="brand-mark" aria-hidden="true">AP</span></header>
    <div class="payslip-summary"><div><span>성명</span><strong>${e(teacher.name)}</strong></div><div><span>급여 구성</span><strong>${e(payrollCompositionLabel(payroll))} · 사회보험 ${Object.values(insuranceBasesFor(payroll)).some((amount) => amount > 0) ? "적용" : "미적용"}</strong></div><div><span>발행 상태</span><strong>${run.status === "published" ? `${artifactRevision(run)}차 발행 완료` : "미리보기"}</strong></div></div>
    <h3>지급 내역</h3><div class="table-scroll"><table><thead><tr><th>지급 항목</th><th>소득 구분</th><th>산정 기준</th><th class="numeric">금액</th></tr></thead><tbody>${payroll.earningLines.map((line) => `<tr><td>${e(line.subjectName)}</td><td>${e(TREATMENT_LABELS[line.treatment] || line.treatment)}</td><td>${e(earningBasisLabel(line))}</td><td class="numeric">${formatNumber(line.amount)}</td></tr>`).join("")}</tbody></table></div>
    <h3>공제 내역</h3><div class="table-scroll"><table><thead><tr><th>항목</th><th class="numeric">금액</th></tr></thead><tbody>${deductionRows.map(([key, label]) => `<tr><td>${e(label)}</td><td class="numeric">${formatNumber(payroll.deductions[key])}</td></tr>`).join("") || `<tr><td colspan="2">공제 내역 없음</td></tr>`}</tbody></table></div>
    <div class="payslip-totals"><div><span>총 지급액</span><strong>${formatWon(payroll.gross)}</strong></div><div><span>총 공제액</span><strong>${formatWon(payroll.totalDeductions)}</strong></div><div class="net"><span>실 지급액</span><strong>${formatWon(payroll.net)}</strong></div></div>
    <p class="payslip-footnote">본 명세서는 확정된 선생님별 월 지급액과 유형을 기준으로 작성되었습니다. 세금 기준 ${e(payroll.taxPolicyVersion || payroll.policyVersion)}, 사회보험 기준 ${e(payroll.insurancePolicyVersion || "별도 확인")}. 세부 계약 또는 공제 관련 문의는 학원 담당자에게 연락해 주세요.</p>
  </article>`;
}

function earningBasisLabel(line) {
  if (line.kind === "unit") return `${formatNumber(line.quantity ?? line.hours)}회 × ${formatNumber(line.unitRate ?? line.hourlyRate)}원`;
  if (line.kind === "monthly" && Number(line.workHours) > 0) return `월 지급액 · 수업 ${formatHours(line.workHours)}`;
  if (line.kind === "monthly") return "선생님별 월 지급액";
  return `${line.hours}시간 × ${formatNumber(line.hourlyRate)}원`;
}

function bindCommonControls() {
  elements.content.querySelectorAll("[data-control='month']").forEach((input) => input.addEventListener("change", () => { state.month = input.value; render(); }));
  elements.content.querySelectorAll("[data-control='search']").forEach((input) => input.addEventListener("input", () => { state.search = input.value; render(); }));
}

function treatmentOptions(selected = "pending") {
  return [
    ["pending", "처리 미확인"],
    ["business", "사업소득 3.3%"],
    ["employee", "근로소득 과세"],
    ["exempt", "비과세 실비"],
    ["other", "기타소득"]
  ].map(([value, label]) => `<option value="${value}" ${selected === value ? "selected" : ""}>${label}</option>`).join("");
}

function insuranceEditorHtml(settings, prefix) {
  return `<div class="form-field full insurance-editor-field">
    <div class="editor-heading"><label>보험별 가입·신고 기준</label><span class="form-help">가입한 보험만 선택하고 공단에 신고한 기준액과 적용 기간을 각각 입력합니다.</span></div>
    <div class="insurance-editor">${Object.entries(INSURANCE_LABELS).map(([key, label]) => {
      const item = settings?.[key] || {};
      return `<div class="insurance-setting-row">
        <label class="checkbox-row"><input name="${prefix}-${key}-enrolled" type="checkbox" ${item.enrolled ? "checked" : ""} /> ${e(label)} 가입</label>
        <div class="input-suffix"><input name="${prefix}-${key}-base" type="number" min="0" step="1000" value="${item.defaultBaseAmount ?? ""}" placeholder="신고 기준액" aria-label="${e(label)} 기본 신고 기준액" /><span>원</span></div>
        <input name="${prefix}-${key}-from" type="date" value="${e(item.effectiveFrom || "")}" aria-label="${e(label)} 적용 시작일" />
        <input name="${prefix}-${key}-to" type="date" value="${e(item.effectiveTo || "")}" aria-label="${e(label)} 적용 종료일" />
      </div>`;
    }).join("")}</div>
    <span class="form-help">건강보험 항목은 건강보험과 장기요양을 함께 관리합니다. 종료일이 없으면 계속 적용됩니다.</span>
  </div>`;
}

function readInsuranceSettings(form, prefix) {
  return Object.fromEntries(Object.keys(INSURANCE_LABELS).map((key) => {
    const enrolled = form.elements[`${prefix}-${key}-enrolled`]?.checked === true;
    const baseValue = form.elements[`${prefix}-${key}-base`]?.value ?? "";
    const effectiveFrom = form.elements[`${prefix}-${key}-from`]?.value || null;
    const effectiveTo = form.elements[`${prefix}-${key}-to`]?.value || null;
    if (effectiveFrom && effectiveTo && effectiveFrom > effectiveTo) {
      throw new Error(`${INSURANCE_LABELS[key]} 적용 종료일은 시작일보다 빠를 수 없습니다.`);
    }
    return [key, {
      enrolled,
      defaultBaseAmount: baseValue === "" ? null : Number(baseValue),
      effectiveFrom,
      effectiveTo
    }];
  }));
}

function monthlyInsuranceBasesHtml(settings, current, employeeGrossPay) {
  const fields = {
    nationalPension: "nationalPensionBase",
    healthInsurance: "healthInsuranceBase",
    employmentInsurance: "employmentInsuranceBase"
  };
  const rows = Object.entries(INSURANCE_LABELS).filter(([key]) => settings[key]?.enrolled).map(([key, label]) => {
    const field = fields[key];
    const value = current[field] ?? settings[key]?.defaultBaseAmount ?? employeeGrossPay ?? 0;
    return `<div class="form-field"><label for="monthly-${field}">${e(label)} 신고 기준액</label><div class="input-suffix"><input id="monthly-${field}" name="${field}" type="number" min="0" step="1000" value="${e(value)}" required /><span>원</span></div></div>`;
  }).join("");
  if (!rows) return "";
  return `<div class="form-field full form-section-heading"><strong>이번 달 보험 신고 기준액</strong><span class="form-help">보험료 자동 계산의 기준입니다. 실제 공단 신고액과 다르면 이번 달 값으로 수정합니다.</span></div>${rows}`;
}

function additionalEarningsEditorHtml(lines, containerId) {
  return `<div class="form-field full business-editor-field">
    <div class="editor-heading"><label>기타 지급 항목</label><button class="button button-secondary button-compact" type="button" data-add-additional="${e(containerId)}"><i data-lucide="plus"></i><span>항목 추가</span></button></div>
    <div id="${e(containerId)}" class="additional-line-editor">${(lines || []).map(additionalEarningRowHtml).join("")}</div>
    <span class="form-help">교통비·주차료 외 지급액을 입력합니다. 과세 처리가 확정되지 않았다면 처리 미확인을 선택하세요.</span>
  </div>`;
}

function additionalEarningRowHtml(line = {}) {
  return `<div class="additional-line-row" data-additional-row data-line-id="${e(line.id || crypto.randomUUID())}">
    <input type="text" value="${e(line.label || "")}" placeholder="항목명" aria-label="기타 지급 항목명" data-additional-label />
    <div class="input-suffix"><input type="number" min="0" step="1000" value="${e(line.amount || "")}" placeholder="금액" aria-label="기타 지급 금액" data-additional-amount /><span>원</span></div>
    <select aria-label="기타 지급 과세 처리" data-additional-treatment>${treatmentOptions(line.treatment)}</select>
    <label class="checkbox-row compact"><input type="checkbox" data-additional-insurance ${line.insuranceCovered ? "checked" : ""} /> 보험 기준 포함</label>
    <button class="icon-button" type="button" title="항목 삭제" aria-label="기타 지급 항목 삭제" data-remove-additional><i data-lucide="trash-2"></i></button>
  </div>`;
}

function bindAdditionalEarningsEditor(containerSelector) {
  const container = document.querySelector(containerSelector);
  if (!container) return;
  document.querySelector(`[data-add-additional='${container.id}']`)?.addEventListener("click", () => {
    container.insertAdjacentHTML("beforeend", additionalEarningRowHtml());
    refreshIcons();
  });
  container.addEventListener("click", (event) => {
    event.target.closest("[data-remove-additional]")?.closest("[data-additional-row]")?.remove();
  });
}

function readAdditionalEarnings(containerSelector) {
  return [...document.querySelectorAll(`${containerSelector} [data-additional-row]`)].map((row) => {
    const label = row.querySelector("[data-additional-label]").value.trim();
    const amount = Number(row.querySelector("[data-additional-amount]").value);
    if (!label && !amount) return null;
    if (!label || !Number.isFinite(amount) || amount <= 0) throw new Error("기타 지급 항목명과 0원보다 큰 금액을 함께 입력해 주세요.");
    return {
      id: row.dataset.lineId || crypto.randomUUID(),
      label,
      amount,
      treatment: row.querySelector("[data-additional-treatment]").value,
      insuranceCovered: row.querySelector("[data-additional-insurance]").checked
    };
  }).filter(Boolean);
}

function businessRateEditorHtml(rates, containerId) {
  const rows = rates.length ? rates : [{ id: crypto.randomUUID(), subjectName: "", hourlyRate: "" }];
  return `<div class="form-field full business-editor-field">
    <div class="editor-heading"><label>과목별 사업소득 시급</label><button class="button button-secondary button-compact" type="button" data-add-business-rate="${e(containerId)}"><i data-lucide="plus"></i><span>시급 추가</span></button></div>
    <div id="${e(containerId)}" class="business-line-editor">${rows.map(businessRateRowHtml).join("")}</div>
    <span class="form-help">과목마다 시급이 다르면 줄을 추가합니다. 월별 수업 시수는 월 급여 입력에서 기록합니다.</span>
  </div>`;
}

function businessRateRowHtml(rate = {}) {
  return `<div class="business-line-row rate-row" data-business-rate-row data-line-id="${e(rate.id || crypto.randomUUID())}">
    <input type="text" value="${e(rate.subjectName || "")}" placeholder="과목명" aria-label="사업소득 과목명" data-rate-subject />
    <div class="input-suffix"><input type="number" min="0" step="1000" value="${e(rate.hourlyRate || "")}" placeholder="시급" aria-label="사업소득 시급" data-rate-hourly /><span>원/시간</span></div>
    <button class="icon-button" type="button" title="시급 삭제" aria-label="사업소득 시급 삭제" data-remove-business-line><i data-lucide="trash-2"></i></button>
  </div>`;
}

function bindBusinessRateEditor(containerSelector) {
  const container = document.querySelector(containerSelector);
  if (!container) return;
  document.querySelector(`[data-add-business-rate='${container.id}']`)?.addEventListener("click", () => {
    container.insertAdjacentHTML("beforeend", businessRateRowHtml());
    refreshIcons();
  });
  container.addEventListener("click", (event) => {
    const remove = event.target.closest("[data-remove-business-line]");
    if (remove) remove.closest("[data-business-rate-row]")?.remove();
  });
}

function readBusinessRates(containerSelector) {
  return [...document.querySelectorAll(`${containerSelector} [data-business-rate-row]`)].map((row) => {
    const subjectName = row.querySelector("[data-rate-subject]").value.trim();
    const hourlyRate = Number(row.querySelector("[data-rate-hourly]").value);
    if (!subjectName && !hourlyRate) return null;
    if (!subjectName || !Number.isFinite(hourlyRate) || hourlyRate <= 0) throw new Error("사업소득 과목명과 0원보다 큰 시급을 함께 입력해 주세요.");
    return { id: row.dataset.lineId || crypto.randomUUID(), subjectName, hourlyRate };
  }).filter(Boolean);
}

function businessWorkEditorHtml(lines, containerId) {
  const rows = lines.length ? lines : [{ id: crypto.randomUUID(), rateId: null, subjectName: "", hourlyRate: "", hours: "" }];
  return `<div class="form-field full business-editor-field">
    <div class="editor-heading"><label>${formatMonth(state.month)} 사업소득 수업</label><button class="button button-secondary button-compact" type="button" data-add-business-work="${e(containerId)}"><i data-lucide="plus"></i><span>수업 추가</span></button></div>
    <div id="${e(containerId)}" class="business-line-editor">${rows.map(businessWorkRowHtml).join("")}</div>
    <div class="business-work-summary"><div><span>수업 시수</span><strong id="business-hours-total">0시간</strong></div><div><span>사업소득 총액</span><strong id="business-gross-total">0원</strong></div><div><span>예상 3.3%</span><strong id="business-tax-total">0원</strong></div><div><span>사업소득 예상 지급액</span><strong id="business-net-total">0원</strong></div></div>
  </div>`;
}

function businessWorkRowHtml(line = {}) {
  return `<div class="business-line-row work-row" data-business-work-row data-line-id="${e(line.id || crypto.randomUUID())}" data-rate-id="${e(line.rateId || "")}">
    <input type="text" value="${e(line.subjectName || "")}" placeholder="과목명" aria-label="사업소득 수업 과목명" data-work-subject />
    <div class="input-suffix"><input type="number" min="0" step="1000" value="${e(line.hourlyRate || "")}" placeholder="시급" aria-label="사업소득 수업 시급" data-work-hourly /><span>원</span></div>
    <div class="input-suffix"><input type="number" min="0" step="0.5" value="${e(line.hours || "")}" placeholder="시수" aria-label="사업소득 수업 시수" data-work-hours /><span>시간</span></div>
    <strong class="business-line-amount" data-work-amount>0원</strong>
    <button class="icon-button" type="button" title="수업 삭제" aria-label="사업소득 수업 삭제" data-remove-business-line><i data-lucide="trash-2"></i></button>
  </div>`;
}

function bindBusinessWorkEditor(containerSelector) {
  const container = document.querySelector(containerSelector);
  if (!container) return;
  document.querySelector(`[data-add-business-work='${container.id}']`)?.addEventListener("click", () => {
    container.insertAdjacentHTML("beforeend", businessWorkRowHtml());
    refreshIcons();
    updateBusinessWorkSummary(containerSelector);
  });
  container.addEventListener("input", () => updateBusinessWorkSummary(containerSelector));
  container.addEventListener("click", (event) => {
    const remove = event.target.closest("[data-remove-business-line]");
    if (!remove) return;
    remove.closest("[data-business-work-row]")?.remove();
    updateBusinessWorkSummary(containerSelector);
  });
  updateBusinessWorkSummary(containerSelector);
}

function readBusinessWorkLines(containerSelector) {
  return [...document.querySelectorAll(`${containerSelector} [data-business-work-row]`)].map((row) => {
    const subjectName = row.querySelector("[data-work-subject]").value.trim();
    const hourlyRate = Number(row.querySelector("[data-work-hourly]").value);
    const hours = Number(row.querySelector("[data-work-hours]").value);
    if (!subjectName && !hourlyRate && !hours) return null;
    if (!subjectName || !Number.isFinite(hourlyRate) || hourlyRate <= 0 || !Number.isFinite(hours) || hours < 0) throw new Error("사업소득 과목명, 시급과 0 이상의 수업 시수를 확인해 주세요.");
    return { id: row.dataset.lineId || crypto.randomUUID(), rateId: row.dataset.rateId || null, subjectName, hourlyRate, hours };
  }).filter(Boolean);
}

function updateBusinessWorkSummary(containerSelector) {
  let gross = 0;
  let hours = 0;
  document.querySelectorAll(`${containerSelector} [data-business-work-row]`).forEach((row) => {
    const rowHours = Math.max(0, Number(row.querySelector("[data-work-hours]").value) || 0);
    const hourlyRate = Math.max(0, Number(row.querySelector("[data-work-hourly]").value) || 0);
    const amount = Math.round(rowHours * hourlyRate);
    hours += rowHours;
    gross += amount;
    row.querySelector("[data-work-amount]").textContent = formatWon(amount);
  });
  const withholding = estimatedBusinessWithholding(gross);
  document.querySelector("#business-hours-total").textContent = formatHours(hours);
  document.querySelector("#business-gross-total").textContent = formatWon(gross);
  document.querySelector("#business-tax-total").textContent = formatWon(withholding);
  document.querySelector("#business-net-total").textContent = formatWon(gross - withholding);
}

function estimatedBusinessWithholding(gross) {
  const incomeTax = Math.floor(Math.max(0, Number(gross) || 0) * 0.03);
  return incomeTax + Math.round(incomeTax * 0.1);
}

function mergeBusinessWorkLines(rates, workLines) {
  const currentByRate = new Map(workLines.filter((line) => line.rateId).map((line) => [line.rateId, line]));
  const defaults = rates.map((rate) => currentByRate.get(rate.id) || { ...rate, rateId: rate.id, hours: 0 });
  const custom = workLines.filter((line) => !line.rateId || !rates.some((rate) => rate.id === line.rateId));
  return [...defaults, ...custom];
}

function bindPayrollRows() {
  elements.content.querySelectorAll("[data-view-payslip]").forEach((button) => button.addEventListener("click", () => {
    state.selectedTeacherId = button.dataset.viewPayslip;
    state.selectedPayslipMonth = state.month;
    state.view = "adminPayslip";
    render();
  }));
  elements.content.querySelectorAll("[data-adjust-payroll]").forEach((button) => button.addEventListener("click", () => {
    const teacher = teacherById(button.dataset.adjustPayroll);
    if (teacher) openPayrollAdjustmentModal(teacher);
  }));
}

function openEntryModal() {
  const teacherOptions = state.data.teachers.map((teacher) => `<option value="${e(teacher.id)}">${e(teacher.name)}</option>`).join("");
  openModal("수업 내역 추가", `
    <div class="notice"><i data-lucide="list-checks"></i><span>소득 구분은 계약서 명칭이 아니라 실제 고용관계, 계속·반복성, 독립성을 확인해 선택하세요.</span></div>
    <form id="entry-form" class="form-grid">
      <div class="form-field"><label for="entry-date">수업일</label><input id="entry-date" name="workedOn" type="date" value="${e(state.month)}-15" required /></div>
      <div class="form-field"><label for="entry-teacher">선생님</label><select id="entry-teacher" name="teacherId" required>${teacherOptions}</select></div>
      <div class="form-field full"><label for="entry-subject">과목명</label><input id="entry-subject" name="subjectName" required placeholder="예: 고등 수학" /></div>
      <div class="form-field"><label for="entry-hours">수업 시간</label><input id="entry-hours" name="hours" type="number" min="0.5" step="0.5" required /></div>
      <div class="form-field"><label for="entry-rate">시급</label><input id="entry-rate" name="hourlyRate" type="number" min="0" step="1000" required /></div>
      <div class="form-field"><label for="entry-treatment">소득 구분</label><select id="entry-treatment" name="treatment"><option value="employee">근로소득</option><option value="business">사업소득</option><option value="other">기타소득</option><option value="exempt">공제 없음</option></select></div>
      <div class="form-field"><label>보험 적용</label><label class="checkbox-row"><input name="insuranceCovered" type="checkbox" /> 이 수업을 보험 기준액에 포함</label></div>
      <div class="form-field"><label for="entry-other-category">기타소득 분류</label><select id="entry-other-category" name="otherIncomeCategory"><option value="temporaryLecture">일시적 강의·인적용역</option></select></div>
      <div class="form-field"><label for="entry-payment-group">기타소득 지급 건 ID</label><input id="entry-payment-group" name="otherPaymentGroup" placeholder="비우면 월 지급분 합산" /><span class="form-help">별도 지급 건이면 같은 ID끼리 과세최저한을 계산합니다.</span></div>
    </form>`, "추가", async () => {
      const form = document.querySelector("#entry-form");
      if (!form.reportValidity()) return false;
      const data = Object.fromEntries(new FormData(form));
      const entry = { id: crypto.randomUUID(), month: data.workedOn.slice(0, 7), workedOn: data.workedOn, teacherId: data.teacherId, subjectName: data.subjectName, subjectId: slug(data.subjectName), hours: Number(data.hours), hourlyRate: Number(data.hourlyRate), treatment: data.treatment, insuranceCovered: data.insuranceCovered === "on", otherIncomeCategory: data.treatment === "other" ? data.otherIncomeCategory : null, otherPaymentGroup: data.treatment === "other" ? data.otherPaymentGroup || null : null, source: "manual" };
      state.data.entries.push(entry);
      if (state.store) await state.store.saveDocument("workEntries", entry.id, entry);
      state.month = entry.month;
      showToast("수업 내역을 추가했습니다.");
      renderEntries();
    });
}

function openTeacherSelfProfileModal(teacher) {
  openModal("내 정보 수정", `
    <div class="notice"><i data-lucide="shield-check"></i><span>급여와 로그인 권한에 영향을 주는 정보는 변경되지 않습니다.</span></div>
    <form id="teacher-self-profile-form" class="form-grid">
      <div class="form-field"><label for="self-profile-name">이름</label><input id="self-profile-name" name="name" value="${e(teacher.name)}" required /></div>
      <div class="form-field"><label for="self-profile-phone">연락처</label><input id="self-profile-phone" name="phone" type="tel" autocomplete="tel" value="${e(teacher.phone || "")}" placeholder="010-0000-0000" /></div>
      <div class="form-field"><label for="self-profile-birth">생년월일 6자리</label><input id="self-profile-birth" name="birthDateCode" type="text" inputmode="numeric" autocomplete="off" minlength="6" maxlength="6" pattern="[0-9]{6}" value="${e(teacher.birthDateCode || "")}" required /><span class="form-help">주민등록번호 앞 6자리만 저장합니다.</span></div>
      <div class="form-field"><label for="self-profile-gender">성별번호 1자리</label><input id="self-profile-gender" name="genderCode" type="text" inputmode="numeric" autocomplete="off" minlength="1" maxlength="1" pattern="[1-8]" value="${e(teacher.genderCode || "")}" required /><span class="form-help">주민등록번호 뒷자리의 첫 숫자만 저장합니다.</span></div>
      <div class="form-field full"><label for="self-profile-subjects">담당 과목</label><input id="self-profile-subjects" name="subjects" value="${e((teacher.subjects || []).join(", "))}" placeholder="쉼표로 구분" /></div>
      <div class="form-field full"><label for="self-profile-email">Google 이메일</label><input id="self-profile-email" type="email" value="${e(teacher.email)}" readonly /><span class="form-help">로그인 이메일은 관리자만 변경할 수 있습니다.</span></div>
    </form>
  `, "저장", async () => {
    const form = document.querySelector("#teacher-self-profile-form");
    if (!form.reportValidity()) return false;
    const data = Object.fromEntries(new FormData(form));
    const profile = {
      name: data.name.trim(),
      phone: data.phone.trim(),
      ...validateTeacherIdentity(data.birthDateCode, data.genderCode),
      subjects: data.subjects.split(",").map((item) => item.trim()).filter(Boolean)
    };
    if (state.store) await state.store.saveTeacherProfile(teacher.id, profile);
    Object.assign(teacher, profile);
    state.user.name = profile.name;
    document.querySelector("#user-name").textContent = profile.name;
    document.querySelector("#user-avatar").textContent = profile.name.slice(0, 1);
    showToast("내 정보를 저장했습니다.");
    renderProfile();
  });
}

function openTeacherModal() {
  openModal("선생님 등록", `
    <form id="teacher-form" class="form-grid">
      <div class="form-field"><label for="teacher-name">이름</label><input id="teacher-name" name="name" required /></div>
      <div class="form-field"><label for="teacher-email">Google 이메일</label><input id="teacher-email" name="email" type="email" required /></div>
      <div class="form-field"><label for="teacher-phone">연락처</label><input id="teacher-phone" name="phone" type="tel" autocomplete="tel" placeholder="010-0000-0000" /></div>
      <div class="form-field"><label for="teacher-birth-date-code">생년월일 6자리</label><input id="teacher-birth-date-code" name="birthDateCode" type="text" inputmode="numeric" autocomplete="off" minlength="6" maxlength="6" pattern="[0-9]{6}" placeholder="예: 900101" /><span class="form-help">비워 두면 선생님이 로그인 후 직접 입력할 수 있습니다.</span></div>
      <div class="form-field"><label for="teacher-gender-code">성별번호 1자리</label><input id="teacher-gender-code" name="genderCode" type="text" inputmode="numeric" autocomplete="off" minlength="1" maxlength="1" pattern="[1-8]" placeholder="예: 1" /><span class="form-help">생년월일과 함께 입력하거나 두 항목을 모두 비워 두세요.</span></div>
      ${insuranceEditorHtml(getTeacherPaySettings({}).insuranceSettings, "teacher")}
      <div class="form-field"><label for="teacher-employee-pay">기본 근로소득 월 지급액</label><input id="teacher-employee-pay" name="defaultEmployeePay" type="number" min="0" step="1000" value="0" required /></div>
      <div class="form-field"><label for="teacher-transport-region">교통비 적용 지역·기준</label><input id="teacher-transport-region" name="transportRegionLabel" placeholder="예: 서울 시내" /></div>
      <div class="form-field"><label for="teacher-transport-unit">교통 1회 금액</label><div class="input-suffix"><input id="teacher-transport-unit" name="transportUnitAmount" type="number" min="0" step="100" value="0" /><span>원</span></div></div>
      <div class="form-field"><label for="teacher-transport-treatment">교통비 기본 처리</label><select id="teacher-transport-treatment" name="transportTreatment">${treatmentOptions("pending")}</select></div>
      ${businessRateEditorHtml([], "teacher-business-rates")}
      <div class="form-field full"><label for="teacher-subjects">담당 과목</label><input id="teacher-subjects" name="subjects" placeholder="쉼표로 구분" /></div>
      <div class="form-field"><label for="teacher-contract">계약 요약</label><input id="teacher-contract" name="contractSummary" placeholder="예: 정규 월급제" /></div>
      <div class="form-field"><label for="teacher-payday">지급일</label><input id="teacher-payday" name="paymentDay" type="number" min="1" max="31" value="10" /></div>
      <div class="form-field"><label for="teacher-dependents">공제대상가족 수</label><input id="teacher-dependents" name="dependentCount" type="number" min="1" step="1" value="1" required /></div>
      <div class="form-field"><label for="teacher-children">8~20세 자녀 수</label><input id="teacher-children" name="children8To20" type="number" min="0" step="1" value="0" required /></div>
      <div class="form-field"><label for="teacher-tax-ratio">원천징수 비율</label><select id="teacher-tax-ratio" name="withholdingRatio"><option value="0.8">80%</option><option value="1" selected>100%</option><option value="1.2">120%</option></select></div>
      <p class="form-help full">실제 계정 연결은 사용자가 처음 로그인한 뒤 관리자 승인 절차에서 UID를 확인하도록 운영하세요.</p>
    </form>`, "등록", async () => {
    const form = document.querySelector("#teacher-form");
    if (!form.reportValidity()) return false;
    const data = Object.fromEntries(new FormData(form));
    const email = normalizeEmail(data.email);
    if (state.data.teachers.some((teacher) => normalizeEmail(teacher.email) === email)) throw new Error("같은 Google 이메일로 등록된 선생님이 있습니다.");
    const insuranceSettings = readInsuranceSettings(form, "teacher");
    const identity = validateOptionalTeacherIdentity(data.birthDateCode, data.genderCode);
    const teacher = {
      id: crypto.randomUUID(),
      name: data.name.trim(),
      email,
      phone: data.phone.trim(),
      ...identity,
      insuranceEnrolled: Object.values(insuranceSettings).some((item) => item.enrolled),
      insuranceSettings,
      defaultEmployeePay: Number(data.defaultEmployeePay),
      defaultBusinessPay: 0,
      businessRates: readBusinessRates("#teacher-business-rates"),
      transportPolicy: {
        regionLabel: data.transportRegionLabel.trim(),
        unitAmount: Number(data.transportUnitAmount || 0),
        treatment: data.transportTreatment
      },
      subjects: data.subjects.split(",").map((item) => item.trim()).filter(Boolean),
      contractSummary: data.contractSummary.trim() || "월 지급 조건",
      paymentDay: Number(data.paymentDay),
      status: "active",
      authUid: null,
      taxProfile: { dependentCount: Number(data.dependentCount), children8To20: Number(data.children8To20), withholdingRatio: Number(data.withholdingRatio) }
    };
      state.data.teachers.push(teacher);
      if (state.store) await state.store.saveDocument("teachers", teacher.id, teacher);
      state.selectedTeacherId = teacher.id;
      showToast("선생님을 등록했습니다.");
      renderTeachers();
    });
  bindBusinessRateEditor("#teacher-business-rates");
}

function openRateModal() {
  openModal("시급 · 계약 조건 추가", `
    <form id="rate-form" class="form-grid">
      <div class="form-field"><label for="rate-teacher">선생님</label><select id="rate-teacher" name="teacherId">${state.data.teachers.map((teacher) => `<option value="${e(teacher.id)}">${e(teacher.name)}</option>`).join("")}</select></div>
      <div class="form-field"><label for="rate-subject">과목</label><input id="rate-subject" name="subjectName" required /></div>
      <div class="form-field"><label for="rate-amount">시급</label><input id="rate-amount" name="hourlyRate" type="number" min="0" step="1000" required /></div>
      <div class="form-field"><label for="rate-treatment">소득 구분</label><select id="rate-treatment" name="treatment"><option value="employee">근로소득</option><option value="business">사업소득</option><option value="other">기타소득</option><option value="exempt">공제 없음</option></select></div>
      <div class="form-field"><label for="rate-other-category">기타소득 분류</label><select id="rate-other-category" name="otherIncomeCategory"><option value="temporaryLecture">일시적 강의·인적용역</option></select></div>
      <div class="form-field"><label for="rate-start">적용 시작일</label><input id="rate-start" name="effectiveFrom" type="date" value="${e(state.month)}-01" required /></div>
      <div class="form-field"><label>보험 적용</label><label class="checkbox-row"><input name="insuranceCovered" type="checkbox" /> 보험 적용 수업</label></div>
    </form>`, "추가", async () => {
      const form = document.querySelector("#rate-form");
      if (!form.reportValidity()) return false;
      const data = Object.fromEntries(new FormData(form));
      const rule = { id: crypto.randomUUID(), teacherId: data.teacherId, subjectName: data.subjectName, subjectId: slug(data.subjectName), hourlyRate: Number(data.hourlyRate), treatment: data.treatment, insuranceCovered: data.insuranceCovered === "on", otherIncomeCategory: data.treatment === "other" ? data.otherIncomeCategory : null, effectiveFrom: data.effectiveFrom };
      state.data.rateRules.push(rule);
      if (state.store) await state.store.saveDocument("rateRules", rule.id, rule);
      showToast("계약 조건을 추가했습니다.");
      renderRates();
    });
}

function openCsvHelpModal() {
  openModal("CSV 수업 내역 업로드", `
    <div class="notice"><i data-lucide="file-spreadsheet"></i><span>첫 줄의 열 이름을 아래 형식과 같게 만든 UTF-8 CSV를 선택해 주세요.</span></div>
    <div class="data-surface table-scroll"><table><thead><tr><th>workedOn</th><th>teacherId</th><th>subjectName</th><th>hours</th><th>hourlyRate</th><th>treatment</th><th>insuranceCovered</th><th>otherIncomeCategory</th><th>otherPaymentGroup</th></tr></thead><tbody><tr><td>2026-08-05</td><td>teacher-id</td><td>중등 수학</td><td>2</td><td>42000</td><td>employee</td><td>true</td><td></td><td></td></tr></tbody></table></div>
    <form id="csv-form" class="form-grid" style="margin-top:16px"><div class="form-field full"><label for="csv-file">CSV 파일</label><input id="csv-file" name="file" type="file" accept=".csv,text/csv" required /><span class="form-help">treatment 값: employee, business, other, exempt. 기타소득은 선택 열에 temporaryLecture와 지급 건 ID를 넣을 수 있습니다.</span></div></form>
  `, "업로드", async () => {
    const input = document.querySelector("#csv-file");
    if (!input.files?.[0]) { showToast("CSV 파일을 선택해 주세요."); return false; }
    const objects = csvRowsToObjects(parseCsv(await input.files[0].text()));
    const required = ["workedOn", "teacherId", "subjectName", "hours", "hourlyRate", "treatment", "insuranceCovered"];
    if (!objects.length || required.some((key) => !(key in objects[0]))) throw new Error("CSV 열 이름을 확인해 주세요.");
    const allowedTreatments = new Set(["employee", "business", "other", "exempt"]);
    const entries = objects.map((item, index) => {
      if (!teacherById(item.teacherId)) throw new Error(`${index + 2}행의 teacherId가 등록되어 있지 않습니다.`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(item.workedOn)) throw new Error(`${index + 2}행의 workedOn 형식을 확인해 주세요.`);
      if (!allowedTreatments.has(item.treatment)) throw new Error(`${index + 2}행의 treatment 값을 확인해 주세요.`);
      return { id: crypto.randomUUID(), month: item.workedOn.slice(0, 7), workedOn: item.workedOn, teacherId: item.teacherId, subjectName: item.subjectName, subjectId: slug(item.subjectName), hours: Number(item.hours), hourlyRate: Number(item.hourlyRate), treatment: item.treatment, insuranceCovered: item.insuranceCovered.toLowerCase() === "true", otherIncomeCategory: item.treatment === "other" ? item.otherIncomeCategory || "temporaryLecture" : null, otherPaymentGroup: item.treatment === "other" ? item.otherPaymentGroup || null : null, source: "csv" };
    });
    if (entries.some((entry) => !Number.isFinite(entry.hours) || !Number.isFinite(entry.hourlyRate))) throw new Error("시간 또는 시급에 숫자가 아닌 값이 있습니다.");
    state.data.entries.push(...entries);
    if (state.store) await Promise.all(entries.map((entry) => state.store.saveDocument("workEntries", entry.id, entry)));
    state.month = entries[0].month;
    showToast(`${entries.length}건의 수업 내역을 추가했습니다.`);
    renderEntries();
  });
}

function openAccessApprovalModal(request) {
  const matches = matchingTeachersForAccessRequest(request, state.data.teachers);
  const options = matches.map((teacher) => `<option value="${e(teacher.id)}">${e(teacher.name)} · ${e(teacher.email)}</option>`).join("");
  openModal("Google 계정 연결 승인", `
    <div class="notice ${matches.length === 1 ? "" : "warning"}"><i data-lucide="shield-check"></i><span>${matches.length === 1 ? "요청 이메일과 등록 이메일이 일치합니다. 승인하면 선생님이 다시 로그인할 수 있습니다." : "같은 이메일의 활성 선생님을 찾지 못했습니다. 선생님을 먼저 등록하거나 이메일을 수정해 주세요."}</span></div>
    <dl class="definition-list approval-summary"><div><dt>요청자</dt><dd>${e(request.displayName || "이름 미확인")}</dd></div><div><dt>Google 이메일</dt><dd>${e(request.email)}</dd></div><div><dt>Firebase UID</dt><dd>${e(request.uid || request.id)}</dd></div></dl>
    <form id="access-approval-form" class="form-grid" style="margin-top:18px">
      <div class="form-field full"><label for="approval-teacher">연결할 선생님</label><select id="approval-teacher" name="teacherId" required ${matches.length ? "" : "disabled"}>${options || `<option value="">일치하는 선생님 없음</option>`}</select></div>
      <label class="checkbox-row full"><input name="confirmed" type="checkbox" ${matches.length ? "" : "disabled"} /> 이메일과 선생님 정보를 확인했습니다.</label>
    </form>
  `, "승인 및 연결", async () => {
    const form = document.querySelector("#access-approval-form");
    if (!matches.length) throw new Error("이메일이 일치하는 선생님을 먼저 등록해 주세요.");
    if (!form.reportValidity()) return false;
    if (!form.elements.confirmed.checked) { showToast("승인 확인을 선택해 주세요."); return false; }
    const teacher = teacherById(new FormData(form).get("teacherId"));
    validateTeacherAccessApproval(request, teacher);
    if (state.store) await state.store.approveTeacherAccess(request, teacher);
    teacher.authUid = request.uid || request.id;
    request.status = "approved";
    request.teacherId = teacher.id;
    request.reviewedAt = new Date().toISOString();
    showToast(`${teacher.name} 선생님의 Google 계정을 연결했습니다.`);
    renderTeachers();
  });
}

function openTeacherEditModal(teacher) {
  const profile = taxProfileForTeacher(teacher);
  const paySettings = teacherPaySettings(teacher);
  openModal("선생님 정보 수정", `
    <div class="notice"><i data-lucide="user-cog"></i><span>비활성화하면 다음 로그인부터 접근이 차단되며 과거 급여 자료는 삭제되지 않습니다.</span></div>
    <form id="teacher-edit-form" class="form-grid">
      <div class="form-field"><label for="teacher-edit-name">이름</label><input id="teacher-edit-name" name="name" value="${e(teacher.name)}" required /></div>
      <div class="form-field"><label for="teacher-edit-email">Google 이메일</label><input id="teacher-edit-email" name="email" type="email" value="${e(teacher.email)}" ${teacher.authUid ? "readonly" : ""} required /><span class="form-help">${teacher.authUid ? "연결된 계정의 이메일은 변경할 수 없습니다." : "승인 요청의 Google 이메일과 정확히 일치해야 합니다."}</span></div>
      <div class="form-field"><label for="teacher-edit-phone">연락처</label><input id="teacher-edit-phone" name="phone" type="tel" autocomplete="tel" value="${e(teacher.phone || "")}" placeholder="010-0000-0000" /></div>
      <div class="form-field"><label for="teacher-edit-birth-date-code">생년월일 6자리</label><input id="teacher-edit-birth-date-code" name="birthDateCode" type="text" inputmode="numeric" autocomplete="off" minlength="6" maxlength="6" pattern="[0-9]{6}" value="${e(teacher.birthDateCode || "")}" placeholder="예: 900101" /><span class="form-help">비워 두면 선생님이 로그인 후 직접 입력할 수 있습니다.</span></div>
      <div class="form-field"><label for="teacher-edit-gender-code">성별번호 1자리</label><input id="teacher-edit-gender-code" name="genderCode" type="text" inputmode="numeric" autocomplete="off" minlength="1" maxlength="1" pattern="[1-8]" value="${e(teacher.genderCode || "")}" placeholder="예: 1" /><span class="form-help">생년월일과 함께 입력하거나 두 항목을 모두 비워 두세요.</span></div>
      ${insuranceEditorHtml(paySettings.insuranceSettings, "teacher-edit")}
      <div class="form-field"><label for="teacher-edit-employee-pay">기본 근로소득 월 지급액</label><input id="teacher-edit-employee-pay" name="defaultEmployeePay" type="number" min="0" step="1000" value="${e(paySettings.defaultEmployeePay)}" required /></div>
      <div class="form-field"><label for="teacher-edit-transport-region">교통비 적용 지역·기준</label><input id="teacher-edit-transport-region" name="transportRegionLabel" value="${e(paySettings.transportPolicy.regionLabel)}" placeholder="예: 서울 시내" /></div>
      <div class="form-field"><label for="teacher-edit-transport-unit">교통 1회 금액</label><div class="input-suffix"><input id="teacher-edit-transport-unit" name="transportUnitAmount" type="number" min="0" step="100" value="${e(paySettings.transportPolicy.unitAmount)}" /><span>원</span></div></div>
      <div class="form-field"><label for="teacher-edit-transport-treatment">교통비 기본 처리</label><select id="teacher-edit-transport-treatment" name="transportTreatment">${treatmentOptions(paySettings.transportPolicy.treatment)}</select></div>
      ${businessRateEditorHtml(paySettings.businessRates, "teacher-business-rates")}
      <div class="form-field full"><label for="teacher-edit-subjects">담당 과목</label><input id="teacher-edit-subjects" name="subjects" value="${e(teacher.subjects.join(", "))}" placeholder="쉼표로 구분" /></div>
      <div class="form-field"><label for="teacher-edit-contract">계약 요약</label><input id="teacher-edit-contract" name="contractSummary" value="${e(teacher.contractSummary)}" /></div>
      <div class="form-field"><label for="teacher-edit-payday">지급일</label><input id="teacher-edit-payday" name="paymentDay" type="number" min="1" max="31" value="${e(teacher.paymentDay)}" required /></div>
      <div class="form-field"><label for="teacher-edit-status">계정 상태</label><select id="teacher-edit-status" name="status"><option value="active" ${teacher.status === "active" ? "selected" : ""}>활성</option><option value="inactive" ${teacher.status === "inactive" ? "selected" : ""}>비활성</option></select></div>
      <div class="form-field"><label for="teacher-edit-dependents">공제대상가족 수</label><input id="teacher-edit-dependents" name="dependentCount" type="number" min="1" step="1" value="${e(profile.dependentCount)}" required /></div>
      <div class="form-field"><label for="teacher-edit-children">8~20세 자녀 수</label><input id="teacher-edit-children" name="children8To20" type="number" min="0" step="1" value="${e(profile.children8To20)}" required /></div>
      <div class="form-field full"><label for="teacher-edit-ratio">원천징수 비율</label><select id="teacher-edit-ratio" name="withholdingRatio"><option value="0.8" ${profile.withholdingRatio === 0.8 ? "selected" : ""}>80%</option><option value="1" ${profile.withholdingRatio === 1 ? "selected" : ""}>100%</option><option value="1.2" ${profile.withholdingRatio === 1.2 ? "selected" : ""}>120%</option></select></div>
    </form>
  `, "저장", async () => {
    const form = document.querySelector("#teacher-edit-form");
    if (!form.reportValidity()) return false;
    const data = Object.fromEntries(new FormData(form));
    const email = normalizeEmail(data.email);
    if (state.data.teachers.some((item) => item.id !== teacher.id && normalizeEmail(item.email) === email)) throw new Error("같은 Google 이메일로 등록된 선생님이 있습니다.");
    const insuranceSettings = readInsuranceSettings(form, "teacher-edit");
    const identity = validateOptionalTeacherIdentity(data.birthDateCode, data.genderCode);
    const { accountingReference: _legacyAccountingReference, ...teacherWithoutLegacyReference } = teacher;
    const updated = {
      ...teacherWithoutLegacyReference,
      name: data.name.trim(),
      email,
      phone: data.phone.trim(),
      ...identity,
      insuranceEnrolled: Object.values(insuranceSettings).some((item) => item.enrolled),
      insuranceSettings,
      defaultEmployeePay: Number(data.defaultEmployeePay),
      defaultBusinessPay: 0,
      businessRates: readBusinessRates("#teacher-business-rates"),
      transportPolicy: {
        regionLabel: data.transportRegionLabel.trim(),
        unitAmount: Number(data.transportUnitAmount || 0),
        treatment: data.transportTreatment
      },
      subjects: data.subjects.split(",").map((item) => item.trim()).filter(Boolean),
      contractSummary: data.contractSummary.trim() || "조건 미설정",
      paymentDay: Number(data.paymentDay),
      status: data.status,
      taxProfile: { dependentCount: Number(data.dependentCount), children8To20: Number(data.children8To20), withholdingRatio: Number(data.withholdingRatio) }
    };
    if (state.store) await state.store.updateTeacher(updated);
    delete teacher.accountingReference;
    Object.assign(teacher, updated);
    showToast(`${teacher.name} 선생님 정보를 저장했습니다.`);
    renderTeachers();
  });
  bindBusinessRateEditor("#teacher-business-rates");
}

function openTaxProfileModal(teacher) {
  const profile = taxProfileForTeacher(teacher);
  openModal("근로소득 원천징수 정보", `
    <div class="notice"><i data-lucide="calculator"></i><span>공제대상가족에는 근로자 본인이 포함됩니다. 8~20세 자녀 수는 간이세액표 세액에서 자녀 공제를 적용할 때 사용합니다.</span></div>
    <form id="tax-profile-form" class="form-grid">
      <div class="form-field"><label for="profile-dependents">공제대상가족 수</label><input id="profile-dependents" name="dependentCount" type="number" min="1" step="1" value="${e(profile.dependentCount)}" required /></div>
      <div class="form-field"><label for="profile-children">8~20세 자녀 수</label><input id="profile-children" name="children8To20" type="number" min="0" step="1" value="${e(profile.children8To20)}" required /></div>
      <div class="form-field full"><label for="profile-ratio">원천징수 비율</label><select id="profile-ratio" name="withholdingRatio"><option value="0.8" ${profile.withholdingRatio === 0.8 ? "selected" : ""}>80%</option><option value="1" ${profile.withholdingRatio === 1 ? "selected" : ""}>100%</option><option value="1.2" ${profile.withholdingRatio === 1.2 ? "selected" : ""}>120%</option></select><span class="form-help">신청하지 않은 경우 100%입니다. 변경 신청한 비율은 해당 과세기간 종료일까지 적용합니다.</span></div>
    </form>
  `, "저장", async () => {
    const form = document.querySelector("#tax-profile-form");
    if (!form.reportValidity()) return false;
    const data = Object.fromEntries(new FormData(form));
    teacher.taxProfile = {
      dependentCount: Number(data.dependentCount),
      children8To20: Number(data.children8To20),
      withholdingRatio: Number(data.withholdingRatio)
    };
    if (state.store) await state.store.saveDocument("teachers", teacher.id, teacher);
    showToast("원천징수 정보를 저장했습니다.");
    renderTeachers();
  });
}

function openMonthlyPayModal(teacher) {
  const key = `${state.month}:${teacher.id}`;
  const current = state.data.overrides[key] || {};
  const settings = teacherPaySettings(teacher);
  const amounts = monthlyPayAmounts(teacher, state.month);
  const workLines = mergeBusinessWorkLines(settings.businessRates, amounts.businessWorkLines);
  const legacyBusinessAmount = amounts.businessGrossPay > 0 && !amounts.businessWorkLines.length
    ? amounts.businessGrossPay
    : 0;
  openModal(`${teacher.name} 월 지급액`, `
    <div class="notice"><i data-lucide="wallet-cards"></i><span>신고액은 아래 모든 지급 항목의 합계입니다. 교통비·주차료·기타 지급은 세무사 확인 결과에 맞는 처리 방식을 선택해야 급여를 확정할 수 있습니다.</span></div>
    ${legacyBusinessAmount ? `<div class="notice warning"><i data-lucide="history"></i><span>기존 고정 사업소득 ${formatWon(legacyBusinessAmount)}을 읽었습니다. 아래에 과목·시급·시수를 저장하면 새 계산 방식으로 전환됩니다.</span></div>` : ""}
    <form id="monthly-pay-form" class="form-grid">
      <div class="form-field"><label for="monthly-pay-default-employee">기본 근로소득</label><input id="monthly-pay-default-employee" type="text" value="${e(formatWon(settings.defaultEmployeePay))}" readonly /></div>
      <div class="form-field"><label for="monthly-pay-employee">${formatMonth(state.month)} 근로소득</label><input id="monthly-pay-employee" name="employeeGrossPay" type="number" min="0" step="1000" value="${e(amounts.employeeGrossPay)}" required /></div>
      <div class="form-field"><label for="monthly-employee-hours">근로 수업시간</label><div class="input-suffix"><input id="monthly-employee-hours" name="employeeWorkHours" type="number" min="0" step="0.5" value="${e(amounts.employeeWorkHours)}" /><span>시간</span></div></div>
      ${monthlyInsuranceBasesHtml(settings.insuranceSettings, current, amounts.employeeGrossPay)}
      ${businessWorkEditorHtml(workLines, "monthly-business-work")}
      <div class="form-field full form-section-heading"><strong>교통비·주차료</strong><span class="form-help">과세 여부가 정해지지 않았다면 처리 미확인으로 저장한 뒤 세무사에게 확인하세요.</span></div>
      <div class="form-field"><label for="monthly-transport-trips">대중교통 이용 횟수</label><div class="input-suffix"><input id="monthly-transport-trips" name="transportTrips" type="number" min="0" step="1" value="${e(amounts.transportTrips)}" /><span>회</span></div></div>
      <div class="form-field"><label for="monthly-transport-unit">교통 1회 금액</label><div class="input-suffix"><input id="monthly-transport-unit" name="transportUnitAmount" type="number" min="0" step="100" value="${e(amounts.transportUnitAmount)}" /><span>원</span></div></div>
      <div class="form-field"><label for="monthly-transport-treatment">교통비 처리</label><select id="monthly-transport-treatment" name="transportTreatment">${treatmentOptions(amounts.transportTreatment)}</select></div>
      <label class="checkbox-row form-field"><input name="transportInsuranceCovered" type="checkbox" ${amounts.transportInsuranceCovered ? "checked" : ""} /> 교통비를 보험 기준에 포함</label>
      <div class="form-field"><label for="monthly-parking">주차료</label><div class="input-suffix"><input id="monthly-parking" name="parkingAmount" type="number" min="0" step="1000" value="${e(amounts.parkingAmount)}" /><span>원</span></div></div>
      <div class="form-field"><label for="monthly-parking-treatment">주차료 처리</label><select id="monthly-parking-treatment" name="parkingTreatment">${treatmentOptions(amounts.parkingTreatment)}</select></div>
      <label class="checkbox-row form-field"><input name="parkingInsuranceCovered" type="checkbox" ${amounts.parkingInsuranceCovered ? "checked" : ""} /> 주차료를 보험 기준에 포함</label>
      ${additionalEarningsEditorHtml(amounts.additionalEarnings, "monthly-additional-earnings")}
      <div class="form-field full"><label for="monthly-pay-note">변경 메모</label><input id="monthly-pay-note" name="grossPayNote" maxlength="200" value="${e(current.grossPayNote || "")}" placeholder="예: 보강 수업 2시간 포함" /><span class="form-help">개인정보나 상세 급여 내역을 적지 말고 변경 이유만 간단히 기록합니다.</span></div>
    </form>
  `, "저장", async () => {
    const form = document.querySelector("#monthly-pay-form");
    if (!form.reportValidity()) return false;
    const data = Object.fromEntries(new FormData(form));
    const businessWorkLines = readBusinessWorkLines("#monthly-business-work");
    const override = {
      ...current,
      id: `${state.month}_${teacher.id}`,
      month: state.month,
      teacherId: teacher.id,
      employeeGrossPay: Number(data.employeeGrossPay),
      employeeWorkHours: Number(data.employeeWorkHours || 0),
      businessGrossPay: null,
      businessWorkLines,
      transportTrips: Number(data.transportTrips || 0),
      transportUnitAmount: Number(data.transportUnitAmount || 0),
      transportTreatment: data.transportTreatment,
      transportInsuranceCovered: form.elements.transportInsuranceCovered.checked,
      parkingAmount: Number(data.parkingAmount || 0),
      parkingTreatment: data.parkingTreatment,
      parkingInsuranceCovered: form.elements.parkingInsuranceCovered.checked,
      additionalEarnings: readAdditionalEarnings("#monthly-additional-earnings"),
      grossPayNote: data.grossPayNote.trim() || null
    };
    ["nationalPensionBase", "healthInsuranceBase", "employmentInsuranceBase"].forEach((field) => {
      if (!form.elements[field]) return;
      override[field] = form.elements[field].value === "" ? null : Number(form.elements[field].value);
    });
    state.data.overrides[key] = override;
    const workInput = teacher.authUid ? {
      id: monthlyWorkInputId(state.month, teacher.id),
      teacherId: teacher.id,
      teacherUid: teacher.authUid,
      month: state.month,
      employeeWorkHours: override.employeeWorkHours,
      businessHours: businessHoursFromWorkLines(settings.businessRates, businessWorkLines),
      submittedAt: new Date().toISOString()
    } : null;
    if (workInput) state.data.monthlyWorkInputs[key] = workInput;
    if (state.store) await state.store.saveAdminMonthlyPayroll(override, workInput);
    showToast(`${formatMonth(state.month)} 지급액을 저장했습니다.`);
    renderPayrollInputs();
  });
  bindBusinessWorkEditor("#monthly-business-work");
  bindAdditionalEarningsEditor("#monthly-additional-earnings");
}

function openPayrollAdjustmentModal(teacher) {
  const key = `${state.month}:${teacher.id}`;
  const current = state.data.overrides[key] || {};
  const optionalValue = (name) => current[name] == null ? "" : e(current[name]);
  const combinedHealthValue = current.healthAndLongTermCare != null
    ? e(current.healthAndLongTermCare)
    : current.healthInsurance != null || current.longTermCare != null
      ? e(Number(current.healthInsurance || 0) + Number(current.longTermCare || 0))
      : "";
  openModal(`${teacher.name} 과세·공제 조정`, `
    <div class="notice"><i data-lucide="circle-equal"></i><span>비과세와 학자금 지원액은 근로소득 간이세액표의 월급여에서 제외됩니다. 수동 공제액을 비워 두면 현재 세금·사회보험 정책으로 자동 계산합니다.</span></div>
    <form id="payroll-adjustment-form" class="form-grid">
      <div class="form-field"><label for="adjust-nontaxable">근로소득 비과세액</label><input id="adjust-nontaxable" name="employeeNonTaxableAmount" type="number" min="0" step="1" value="${e(current.employeeNonTaxableAmount || 0)}" /></div>
      <div class="form-field"><label for="adjust-student-loan">학자금 지원액</label><input id="adjust-student-loan" name="employeeStudentLoanSupportAmount" type="number" min="0" step="1" value="${e(current.employeeStudentLoanSupportAmount || 0)}" /></div>
      <div class="form-field"><label for="adjust-employee-tax">근로소득세 수동값</label><input id="adjust-employee-tax" name="employeeIncomeTax" type="number" min="0" step="1" value="${optionalValue("employeeIncomeTax")}" placeholder="자동" /></div>
      <div class="form-field"><label for="adjust-employee-local">근로소득 지방세 수동값</label><input id="adjust-employee-local" name="employeeLocalTax" type="number" min="0" step="1" value="${optionalValue("employeeLocalTax")}" placeholder="자동" /></div>
      <div class="form-field"><label for="adjust-pension">국민연금 수동값</label><input id="adjust-pension" name="nationalPension" type="number" min="0" step="1" value="${optionalValue("nationalPension")}" placeholder="자동" /></div>
      <div class="form-field"><label for="adjust-health-care">건강보험+장기요양 수동값</label><input id="adjust-health-care" name="healthAndLongTermCare" type="number" min="0" step="1" value="${combinedHealthValue}" placeholder="자동" /><span class="form-help">공단 고지서의 두 근로자 부담액을 합쳐 입력합니다.</span></div>
      <div class="form-field"><label for="adjust-employment">고용보험 수동값</label><input id="adjust-employment" name="employmentInsurance" type="number" min="0" step="1" value="${optionalValue("employmentInsurance")}" placeholder="자동" /></div>
      <div class="form-field"><label for="adjust-business-tax">사업소득세 수동값</label><input id="adjust-business-tax" name="businessIncomeTax" type="number" min="0" step="1" value="${optionalValue("businessIncomeTax")}" placeholder="자동" /></div>
      <div class="form-field"><label for="adjust-business-local">사업소득 지방세 수동값</label><input id="adjust-business-local" name="businessLocalTax" type="number" min="0" step="1" value="${optionalValue("businessLocalTax")}" placeholder="자동" /></div>
      <div class="form-field"><label for="adjust-other-tax">기타소득세 수동값</label><input id="adjust-other-tax" name="otherIncomeTax" type="number" min="0" step="1" value="${optionalValue("otherIncomeTax")}" placeholder="자동" /></div>
      <div class="form-field"><label for="adjust-other-local">기타소득 지방세 수동값</label><input id="adjust-other-local" name="otherLocalTax" type="number" min="0" step="1" value="${optionalValue("otherLocalTax")}" placeholder="자동" /></div>
      <div class="form-field full"><label for="adjust-custom">기타 공제</label><input id="adjust-custom" name="custom" type="number" min="0" step="1" value="${optionalValue("custom")}" placeholder="0" /></div>
    </form>
  `, "저장", async () => {
    const form = document.querySelector("#payroll-adjustment-form");
    if (!form.reportValidity()) return false;
    const data = Object.fromEntries(new FormData(form));
    const automaticFields = [
      "employeeIncomeTax", "employeeLocalTax", "nationalPension", "healthAndLongTermCare",
      "employmentInsurance", "businessIncomeTax", "businessLocalTax",
      "otherIncomeTax", "otherLocalTax", "custom"
    ];
    const override = {
      ...current,
      id: `${state.month}_${teacher.id}`,
      month: state.month,
      teacherId: teacher.id,
      employeeNonTaxableAmount: Number(data.employeeNonTaxableAmount || 0),
      employeeStudentLoanSupportAmount: Number(data.employeeStudentLoanSupportAmount || 0)
    };
    automaticFields.forEach((field) => {
      override[field] = data[field] === "" ? null : Number(data[field]);
    });
    override.healthInsurance = null;
    override.longTermCare = null;
    state.data.overrides[key] = override;
    if (state.store) await state.store.saveDocument("payrollOverrides", override.id, override);
    showToast("과세 기준과 공제 조정을 저장했습니다.");
    renderDashboard();
  });
}

function openTaxPolicyModal() {
  const current = taxPolicyForMonth(state.month);
  openModal("새 세금 기준 등록", `
    <div class="notice warning"><i data-lucide="history"></i><span>등록한 버전은 과거 명세서 재현을 위해 수정하거나 삭제하지 않습니다. 공식 자료를 확인한 뒤 새 버전과 시행일을 입력하세요.</span></div>
    <form id="tax-policy-form" class="form-grid">
      <div class="form-field"><label for="tax-version">버전 ID</label><input id="tax-version" name="version" pattern="[A-Za-z0-9._-]+" placeholder="예: NTS-2027-01-01" required /></div>
      <div class="form-field"><label for="tax-name">기준명</label><input id="tax-name" name="name" value="국세청 원천징수 기준" required /></div>
      <div class="form-field"><label for="tax-effective">시행일</label><input id="tax-effective" name="effectiveFrom" type="date" required /></div>
      <div class="form-field"><label for="tax-table-revision">간이세액표 개정일</label><input id="tax-table-revision" name="tableRevision" type="date" value="${e(current.employment.tableRevision)}" required /></div>
      <div class="form-field full"><label for="tax-source">공식 근거 URL</label><input id="tax-source" name="sourceUrl" type="url" value="${e(current.sources?.[0]?.url || "")}" required /><span class="form-help">국세청·홈택스·국가법령정보센터 등 go.kr 공식 주소만 등록할 수 있습니다.</span></div>
      <div class="form-field"><label for="business-rate">사업소득 소득세율 (%)</label><input id="business-rate" name="businessIncomeTaxRate" type="number" min="0" max="100" step="0.001" value="${e(Number(current.business.incomeTaxRate) * 100)}" required /></div>
      <div class="form-field"><label for="local-rate">지방소득세 비율 (%)</label><input id="local-rate" name="localIncomeTaxRatio" type="number" min="0" max="100" step="0.001" value="${e(Number(current.business.localIncomeTaxRateOfIncomeTax) * 100)}" required /><span class="form-help">소득세액에 곱하는 비율</span></div>
      <div class="form-field"><label for="other-expense">일시적 강의 필요경비율 (%)</label><input id="other-expense" name="otherExpenseRate" type="number" min="0" max="100" step="0.001" value="${e(Number(current.other.categories.temporaryLecture.expenseRate) * 100)}" required /></div>
      <div class="form-field"><label for="other-rate">기타소득 소득세율 (%)</label><input id="other-rate" name="otherIncomeTaxRate" type="number" min="0" max="100" step="0.001" value="${e(Number(current.other.categories.temporaryLecture.incomeTaxRate) * 100)}" required /></div>
      <div class="form-field"><label for="other-minimum">기타소득 과세최저한</label><input id="other-minimum" name="otherMinimumTaxableIncome" type="number" min="0" step="1" value="${e(current.other.categories.temporaryLecture.minimumTaxableIncomeAmount)}" required /><span class="form-help">필요경비 차감 후 건별 소득금액</span></div>
      <div class="form-field"><label for="child-one">자녀 1명 공제액</label><input id="child-one" name="childCreditOne" type="number" min="0" step="1" value="${e(current.employment.childCredits.one)}" required /></div>
      <div class="form-field"><label for="child-two">자녀 2명 공제액</label><input id="child-two" name="childCreditTwo" type="number" min="0" step="1" value="${e(current.employment.childCredits.two)}" required /></div>
      <div class="form-field"><label for="child-more">2명 초과 1명당 공제액</label><input id="child-more" name="childCreditAdditional" type="number" min="0" step="1" value="${e(current.employment.childCredits.additional)}" required /></div>
      <div class="form-field full"><label for="tax-table-file">근로소득 간이세액표 CSV</label><input id="tax-table-file" name="tableFile" type="file" accept=".csv,text/csv" /><span class="form-help">비워 두면 현재 표를 복사합니다. 상단의 CSV를 내려받아 새 공식 표 값으로 수정한 뒤 업로드할 수 있습니다.</span></div>
      <div class="form-field full"><label for="high-income-rules">월 1천만원 초과 산식 JSON</label><textarea id="high-income-rules" name="highIncomeRules" spellcheck="false" required>${e(JSON.stringify(current.employment.highIncomeBrackets, null, 2))}</textarea><span class="form-help">소득세법 시행령 별표 2의 고액 급여 구간, 가산액, 초과금액 비율과 세율입니다.</span></div>
    </form>
  `, "등록", async () => {
    const form = document.querySelector("#tax-policy-form");
    if (!form.reportValidity()) return false;
    const data = Object.fromEntries(new FormData(form));
    if (state.data.taxPolicies.some((policy) => policy.version === data.version)) {
      throw new Error("같은 버전 ID가 이미 있습니다.");
    }
    if (!isOfficialGovernmentUrl(data.sourceUrl)) {
      throw new Error("공식 go.kr 자료 주소를 입력해 주세요.");
    }

    const highIncomeBrackets = JSON.parse(data.highIncomeRules);
    validateHighIncomeBrackets(highIncomeBrackets);
    let table = {
      tableRows: structuredClone(current.employment.tableRows),
      taxAtTenMillion: structuredClone(current.employment.taxAtTenMillion)
    };
    const tableFile = document.querySelector("#tax-table-file").files?.[0];
    if (tableFile) table = parseEmploymentTaxTableRows(csvRowsToObjects(parseCsv(await tableFile.text())));

    const localRatio = Number(data.localIncomeTaxRatio) / 100;
    const policy = {
      ...structuredClone(current),
      id: data.version,
      version: data.version,
      name: data.name,
      effectiveFrom: data.effectiveFrom,
      effectiveTo: null,
      verifiedAt: new Date().toISOString().slice(0, 10),
      status: "published",
      builtIn: false,
      employment: {
        ...structuredClone(current.employment),
        ...table,
        tableRevision: data.tableRevision,
        childCredits: {
          one: Number(data.childCreditOne),
          two: Number(data.childCreditTwo),
          additional: Number(data.childCreditAdditional)
        },
        localIncomeTaxRateOfIncomeTax: localRatio,
        highIncomeBrackets
      },
      business: {
        ...structuredClone(current.business),
        incomeTaxRate: Number(data.businessIncomeTaxRate) / 100,
        localIncomeTaxRateOfIncomeTax: localRatio
      },
      other: {
        ...structuredClone(current.other),
        categories: {
          ...structuredClone(current.other.categories),
          temporaryLecture: {
            ...structuredClone(current.other.categories.temporaryLecture),
            expenseRate: Number(data.otherExpenseRate) / 100,
            incomeTaxRate: Number(data.otherIncomeTaxRate) / 100,
            localIncomeTaxRateOfIncomeTax: localRatio,
            minimumTaxableIncomeAmount: Number(data.otherMinimumTaxableIncome)
          }
        }
      },
      sources: [{ title: "등록 기준 공식 자료", url: data.sourceUrl }]
    };
    state.data.taxPolicies.push(policy);
    if (state.store) await state.store.saveDocument("taxPolicies", policy.id, policy);
    showToast("새 세금 기준을 등록했습니다.");
    renderSettings();
  });
}

function openInsurancePolicyModal() {
  const current = insurancePolicyForMonth(state.month);
  const sourceUrl = (kind) => current.sources?.find((source) => source.kind === kind)?.url || "";
  openModal("새 사회보험 기준 등록", `
    <div class="notice warning"><i data-lucide="history"></i><span>기존 기준은 과거 명세서 재현을 위해 수정하지 않습니다. 공단의 공식 요율과 시행일을 확인한 뒤 새 버전을 등록하세요.</span></div>
    <form id="insurance-policy-form" class="form-grid">
      <div class="form-field"><label for="insurance-version">버전 ID</label><input id="insurance-version" name="version" pattern="[A-Za-z0-9._-]+" placeholder="예: INSURANCE-2027-01" required /></div>
      <div class="form-field"><label for="insurance-name">기준명</label><input id="insurance-name" name="name" value="${e(current.name)}" required /></div>
      <div class="form-field"><label for="insurance-effective">시행일</label><input id="insurance-effective" name="effectiveFrom" type="date" required /></div>
      <div class="form-field"><label for="pension-rate">국민연금 근로자 부담률 (%)</label><input id="pension-rate" name="pensionRate" type="number" min="0" max="100" step="0.001" value="${e(policyPercentInput(current.employee.nationalPension.rate))}" required /></div>
      <div class="form-field"><label for="pension-minimum">국민연금 기준소득월액 하한</label><input id="pension-minimum" name="pensionMinimumBase" type="number" min="0" step="1000" value="${e(current.employee.nationalPension.minimumBase || 0)}" required /></div>
      <div class="form-field"><label for="pension-maximum">국민연금 기준소득월액 상한</label><input id="pension-maximum" name="pensionMaximumBase" type="number" min="0" step="1000" value="${e(current.employee.nationalPension.maximumBase || 0)}" required /></div>
      <div class="form-field"><label for="health-rate">건강보험 근로자 부담률 (%)</label><input id="health-rate" name="healthRate" type="number" min="0" max="100" step="0.001" value="${e(policyPercentInput(current.employee.healthInsurance.rate))}" required /></div>
      <div class="form-field"><label for="health-minimum">건강보험 근로자 부담 하한액</label><input id="health-minimum" name="healthMinimumAmount" type="number" min="0" step="1" value="${e(current.employee.healthInsurance.minimumAmount || 0)}" required /></div>
      <div class="form-field"><label for="health-maximum">건강보험 근로자 부담 상한액</label><input id="health-maximum" name="healthMaximumAmount" type="number" min="0" step="1" value="${e(current.employee.healthInsurance.maximumAmount || 0)}" required /></div>
      <div class="form-field"><label for="long-term-rate">장기요양 비율 (%)</label><input id="long-term-rate" name="longTermCareRate" type="number" min="0" max="100" step="0.001" value="${e(policyPercentInput(current.employee.longTermCareRate))}" required /><span class="form-help">건강보험료에 곱하는 비율</span></div>
      <div class="form-field"><label for="employment-rate">고용보험 근로자 부담률 (%)</label><input id="employment-rate" name="employmentRate" type="number" min="0" max="100" step="0.001" value="${e(policyPercentInput(current.employee.employmentInsurance.rate))}" required /></div>
      <div class="form-field full"><label for="pension-source">국민연금 공식 근거 URL</label><input id="pension-source" name="pensionSourceUrl" type="url" value="${e(sourceUrl("nationalPension"))}" required /></div>
      <div class="form-field full"><label for="pension-bounds-source">국민연금 상·하한 공식 근거 URL</label><input id="pension-bounds-source" name="pensionBoundsSourceUrl" type="url" value="${e(sourceUrl("nationalPensionBounds"))}" required /></div>
      <div class="form-field full"><label for="health-source">건강보험 공식 근거 URL</label><input id="health-source" name="healthSourceUrl" type="url" value="${e(sourceUrl("healthInsurance"))}" required /></div>
      <div class="form-field full"><label for="health-bounds-source">건강보험 상·하한 공식 근거 URL</label><input id="health-bounds-source" name="healthBoundsSourceUrl" type="url" value="${e(sourceUrl("healthInsuranceBounds"))}" required /></div>
      <div class="form-field full"><label for="long-term-source">장기요양 공식 근거 URL</label><input id="long-term-source" name="longTermCareSourceUrl" type="url" value="${e(sourceUrl("longTermCare"))}" required /></div>
      <div class="form-field full"><label for="employment-source">고용보험 공식 근거 URL</label><input id="employment-source" name="employmentSourceUrl" type="url" value="${e(sourceUrl("employmentInsurance"))}" required /><span class="form-help">국민연금공단·건강보험공단·고용노동부·보건복지부·국가법령정보센터 주소만 허용합니다.</span></div>
    </form>
  `, "등록", async () => {
    const form = document.querySelector("#insurance-policy-form");
    if (!form.reportValidity()) return false;
    const data = Object.fromEntries(new FormData(form));
    if (state.data.insurancePolicies.some((policy) => policy.version === data.version)) {
      throw new Error("같은 사회보험 버전 ID가 이미 있습니다.");
    }
    const sourceUrls = [
      data.pensionSourceUrl,
      data.pensionBoundsSourceUrl,
      data.healthSourceUrl,
      data.healthBoundsSourceUrl,
      data.longTermCareSourceUrl,
      data.employmentSourceUrl
    ];
    if (sourceUrls.some((url) => !isOfficialPublicSourceUrl(url))) {
      throw new Error("공단·정부·국가법령정보센터의 공식 자료 주소를 입력해 주세요.");
    }
    const pensionMinimumBase = Number(data.pensionMinimumBase);
    const pensionMaximumBase = Number(data.pensionMaximumBase);
    const healthMinimumAmount = Number(data.healthMinimumAmount);
    const healthMaximumAmount = Number(data.healthMaximumAmount);
    if (pensionMinimumBase > pensionMaximumBase || healthMinimumAmount > healthMaximumAmount) {
      throw new Error("사회보험 상한액은 하한액보다 크거나 같아야 합니다.");
    }
    const policy = {
      id: data.version,
      version: data.version,
      name: data.name,
      effectiveFrom: data.effectiveFrom,
      effectiveTo: null,
      verifiedAt: new Date().toISOString().slice(0, 10),
      status: "published",
      builtIn: false,
      employee: {
        nationalPension: {
          rate: Number(data.pensionRate) / 100,
          minimumBase: pensionMinimumBase,
          maximumBase: pensionMaximumBase
        },
        healthInsurance: {
          rate: Number(data.healthRate) / 100,
          minimumBase: 0,
          maximumBase: Number.MAX_SAFE_INTEGER,
          minimumAmount: healthMinimumAmount,
          maximumAmount: healthMaximumAmount
        },
        longTermCareRate: Number(data.longTermCareRate) / 100,
        employmentInsurance: {
          rate: Number(data.employmentRate) / 100,
          minimumBase: 0,
          maximumBase: Number.MAX_SAFE_INTEGER
        }
      },
      sources: [
        { kind: "nationalPension", title: "국민연금 보험료율", url: data.pensionSourceUrl },
        { kind: "nationalPensionBounds", title: "국민연금 기준소득월액 상·하한", url: data.pensionBoundsSourceUrl },
        { kind: "healthInsurance", title: "건강보험 보험료율", url: data.healthSourceUrl },
        { kind: "healthInsuranceBounds", title: "건강보험료 상·하한", url: data.healthBoundsSourceUrl },
        { kind: "longTermCare", title: "장기요양보험료율", url: data.longTermCareSourceUrl },
        { kind: "employmentInsurance", title: "고용보험 보험료율", url: data.employmentSourceUrl }
      ]
    };
    state.data.insurancePolicies.push(policy);
    if (state.store) await state.store.saveDocument("insurancePolicies", policy.id, policy);
    showToast("새 사회보험 기준을 등록했습니다.");
    renderSettings();
  });
}

function downloadTaxTableTemplate() {
  const policy = taxPolicyForMonth(state.month);
  const headers = ["minMonthlyPay", "maxMonthlyPay", ...Array.from({ length: 11 }, (_, index) => `dependent${index + 1}`)];
  const rows = [headers, ...policy.employment.tableRows.map(([minimum, maximum, taxes]) => [minimum, maximum, ...taxes])];
  rows.push([10000000, 10000000, ...policy.employment.taxAtTenMillion]);
  downloadCsv(`employment-tax-table-${policy.employment.tableRevision}.csv`, rows);
  showToast("현재 근로소득 간이세액표를 저장했습니다.");
}

function validateHighIncomeBrackets(brackets) {
  if (!Array.isArray(brackets) || !brackets.length || brackets.at(-1).max !== null) {
    throw new Error("고액 급여 산식의 마지막 구간은 max가 null이어야 합니다.");
  }
  const numericKeys = ["excessFrom", "excessFactor", "rate", "baseAddition"];
  if (brackets.some((bracket) => numericKeys.some((key) => !Number.isFinite(Number(bracket[key]))))) {
    throw new Error("고액 급여 산식 JSON의 숫자를 확인해 주세요.");
  }
}

function openPublishModal() {
  const currentRun = runForMonth(state.month);
  if (currentRun.status === "published") return;
  const revision = nextPayrollRevision(currentRun);
  const isReissue = currentRun.status === "cancelled";
  openModal(isReissue ? "수정 급여명세서 재발행" : "급여 확정 및 명세서 공개", `<div class="notice warning"><i data-lucide="lock"></i><span>${formatMonth(state.month)} 급여를 ${revision}차 확정본으로 발행합니다. ${isReissue ? "취소된 이전 확정본은 이력에 그대로 보존됩니다." : "확정 후 수정하려면 취소 사유를 남기고 새 차수로 재발행해야 합니다."}</span></div><label class="checkbox-row"><input id="publish-confirm" type="checkbox" /> 계산 결과와 공제액, 발행 차수를 모두 검토했습니다.</label>`, isReissue ? "재발행" : "확정", async () => {
    if (!document.querySelector("#publish-confirm").checked) { showToast("검토 확인을 선택해 주세요."); return false; }
    const missingInsuredSalary = activeTeachers().filter((teacher) => {
      const settings = teacherPaySettings(teacher);
      return settings.insuranceEnrolled && monthlyPayAmounts(teacher, state.month).employeeGrossPay <= 0;
    });
    if (missingInsuredSalary.length) throw new Error(`근로소득 월급이 입력되지 않은 보험 가입 선생님이 있습니다: ${missingInsuredSalary.map((teacher) => teacher.name).join(", ")}`);
    const payrolls = payrollsForMonth(state.month);
    if (!payrolls.length) throw new Error("이번 달 지급액이 입력된 선생님이 없습니다.");
    const unconfirmedItems = payrolls.flatMap(({ teacher, payroll }) => payroll.unconfirmedEarningLines.map((line) => `${teacher.name} ${line.subjectName}`));
    if (unconfirmedItems.length) throw new Error(`과세 처리가 확인되지 않은 지급 항목이 있습니다: ${unconfirmedItems.join(", ")}`);
    const missingAccounts = payrolls.filter(({ teacher }) => !teacher.authUid);
    if (state.store && missingAccounts.length) throw new Error(`로그인 UID가 연결되지 않은 선생님이 있습니다: ${missingAccounts.map(({ teacher }) => teacher.name).join(", ")}`);
    const publishedAt = new Date().toISOString();
    const run = { ...currentRun, status: "published", revision, releaseId: `${state.month}_v${revision}`, publishedAt, cancellationId: null, cancellationReason: null, cancelledAt: null };
    const payslips = payrolls.map(({ teacher, payroll }) => ({
      id: payslipId(state.month, teacher.id),
      versionId: payslipVersionId(state.month, teacher.id, revision),
      data: {
        month: state.month,
        teacherId: teacher.id,
        teacherUid: teacher.authUid,
        teacherName: teacher.name,
        status: "published",
        revision,
        releaseId: run.releaseId,
        policyVersion: payroll.policyVersion,
        taxPolicyVersion: payroll.taxPolicyVersion,
        insurancePolicyVersion: payroll.insurancePolicyVersion,
        calculation: payroll,
        publishedAt
      }
    }));
    if (state.store) {
      await state.store.publishPayrollRun(
        run,
        payslips,
        {
          id: crypto.randomUUID(),
          data: { action: isReissue ? "PAYROLL_REPUBLISHED" : "PAYROLL_PUBLISHED", month: state.month, revision, actorUid: state.user.uid, createdAt: run.publishedAt }
        }
      );
    }
    payslips.forEach((payslip) => {
      const currentIndex = state.data.payslips.findIndex((item) => item.id === payslip.id);
      const current = { id: payslip.id, ...structuredClone(payslip.data) };
      if (currentIndex >= 0) state.data.payslips[currentIndex] = current;
      else state.data.payslips.push(current);
      state.data.payslipVersions.push({ id: payslip.versionId, ...structuredClone(payslip.data) });
    });
    const runIndex = state.data.payrollRuns.findIndex((item) => item.month === state.month);
    if (runIndex >= 0) state.data.payrollRuns[runIndex] = run;
    else state.data.payrollRuns.push(run);
    showToast(isReissue ? `${revision}차 수정 명세서를 재발행했습니다.` : "급여를 확정하고 명세서를 공개했습니다.");
    renderDashboard();
  });
}

function openCancelPayrollModal() {
  const currentRun = runForMonth(state.month);
  if (currentRun.status !== "published") return;
  const revision = artifactRevision(currentRun);
  openModal("급여 확정 취소", `
    <div class="notice warning"><i data-lucide="shield-alert"></i><span>${formatMonth(state.month)} ${revision}차 확정본을 취소합니다. 기존 명세서는 이력으로 보존되고 선생님 화면에서는 즉시 내려갑니다.</span></div>
    <form id="cancel-payroll-form" class="form-grid">
      <div class="form-field full"><label for="cancel-reason">취소 사유</label><textarea id="cancel-reason" name="reason" minlength="5" maxlength="500" placeholder="예: 월 지급액 수정 필요" required></textarea><span class="form-help">개인정보를 적지 말고 변경이 필요한 이유만 기록하세요.</span></div>
      <label class="checkbox-row full"><input name="confirmed" type="checkbox" /> 선생님에게 공개된 명세서가 취소된다는 점을 확인했습니다.</label>
    </form>
  `, "확정 취소", async () => {
    const form = document.querySelector("#cancel-payroll-form");
    if (!form.reportValidity()) return false;
    if (!form.elements.confirmed.checked) { showToast("취소 확인을 선택해 주세요."); return false; }
    const reason = new FormData(form).get("reason").trim();
    const cancelledAt = new Date().toISOString();
    const cancellationId = `${state.month}_v${revision}`;
    let currentPayslips = state.data.payslips.filter((item) => item.month === state.month && item.status === "published");
    if (!currentPayslips.length) {
      currentPayslips = payrollsForMonth(state.month).map(({ teacher, payroll }) => ({
        id: payslipId(state.month, teacher.id), month: state.month, teacherId: teacher.id,
        teacherUid: teacher.authUid, teacherName: teacher.name, status: "published",
        revision, releaseId: currentRun.releaseId || `${state.month}_v${revision}`,
        calculation: payroll, publishedAt: currentRun.publishedAt
      }));
    }
    const archives = currentPayslips
      .map((item) => {
        const { id, ...data } = item;
        return { id: payslipVersionId(state.month, item.teacherId, revision), data: { ...data, status: "published", revision } };
      })
      .filter((archive) => !state.data.payslipVersions.some((item) => item.id === archive.id));
    const run = { ...currentRun, status: "cancelled", revision, cancellationId, cancellationReason: reason, cancelledAt };
    const cancellation = {
      id: cancellationId,
      data: { month: state.month, revision, reason, releaseId: currentRun.releaseId || `${state.month}_v${revision}`, payslipIds: currentPayslips.map((item) => item.id), actorUid: state.user.uid }
    };
    if (state.store) {
      await state.store.cancelPayrollRun(
        run,
        currentPayslips.map((item) => ({ id: item.id })),
        archives,
        cancellation,
        { id: crypto.randomUUID(), data: { action: "PAYROLL_CANCELLED", month: state.month, revision, reason, actorUid: state.user.uid } }
      );
    }
    currentPayslips.forEach((item) => Object.assign(item, { status: "cancelled", cancellationId, cancellationReason: reason, cancelledAt }));
    archives.forEach((archive) => state.data.payslipVersions.push({ id: archive.id, ...archive.data }));
    state.data.payrollCancellations.push({ id: cancellation.id, ...cancellation.data, createdAt: cancelledAt });
    const runIndex = state.data.payrollRuns.findIndex((item) => item.month === state.month);
    if (runIndex >= 0) state.data.payrollRuns[runIndex] = run;
    showToast("확정본을 취소했습니다. 수정 후 새 차수로 재발행하세요.");
    renderDashboard();
  });
}

function openModal(title, body, submitLabel, onSubmit) {
  elements.modalRoot.innerHTML = `<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><header class="modal-header"><h2 id="modal-title">${e(title)}</h2><button class="icon-button" type="button" aria-label="닫기" data-close-modal><i data-lucide="x"></i></button></header><div class="modal-body">${body}</div><footer class="modal-footer"><button class="button button-secondary" type="button" data-close-modal>${submitLabel ? "취소" : "닫기"}</button>${submitLabel ? `<button class="button button-primary" type="button" data-submit-modal>${e(submitLabel)}</button>` : ""}</footer></section></div>`;
  elements.modalRoot.querySelectorAll("[data-close-modal]").forEach((button) => button.addEventListener("click", closeModal));
  elements.modalRoot.querySelector(".modal-backdrop").addEventListener("click", (event) => { if (event.target.classList.contains("modal-backdrop")) closeModal(); });
  const submit = elements.modalRoot.querySelector("[data-submit-modal]");
  if (submit) submit.addEventListener("click", async () => {
    submit.disabled = true;
    try {
      const result = await onSubmit();
      if (result !== false) closeModal();
    } catch (error) {
      showToast(error.message || "저장하지 못했습니다.");
    } finally {
      submit.disabled = false;
    }
  });
  refreshIcons();
  elements.modalRoot.querySelector("input, select, button")?.focus();
}

function closeModal() { elements.modalRoot.innerHTML = ""; }

function exportLedger() {
  const rows = [["급여월", "성명", "연락처", "생년월일·성별번호", "신고액", "수업시간", "강사료", "강사료 세액공제", "교통 횟수", "교통비", "주차료", "기타", "추가 지급 원천징수", "세액공제 합계", "소득세", "지방소득세", "건강+요양", "국민연금", "고용보험", "보험료 합계", "국민연금 신고 기준액", "건강보험 신고 기준액", "고용보험 신고 기준액", "기타 공제", "공제액 합계", "지급액"]];
  payrollsForMonth(state.month).forEach(({ teacher, payroll }) => {
    const report = accountingReportFor(payroll);
    const bases = insuranceBasesFor(payroll);
    rows.push([
      state.month, teacher.name, teacher.phone || "", formatTeacherIdentity(teacher),
      report.reportedGross, report.classHours, report.lectureFeeGross, report.lectureWithholding,
      report.transportTrips, report.transportAmount, report.parkingAmount, report.otherPaymentAmount,
      report.additionalPaymentWithholding, report.lectureWithholding + report.additionalPaymentWithholding,
      report.employeeIncomeTax, report.employeeLocalTax, report.healthAndLongTermCare,
      report.nationalPension, report.employmentInsurance, report.insuranceTotal,
      bases.nationalPension, bases.healthInsurance,
      bases.employmentInsurance, payroll.deductions.custom,
      payroll.totalDeductions, payroll.net
    ]);
  });
  downloadCsv(`academy-payroll-${state.month}.csv`, rows);
  showToast("급여내역서 CSV를 저장했습니다.");
}

async function downloadCurrentPayslip(event) {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    const teacher = teacherById(state.user.role === "teacher" ? state.user.teacherId : state.selectedTeacherId);
    const file = await createCurrentPayslipPdf(teacher);
    downloadFile(file);
    showToast("급여명세서 PDF를 저장했습니다.");
  } catch (error) {
    showToast(error.message || "PDF를 만들지 못했습니다.");
  } finally {
    button.disabled = false;
  }
}

function createCurrentPayslipPdf(teacher) {
  if (!teacher) throw new Error("선생님 정보를 찾지 못했습니다.");
  return createPayslipPdfFile(elements.content.querySelector(".payslip-sheet"), {
    academyName: appConfig.academyName,
    teacherName: teacher.name,
    month: state.selectedPayslipMonth
  });
}

function openPayslipEmailModal(teacher, payroll, run) {
  if (!teacher || !payroll || run.status !== "published") {
    showToast("확정된 급여명세서만 이메일로 발송할 수 있습니다.");
    return;
  }
  const revision = artifactRevision(currentPayslip(teacher.id, state.selectedPayslipMonth) || run);
  const revisionLabel = revision > 1 ? ` 수정 ${revision}차` : "";
  const subject = `[${appConfig.academyName}] ${formatMonth(state.selectedPayslipMonth)} 급여명세서${revisionLabel}`;
  const body = `안녕하세요, ${teacher.name} 선생님.\n\n${appConfig.academyName} ${formatMonth(state.selectedPayslipMonth)} 급여명세서${revisionLabel}를 첨부합니다.\n등록된 Google 계정으로 로그인하면 포털에서도 지난 명세서를 확인할 수 있습니다.\n${portalUrl()}\n\n감사합니다.`;
  const filename = payslipFilename(appConfig.academyName, teacher.name, state.selectedPayslipMonth);
  openModal("급여명세서 이메일 발송", `
    <div class="notice compact"><i data-lucide="shield-check"></i><span>발송할 때 관리자 Google 계정에 Gmail 전송 권한만 요청합니다. 권한 토큰과 첨부 파일은 저장하지 않습니다.</span></div>
    <div class="delivery-summary">
      <div><span>수신자</span><strong>${e(teacher.name)}</strong><small>${e(teacher.email)}</small></div>
      <div><span>첨부 파일</span><strong>${e(filename)}</strong><small>${formatWon(payroll.net)}</small></div>
    </div>
    <form id="payslip-email-form" class="form-grid">
      <div class="form-field full"><label for="payslip-email-to">받는 주소</label><input id="payslip-email-to" name="to" type="email" value="${e(teacher.email)}" readonly required /></div>
      <div class="form-field full"><label for="payslip-email-subject">제목</label><input id="payslip-email-subject" name="subject" value="${e(subject)}" required /></div>
      <div class="form-field full"><label for="payslip-email-body">본문</label><textarea id="payslip-email-body" name="body" rows="7" required>${e(body)}</textarea></div>
      <label class="checkbox-row full"><input name="confirmed" type="checkbox" /> 수신자, 금액, 공제 내역과 첨부 파일을 확인했습니다.</label>
    </form>
    <div class="email-fallback"><span>Gmail API를 사용하지 않을 때</span><button class="button button-secondary" type="button" data-download-compose><i data-lucide="external-link"></i>PDF 저장 후 메일 앱 열기</button></div>
  `, "Gmail로 발송", async () => {
    const form = document.querySelector("#payslip-email-form");
    const data = Object.fromEntries(new FormData(form));
    if (!form.elements.confirmed.checked) {
      showToast("발송 전 확인 항목을 선택해 주세요.");
      return false;
    }
    if (!state.store) throw new Error("데모에서는 실제 메일을 발송하지 않습니다. Firebase 연결 후 사용해 주세요.");

    await state.store.authorizeGmailSend();
    const file = await createCurrentPayslipPdf(teacher);
    const raw = buildGmailMessage({
      to: data.to,
      subject: data.subject,
      body: data.body,
      attachmentName: file.name,
      attachmentBytes: await fileToBytes(file)
    });
    const result = await state.store.sendGmailMessage(raw);
    const deliveryData = {
      payslipId: payslipId(state.selectedPayslipMonth, teacher.id),
      teacherId: teacher.id,
      month: state.selectedPayslipMonth,
      revision,
      recipientEmail: data.to,
      channel: "gmail_attachment",
      gmailMessageId: result.id
    };
    try {
      const saved = await state.store.recordPayslipDelivery(deliveryData);
      state.data.payslipDeliveries.push(saved);
      showToast(`${teacher.name} 선생님에게 급여명세서를 발송했습니다.`);
    } catch (error) {
      console.error("급여명세서 발송 이력 저장 실패", error);
      showToast("메일은 발송됐지만 발송 이력을 저장하지 못했습니다.");
    }
    renderPayslips();
  });

  elements.modalRoot.querySelector("[data-download-compose]").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    const form = document.querySelector("#payslip-email-form");
    const data = Object.fromEntries(new FormData(form));
    button.disabled = true;
    try {
      downloadFile(await createCurrentPayslipPdf(teacher));
      window.location.href = `mailto:${encodeURIComponent(data.to)}?subject=${encodeURIComponent(data.subject)}&body=${encodeURIComponent(data.body)}`;
      showToast("PDF를 저장했습니다. 열린 메일에 파일을 첨부해 주세요.");
    } catch (error) {
      showToast(error.message || "PDF를 만들지 못했습니다.");
    } finally {
      button.disabled = false;
    }
  });
}

async function copyPortalLink() {
  await copyText(portalUrl());
  showToast("선생님 포털 링크를 복사했습니다.");
}

async function copyPayslipNotice() {
  const message = `안녕하세요. ${appConfig.academyName} ${formatMonth(state.month)} 급여명세서가 발행되었습니다.\n아래 링크에서 등록된 Google 계정으로 로그인해 확인해 주세요.\n${portalUrl()}`;
  await copyText(message);
  showToast("급여명세서 안내문과 로그인 링크를 복사했습니다.");
}

async function copyText(value) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

function portalUrl() {
  return appConfig.portalUrl || new URL(".", window.location.href).href;
}

async function recordPayslipViewed(teacherId, month) {
  if (receiptFor(teacherId, month)) return;
  const current = currentPayslip(teacherId, month);
  const revision = artifactRevision(current || runForMonth(month));
  const currentPayslipId = payslipId(month, teacherId);
  const receipt = { id: `${currentPayslipId}_v${revision}_${state.user.uid}`, payslipId: currentPayslipId, teacherId, teacherUid: state.user.uid, month, revision, viewedAt: new Date().toISOString() };
  state.data.payslipReceipts.push(receipt);
  if (state.store) {
    try {
      await state.store.recordPayslipView(currentPayslipId, teacherId, month, revision);
    } catch (error) {
      state.data.payslipReceipts = state.data.payslipReceipts.filter((item) => item.id !== receipt.id);
      console.error("급여명세서 열람 기록 저장 실패", error);
    }
  }
}

function receiptFor(teacherId, month) {
  const revision = artifactRevision(currentPayslip(teacherId, month) || runForMonth(month));
  return currentArtifactForRevision(state.data.payslipReceipts, teacherId, month, revision);
}

function deliveryFor(teacherId, month) {
  const revision = artifactRevision(currentPayslip(teacherId, month) || runForMonth(month));
  return currentArtifactForRevision(state.data.payslipDeliveries, teacherId, month, revision);
}

function formatViewedAt(value) {
  const date = value?.toDate ? value.toDate() : new Date(value);
  return Number.isNaN(date.getTime()) ? "열람 시간 기록" : date.toLocaleString("ko-KR");
}

function formatDeliveryAt(value) {
  const date = value?.toDate ? value.toDate() : new Date(value);
  return Number.isNaN(date.getTime()) ? "발송 시간 기록" : date.toLocaleString("ko-KR");
}

function formatDateTime(value) {
  const date = value?.toDate ? value.toDate() : new Date(value);
  return Number.isNaN(date.getTime()) ? "시간 확인 필요" : date.toLocaleString("ko-KR");
}

function deliveryTime(value) {
  const date = value?.toDate ? value.toDate() : new Date(value);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function metric(icon, label, value, helper) { return `<div class="metric"><span class="metric-label"><i data-lucide="${icon}"></i>${e(label)}</span><strong>${e(value)}</strong><small>${e(helper)}</small></div>`; }
function progressStep(number, title, detail, active, complete) { return `<div class="progress-step ${active ? "active" : ""} ${complete ? "complete" : ""}"><strong>${e(number)}. ${e(title)}</strong><span>${e(detail)}</span></div>`; }
function personCell(teacher) { return `<div class="person-cell"><span class="avatar">${e(teacher.name.slice(0, 1))}</span><span class="person-meta"><strong>${e(teacher.name)}</strong><span>${e(teacher.email)}</span></span></div>`; }
function emptyRow(columns) { return `<tr><td colspan="${columns}"><div class="empty-state">표시할 내역이 없습니다.</div></td></tr>`; }
function statusLabel(status) { return ({ draft: "검토 중", ready: "확정 대기", published: "발행 완료", cancelled: "취소 후 수정", paid: "지급 완료" })[status] || status; }
function roleLabel(role) { return ({ admin: "관리자", teacher: "선생님" })[role] || role; }
function currentCalendarMonth() {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
}
function ratePercent(rate) { return `${((Number(rate) || 0) * 100).toLocaleString("ko-KR", { maximumFractionDigits: 3 })}%`; }
function policyPercentInput(rate) { return Number(((Number(rate) || 0) * 100).toFixed(3)); }
function taxProfileForTeacher(teacher) { return { dependentCount: 1, children8To20: 0, withholdingRatio: 1, ...(teacher.taxProfile || {}) }; }
function slug(value) { return String(value).trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9가-힣-]/g, ""); }
function deductionLabels() { return { nationalPension: "국민연금", healthInsurance: "건강보험", longTermCare: "장기요양보험", employmentInsurance: "고용보험", employeeIncomeTax: "근로소득세", employeeLocalTax: "근로소득 지방세", businessIncomeTax: "사업소득세", businessLocalTax: "사업소득 지방세", otherIncomeTax: "기타소득세", otherLocalTax: "기타소득 지방세", custom: "기타 공제" }; }
function safeHttpUrl(value) { try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) ? url.href : "#"; } catch { return "#"; } }
function isOfficialGovernmentUrl(value) { try { const host = new URL(value).hostname.toLowerCase(); return host === "go.kr" || host.endsWith(".go.kr"); } catch { return false; } }
function isOfficialPublicSourceUrl(value) {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return host === "nps.or.kr" || host.endsWith(".nps.or.kr")
      || host === "nhis.or.kr" || host.endsWith(".nhis.or.kr")
      || host === "law.go.kr" || host.endsWith(".law.go.kr")
      || host === "go.kr" || host.endsWith(".go.kr");
  } catch {
    return false;
  }
}
function setLoginStatus(message, isError = true) { elements.loginStatus.textContent = message; elements.loginStatus.style.color = isError ? "var(--danger)" : "var(--muted)"; }
function showToast(message) { const toast = document.createElement("div"); toast.className = "toast"; toast.textContent = message; elements.toastRoot.append(toast); setTimeout(() => toast.remove(), 3200); }
function refreshIcons() { if (window.lucide) window.lucide.createIcons(); else setTimeout(() => window.lucide?.createIcons(), 300); }
