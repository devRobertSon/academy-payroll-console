import { appConfig } from "./config.js";
import { helpArticles } from "./data/help-content.js";
import {
  demoAccessRequests,
  demoEntries,
  demoOverrides,
  demoPayrollRuns,
  demoRateRules,
  demoTeachers,
  demoUsers
} from "./data/demo-data.js";
import {
  createCombinedPolicy,
  ntsTaxPolicy2024,
  officialInsurancePolicies
} from "./data/nts-tax-policy.js";
import { createFirebaseStore } from "./lib/firebase-store.js";
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
  createMonthlyEarningLine,
  EMPLOYMENT_TYPE_LABELS,
  parseEmploymentTaxTableRows,
  resolveEffectivePolicy,
  summarizePayroll,
  TREATMENT_LABELS
} from "./lib/payroll.js";
import { downloadCsv, escapeHtml as e, formatHours, formatMonth, formatNumber, formatWon } from "./lib/format.js";

const state = {
  user: null,
  view: "dashboard",
  month: "2026-08",
  search: "",
  selectedTeacherId: null,
  selectedPayslipMonth: "2026-08",
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
    payslips: [],
    payslipVersions: [],
    payslipReceipts: [],
    payslipDeliveries: [],
    payrollCancellations: [],
    accessRequests: []
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
    payslips: [],
    payslipVersions: [],
    payslipReceipts: [],
    payslipDeliveries: [],
    payrollCancellations: [],
    accessRequests: structuredClone(demoAccessRequests)
  };
}

async function openWorkspace(user) {
  if (!user) return;
  state.user = user;
  state.view = user.role === "teacher" ? "payslips" : "dashboard";
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
  state.data.overrides = Object.fromEntries((loaded.payrollOverrides || []).map((item) => [`${item.month}:${item.teacherId}`, item]));
  const latestMonth = state.data.payrollRuns.map((run) => run.month).sort().at(-1);
  if (latestMonth) state.month = latestMonth;
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
  elements.topbarActions.innerHTML = actions;
}

function renderDashboard() {
  const payrolls = payrollsForMonth(state.month);
  const summary = summarizePayroll(payrolls.map((item) => item.payroll));
  const run = runForMonth(state.month);
  const cancellations = cancellationsForMonth(state.month);
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
      <div class="section-heading"><div><h2>선생님별 급여</h2><p>선생님 유형과 월 지급액을 기준으로 계산한 이번 달 초안</p></div></div>
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
  const unassigned = teachers.filter((teacher) => employmentTypeOf(teacher) === "unassigned");
  const missingInsured = teachers.filter((teacher) => employmentTypeOf(teacher) === "insured" && monthlyPayAmount(teacher, state.month) <= 0);
  setPage("월 급여 입력", formatMonth(state.month));
  elements.content.innerHTML = `
    <div class="toolbar">
      <input class="month-control" type="month" value="${e(state.month)}" aria-label="급여 월" data-control="month" />
      <span class="status-chip ${e(run.status)}">${statusLabel(run.status)}</span>
      <span class="toolbar-spacer"></span>
      <div class="search-wrap"><i data-lucide="search"></i><input class="search-control" type="search" value="${e(state.search)}" placeholder="선생님 검색" aria-label="선생님 검색" data-control="search" /></div>
    </div>
    <div class="notice ${unassigned.length || missingInsured.length ? "warning" : ""}"><i data-lucide="${unassigned.length || missingInsured.length ? "triangle-alert" : "circle-check"}"></i><span>${unassigned.length ? `유형을 선택하지 않은 선생님이 ${unassigned.length}명 있습니다. 선생님 관리에서 유형을 먼저 저장하세요.` : missingInsured.length ? `월급이 입력되지 않은 4대보험 가입자가 ${missingInsured.length}명 있습니다.` : "급여는 수업 건수가 아니라 선생님별 월 지급액으로 계산됩니다. 4대보험 가입자는 수업이 없어도 기본 월급이 자동 적용됩니다."}</span></div>
    <section class="content-section">
      <div class="section-heading"><div><h2>${formatMonth(state.month)} 지급액</h2><p>기본 월 지급액을 불러오며, 이 달에만 다른 금액을 적용할 수 있습니다.</p></div></div>
      <div class="data-surface table-scroll"><table><thead><tr><th>선생님</th><th>유형</th><th class="numeric">기본 월 지급액</th><th class="numeric">이번 달 지급액</th><th>적용 기준</th><th>입력 상태</th><th aria-label="작업"></th></tr></thead><tbody>
        ${teachers.map((teacher) => {
          const override = state.data.overrides[`${state.month}:${teacher.id}`];
          const amount = monthlyPayAmount(teacher, state.month);
          const custom = override?.grossPay != null;
          const type = employmentTypeOf(teacher);
          return `<tr><td>${personCell(teacher)}</td><td><span class="status-chip ${type === "insured" ? "published" : type === "freelancer" ? "ready" : "pending"}">${e(employmentTypeLabel(teacher))}</span></td><td class="numeric">${formatWon(teacher.baseMonthlyPay || 0)}</td><td class="numeric"><strong>${formatWon(amount)}</strong></td><td>${custom ? "이번 달 입력" : "선생님 기본값"}</td><td><span class="status-chip ${type !== "unassigned" && amount > 0 ? "paid" : "pending"}">${type === "unassigned" ? "유형 먼저 선택" : amount > 0 ? "입력 완료" : "금액 미입력"}</span></td><td><button class="icon-button" type="button" title="이번 달 지급액 수정" aria-label="${e(teacher.name)} 이번 달 지급액 수정" data-edit-monthly-pay="${e(teacher.id)}" ${locked || type === "unassigned" ? "disabled" : ""}><i data-lucide="pencil"></i></button></td></tr>`;
        }).join("") || emptyRow(7)}
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
        <table><thead><tr><th>선생님</th><th>유형</th><th class="numeric">기본 월 지급액</th><th>상태</th></tr></thead><tbody>
          ${filtered.map((teacher) => `<tr data-select-teacher="${e(teacher.id)}" tabindex="0"><td>${personCell(teacher)}</td><td>${e(employmentTypeLabel(teacher))}</td><td class="numeric">${formatWon(teacher.baseMonthlyPay || 0)}</td><td><span class="status-chip ${teacher.status === "active" ? "paid" : "cancelled"}">${teacher.status === "active" ? "활성" : "비활성"}</span></td></tr>`).join("") || emptyRow(4)}
        </tbody></table>
      </section>
      ${selected ? `<aside class="detail-panel">
        <div class="detail-panel-header detail-title-row"><div><h2>${e(selected.name)}</h2><p>${e(selected.email)}</p></div><button class="icon-button" type="button" title="선생님 정보 수정" aria-label="${e(selected.name)} 정보 수정" data-edit-teacher><i data-lucide="pencil"></i></button></div>
        <div class="detail-block"><h3>접근 연결</h3><dl class="definition-list"><div><dt>로그인 UID</dt><dd>${e(selected.authUid || "승인 대기")}</dd></div><div><dt>상태</dt><dd>${selected.status === "active" ? "활성" : "비활성"}</dd></div></dl></div>
        <div class="detail-block"><h3>급여 조건</h3><dl class="definition-list"><div><dt>선생님 유형</dt><dd>${e(employmentTypeLabel(selected))}</dd></div><div><dt>기본 월 지급액</dt><dd>${formatWon(selected.baseMonthlyPay || 0)}</dd></div><div><dt>계약 요약</dt><dd>${e(selected.contractSummary)}</dd></div><div><dt>지급 예정일</dt><dd>매월 ${e(selected.paymentDay)}일</dd></div></dl></div>
        ${employmentTypeOf(selected) === "insured" ? `<div class="detail-block"><div class="detail-title-row"><h3>근로소득 원천징수 정보</h3><button class="icon-button" type="button" title="원천징수 정보 수정" aria-label="${e(selected.name)} 원천징수 정보 수정" data-edit-tax-profile><i data-lucide="pencil"></i></button></div><dl class="definition-list"><div><dt>공제대상가족</dt><dd>${e(taxProfileForTeacher(selected).dependentCount)}명</dd></div><div><dt>8~20세 자녀</dt><dd>${e(taxProfileForTeacher(selected).children8To20)}명</dd></div><div><dt>원천징수 비율</dt><dd>${ratePercent(taxProfileForTeacher(selected).withholdingRatio)}</dd></div></dl></div>` : `<div class="detail-block"><h3>원천징수</h3><p class="form-help">프리랜서는 월 지급액에 사업소득 원천징수 기준이 자동 적용됩니다.</p></div>`}
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
    <div class="notice warning"><i data-lucide="shield-alert"></i><span>CSV 파일에는 급여 정보가 포함됩니다. 저장 후 개인 메일이나 공개 저장소에 올리지 말고 회계사와 합의한 안전한 방법으로 전달하세요.</span></div>
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
        <div class="detail-block"><div class="notice warning compact"><i data-lucide="triangle-alert"></i><span>자동 계산은 4대보험 가입자의 월 지급액을 보험 기준액으로 사용한 예상값입니다. 공단 고지액, 기준소득월액·보수월액, 입·퇴사월, 두루누리 지원, 휴직·정산 등은 급여 확정 전에 수동 공제액으로 맞추세요.</span></div></div>
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
  setPage("등록 정보", "내 계정");
  elements.content.innerHTML = teacher ? `
    <div class="split-layout"><section class="detail-panel"><div class="detail-panel-header"><h2>${e(teacher.name)}</h2><p>${e(teacher.email)}</p></div><div class="detail-block"><h3>로그인 연결</h3><dl class="definition-list"><div><dt>Google 이메일</dt><dd>${e(state.user.email)}</dd></div><div><dt>계정 상태</dt><dd>활성</dd></div></dl></div><div class="detail-block"><h3>담당 과목</h3><div class="tag-list">${teacher.subjects.map((item) => `<span class="tag">${e(item)}</span>`).join("")}</div></div></section>
    <section><div class="notice"><i data-lucide="message-square-text"></i><span>이름, 이메일, 계약 조건이 실제 정보와 다르면 학원 관리자에게 수정을 요청해 주세요.</span></div></section></div>
  ` : `<div class="empty-state">연결된 선생님 정보가 없습니다.</div>`;
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
      ${["선생님 유형은 어떻게 정해?", "이번 달 급여는 어디서 입력해?", "명세서를 이메일로 보내려면?"].map((question) => `<button type="button" data-assistant-question="${e(question)}">${e(question)}</button>`).join("")}
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
  const override = state.data.overrides[`${month}:${teacherId}`] || {};
  const earningLine = createMonthlyEarningLine(teacher, month, override);
  if (!earningLine) return null;
  return {
    teacher,
    payroll: calculatePayroll(
      [earningLine],
      policyForMonth(month),
      override,
      teacher.taxProfile
    )
  };
}

function entriesForMonth(month) { return state.data.entries.filter((entry) => entry.month === month); }
function teacherById(id) { return state.data.teachers.find((teacher) => teacher.id === id); }
function activeTeachers() { return state.data.teachers.filter((teacher) => teacher.status === "active"); }
function employmentTypeOf(teacher) { return ["insured", "freelancer"].includes(teacher?.employmentType) ? teacher.employmentType : "unassigned"; }
function employmentTypeLabel(teacher) { return EMPLOYMENT_TYPE_LABELS[employmentTypeOf(teacher)]; }
function monthlyPayAmount(teacher, month) {
  const override = state.data.overrides[`${month}:${teacher.id}`];
  return Number(override?.grossPay ?? teacher.baseMonthlyPay ?? 0);
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
  return `<table><thead><tr><th>선생님</th><th>유형</th><th class="numeric">총 지급액</th><th class="numeric">공제액</th><th class="numeric">실 지급액</th><th>발행</th><th>열람</th><th>전달</th><th aria-label="작업"></th></tr></thead><tbody>${items.map(({ teacher, payroll }) => {
    const receipt = receiptFor(teacher.id, state.month);
    const delivery = deliveryFor(teacher.id, state.month);
    const published = runForMonth(state.month).status === "published";
    return `<tr><td>${personCell(teacher)}</td><td><span class="status-chip ${employmentTypeOf(teacher) === "insured" ? "published" : "ready"}">${e(employmentTypeLabel(teacher))}</span></td><td class="numeric">${formatWon(payroll.gross)}</td><td class="numeric">${formatWon(payroll.totalDeductions)}</td><td class="numeric"><strong>${formatWon(payroll.net)}</strong></td><td><span class="status-chip ${runForMonth(state.month).status}">${statusLabel(runForMonth(state.month).status)}</span></td><td>${receipt ? `<span class="status-chip published" title="${e(formatViewedAt(receipt.viewedAt))}">열람 완료</span>` : `<span class="status-chip pending">${published ? "미열람" : "발행 전"}</span>`}</td><td>${delivery ? `<span class="status-chip published" title="${e(formatDeliveryAt(delivery.sentAt))}">메일 발송</span>` : `<span class="status-chip pending">${published ? "미발송" : "발행 전"}</span>`}</td><td><div class="row-actions">${published ? "" : `<button class="icon-button" type="button" title="과세·공제 조정" aria-label="${e(teacher.name)} 과세 및 공제 조정" data-adjust-payroll="${e(teacher.id)}"><i data-lucide="calculator"></i></button>`}<button class="icon-button" type="button" title="명세서 보기" aria-label="${e(teacher.name)} 명세서 보기" data-view-payslip="${e(teacher.id)}"><i data-lucide="file-search"></i></button></div></td></tr>`;
  }).join("") || emptyRow(9)}</tbody></table>`;
}

function ledgerTable(items, summary) {
  return `<table><thead><tr><th>선생님</th><th class="numeric">근로소득</th><th class="numeric">사업소득</th><th class="numeric">기타/미공제</th><th class="numeric">보험 공제</th><th class="numeric">세금</th><th class="numeric">실 지급액</th></tr></thead><tbody>${items.map(({ teacher, payroll }) => {
    const insurance = payroll.deductions.nationalPension + payroll.deductions.healthInsurance + payroll.deductions.longTermCare + payroll.deductions.employmentInsurance;
    const taxes = payroll.totalDeductions - insurance - payroll.deductions.custom;
    return `<tr><td>${e(teacher.name)}</td><td class="numeric">${formatNumber(payroll.grossByTreatment.employee)}</td><td class="numeric">${formatNumber(payroll.grossByTreatment.business)}</td><td class="numeric">${formatNumber(payroll.grossByTreatment.other + payroll.grossByTreatment.exempt)}</td><td class="numeric">${formatNumber(insurance)}</td><td class="numeric">${formatNumber(taxes)}</td><td class="numeric"><strong>${formatNumber(payroll.net)}</strong></td></tr>`;
  }).join("")}<tr><td><strong>합계</strong></td><td colspan="3" class="numeric"><strong>${formatNumber(summary.gross)}</strong></td><td colspan="2" class="numeric"><strong>${formatNumber(summary.deductions)}</strong></td><td class="numeric"><strong>${formatNumber(summary.net)}</strong></td></tr></tbody></table>`;
}

function payslipSheet(teacher, payroll, month, run) {
  const deductionRows = Object.entries(deductionLabels()).filter(([key]) => payroll.deductions[key] > 0);
  return `<article class="payslip-sheet">
    <header class="payslip-title"><div><h2>${formatMonth(month)} 급여명세서</h2><p>${e(appConfig.academyName)} · 지급 예정일 매월 ${e(teacher.paymentDay)}일</p></div><span class="brand-mark" aria-hidden="true">AP</span></header>
    <div class="payslip-summary"><div><span>성명</span><strong>${e(teacher.name)}</strong></div><div><span>선생님 유형</span><strong>${e(employmentTypeLabel(teacher))}</strong></div><div><span>발행 상태</span><strong>${run.status === "published" ? `${artifactRevision(run)}차 발행 완료` : "미리보기"}</strong></div></div>
    <h3>지급 내역</h3><div class="table-scroll"><table><thead><tr><th>지급 항목</th><th>소득 구분</th><th>산정 기준</th><th class="numeric">금액</th></tr></thead><tbody>${payroll.earningLines.map((line) => `<tr><td>${e(line.subjectName)}</td><td>${e(TREATMENT_LABELS[line.treatment])}</td><td>${line.kind === "monthly" ? "선생님별 월 지급액" : `${e(line.hours)}시간 × ${formatNumber(line.hourlyRate)}원`}</td><td class="numeric">${formatNumber(line.amount)}</td></tr>`).join("")}</tbody></table></div>
    <h3>공제 내역</h3><div class="table-scroll"><table><thead><tr><th>항목</th><th class="numeric">금액</th></tr></thead><tbody>${deductionRows.map(([key, label]) => `<tr><td>${e(label)}</td><td class="numeric">${formatNumber(payroll.deductions[key])}</td></tr>`).join("") || `<tr><td colspan="2">공제 내역 없음</td></tr>`}</tbody></table></div>
    <div class="payslip-totals"><div><span>총 지급액</span><strong>${formatWon(payroll.gross)}</strong></div><div><span>총 공제액</span><strong>${formatWon(payroll.totalDeductions)}</strong></div><div class="net"><span>실 지급액</span><strong>${formatWon(payroll.net)}</strong></div></div>
    <p class="payslip-footnote">본 명세서는 확정된 선생님별 월 지급액과 유형을 기준으로 작성되었습니다. 세금 기준 ${e(payroll.taxPolicyVersion || payroll.policyVersion)}, 사회보험 기준 ${e(payroll.insurancePolicyVersion || "별도 확인")}. 세부 계약 또는 공제 관련 문의는 학원 담당자에게 연락해 주세요.</p>
  </article>`;
}

function bindCommonControls() {
  elements.content.querySelectorAll("[data-control='month']").forEach((input) => input.addEventListener("change", () => { state.month = input.value; render(); }));
  elements.content.querySelectorAll("[data-control='search']").forEach((input) => input.addEventListener("input", () => { state.search = input.value; render(); }));
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

function openTeacherModal() {
  openModal("선생님 등록", `
    <form id="teacher-form" class="form-grid">
      <div class="form-field"><label for="teacher-name">이름</label><input id="teacher-name" name="name" required /></div>
      <div class="form-field"><label for="teacher-email">Google 이메일</label><input id="teacher-email" name="email" type="email" required /></div>
      <div class="form-field"><label for="teacher-employment-type">선생님 유형</label><select id="teacher-employment-type" name="employmentType" required><option value="insured">4대보험 가입자</option><option value="freelancer">프리랜서</option></select></div>
      <div class="form-field"><label for="teacher-base-pay">기본 월 지급액</label><input id="teacher-base-pay" name="baseMonthlyPay" type="number" min="0" step="1000" value="0" required /><span class="form-help">매월 기본으로 불러올 금액이며 월 급여 입력에서 변경할 수 있습니다.</span></div>
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
    const teacher = { id: crypto.randomUUID(), name: data.name.trim(), email, employmentType: data.employmentType, baseMonthlyPay: Number(data.baseMonthlyPay), subjects: data.subjects.split(",").map((item) => item.trim()).filter(Boolean), contractSummary: data.contractSummary.trim() || EMPLOYMENT_TYPE_LABELS[data.employmentType], paymentDay: Number(data.paymentDay), status: "active", authUid: null, taxProfile: { dependentCount: Number(data.dependentCount), children8To20: Number(data.children8To20), withholdingRatio: Number(data.withholdingRatio) } };
      state.data.teachers.push(teacher);
      if (state.store) await state.store.saveDocument("teachers", teacher.id, teacher);
      state.selectedTeacherId = teacher.id;
      showToast("선생님을 등록했습니다.");
      renderTeachers();
    });
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
  openModal("선생님 정보 수정", `
    <div class="notice"><i data-lucide="user-cog"></i><span>비활성화하면 다음 로그인부터 접근이 차단되며 과거 급여 자료는 삭제되지 않습니다.</span></div>
    <form id="teacher-edit-form" class="form-grid">
      <div class="form-field"><label for="teacher-edit-name">이름</label><input id="teacher-edit-name" name="name" value="${e(teacher.name)}" required /></div>
      <div class="form-field"><label for="teacher-edit-email">Google 이메일</label><input id="teacher-edit-email" name="email" type="email" value="${e(teacher.email)}" ${teacher.authUid ? "readonly" : ""} required /><span class="form-help">${teacher.authUid ? "연결된 계정의 이메일은 변경할 수 없습니다." : "승인 요청의 Google 이메일과 정확히 일치해야 합니다."}</span></div>
      <div class="form-field"><label for="teacher-edit-employment-type">선생님 유형</label><select id="teacher-edit-employment-type" name="employmentType" required><option value="insured" ${employmentTypeOf(teacher) === "insured" ? "selected" : ""}>4대보험 가입자</option><option value="freelancer" ${employmentTypeOf(teacher) === "freelancer" ? "selected" : ""}>프리랜서</option></select></div>
      <div class="form-field"><label for="teacher-edit-base-pay">기본 월 지급액</label><input id="teacher-edit-base-pay" name="baseMonthlyPay" type="number" min="0" step="1000" value="${e(teacher.baseMonthlyPay || 0)}" required /><span class="form-help">이미 확정한 명세서는 변경되지 않습니다.</span></div>
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
    const updated = {
      ...teacher,
      name: data.name.trim(),
      email,
      employmentType: data.employmentType,
      baseMonthlyPay: Number(data.baseMonthlyPay),
      subjects: data.subjects.split(",").map((item) => item.trim()).filter(Boolean),
      contractSummary: data.contractSummary.trim() || "조건 미설정",
      paymentDay: Number(data.paymentDay),
      status: data.status,
      taxProfile: { dependentCount: Number(data.dependentCount), children8To20: Number(data.children8To20), withholdingRatio: Number(data.withholdingRatio) }
    };
    if (state.store) await state.store.updateTeacher(updated);
    Object.assign(teacher, updated);
    showToast(`${teacher.name} 선생님 정보를 저장했습니다.`);
    renderTeachers();
  });
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
  const currentAmount = monthlyPayAmount(teacher, state.month);
  openModal(`${teacher.name} 월 지급액`, `
    <div class="notice"><i data-lucide="wallet-cards"></i><span>${e(employmentTypeLabel(teacher))} 기준으로 ${employmentTypeOf(teacher) === "insured" ? "근로소득과 4대보험" : "사업소득 원천징수"}이 적용됩니다. 수업 건수는 급여 계산에 사용하지 않습니다.</span></div>
    <form id="monthly-pay-form" class="form-grid">
      <div class="form-field"><label for="monthly-pay-default">기본 월 지급액</label><input id="monthly-pay-default" type="text" value="${e(formatWon(teacher.baseMonthlyPay || 0))}" readonly /></div>
      <div class="form-field"><label for="monthly-pay-amount">${formatMonth(state.month)} 지급액</label><input id="monthly-pay-amount" name="grossPay" type="number" min="0" step="1000" value="${e(currentAmount)}" required /></div>
      <div class="form-field full"><label for="monthly-pay-note">변경 메모</label><input id="monthly-pay-note" name="grossPayNote" maxlength="200" value="${e(current.grossPayNote || "")}" placeholder="예: 입사월 일할 계산" /><span class="form-help">개인정보나 상세 급여 내역을 적지 말고 변경 이유만 간단히 기록합니다.</span></div>
    </form>
  `, "저장", async () => {
    const form = document.querySelector("#monthly-pay-form");
    if (!form.reportValidity()) return false;
    const data = Object.fromEntries(new FormData(form));
    const override = {
      ...current,
      id: `${state.month}_${teacher.id}`,
      month: state.month,
      teacherId: teacher.id,
      grossPay: Number(data.grossPay),
      grossPayNote: data.grossPayNote.trim() || null
    };
    state.data.overrides[key] = override;
    if (state.store) await state.store.saveDocument("payrollOverrides", override.id, override);
    showToast(`${formatMonth(state.month)} 지급액을 저장했습니다.`);
    renderPayrollInputs();
  });
}

function openPayrollAdjustmentModal(teacher) {
  const key = `${state.month}:${teacher.id}`;
  const current = state.data.overrides[key] || {};
  const optionalValue = (name) => current[name] == null ? "" : e(current[name]);
  openModal(`${teacher.name} 과세·공제 조정`, `
    <div class="notice"><i data-lucide="circle-equal"></i><span>비과세와 학자금 지원액은 근로소득 간이세액표의 월급여에서 제외됩니다. 수동 공제액을 비워 두면 현재 세금·사회보험 정책으로 자동 계산합니다.</span></div>
    <form id="payroll-adjustment-form" class="form-grid">
      <div class="form-field"><label for="adjust-nontaxable">근로소득 비과세액</label><input id="adjust-nontaxable" name="employeeNonTaxableAmount" type="number" min="0" step="1" value="${e(current.employeeNonTaxableAmount || 0)}" /></div>
      <div class="form-field"><label for="adjust-student-loan">학자금 지원액</label><input id="adjust-student-loan" name="employeeStudentLoanSupportAmount" type="number" min="0" step="1" value="${e(current.employeeStudentLoanSupportAmount || 0)}" /></div>
      <div class="form-field"><label for="adjust-employee-tax">근로소득세 수동값</label><input id="adjust-employee-tax" name="employeeIncomeTax" type="number" min="0" step="1" value="${optionalValue("employeeIncomeTax")}" placeholder="자동" /></div>
      <div class="form-field"><label for="adjust-employee-local">근로소득 지방세 수동값</label><input id="adjust-employee-local" name="employeeLocalTax" type="number" min="0" step="1" value="${optionalValue("employeeLocalTax")}" placeholder="자동" /></div>
      <div class="form-field"><label for="adjust-pension">국민연금 수동값</label><input id="adjust-pension" name="nationalPension" type="number" min="0" step="1" value="${optionalValue("nationalPension")}" placeholder="자동" /></div>
      <div class="form-field"><label for="adjust-health">건강보험 수동값</label><input id="adjust-health" name="healthInsurance" type="number" min="0" step="1" value="${optionalValue("healthInsurance")}" placeholder="자동" /></div>
      <div class="form-field"><label for="adjust-care">장기요양 수동값</label><input id="adjust-care" name="longTermCare" type="number" min="0" step="1" value="${optionalValue("longTermCare")}" placeholder="자동" /></div>
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
      "employeeIncomeTax", "employeeLocalTax", "nationalPension", "healthInsurance",
      "longTermCare", "employmentInsurance", "businessIncomeTax", "businessLocalTax",
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
    const unassigned = activeTeachers().filter((teacher) => employmentTypeOf(teacher) === "unassigned");
    if (unassigned.length) throw new Error(`유형을 선택하지 않은 선생님이 있습니다: ${unassigned.map((teacher) => teacher.name).join(", ")}`);
    const missingInsured = activeTeachers().filter((teacher) => employmentTypeOf(teacher) === "insured" && monthlyPayAmount(teacher, state.month) <= 0);
    if (missingInsured.length) throw new Error(`월급이 입력되지 않은 4대보험 가입자가 있습니다: ${missingInsured.map((teacher) => teacher.name).join(", ")}`);
    const payrolls = payrollsForMonth(state.month);
    if (!payrolls.length) throw new Error("이번 달 지급액이 입력된 선생님이 없습니다.");
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
  const rows = [["급여월", "선생님", "근로소득", "사업소득", "기타소득", "미공제", "총 지급액", "총 공제액", "실 지급액"]];
  payrollsForMonth(state.month).forEach(({ teacher, payroll }) => rows.push([state.month, teacher.name, payroll.grossByTreatment.employee, payroll.grossByTreatment.business, payroll.grossByTreatment.other, payroll.grossByTreatment.exempt, payroll.gross, payroll.totalDeductions, payroll.net]));
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
