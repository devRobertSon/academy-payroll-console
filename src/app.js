import { appConfig } from "./config.js";
import {
  demoEntries,
  demoOverrides,
  demoPayrollRuns,
  demoPolicy,
  demoRateRules,
  demoTeachers,
  demoUsers
} from "./data/demo-data.js";
import { createFirebaseStore } from "./lib/firebase-store.js";
import { csvRowsToObjects, parseCsv } from "./lib/csv.js";
import { calculatePayroll, summarizePayroll, TREATMENT_LABELS } from "./lib/payroll.js";
import { downloadCsv, escapeHtml as e, formatHours, formatMonth, formatNumber, formatWon } from "./lib/format.js";

const state = {
  user: null,
  view: "dashboard",
  month: "2026-08",
  search: "",
  selectedTeacherId: null,
  selectedPayslipMonth: "2026-08",
  store: null,
  data: {
    teachers: [],
    rateRules: [],
    entries: [],
    payrollRuns: [],
    policies: [],
    overrides: {},
    payslips: [],
    payslipReceipts: []
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
  modalRoot: document.querySelector("#modal-root"),
  toastRoot: document.querySelector("#toast-root")
};

const adminNav = [
  ["업무", "dashboard", "layout-dashboard", "급여 대시보드"],
  ["업무", "entries", "calendar-range", "수업 내역"],
  ["관리", "teachers", "users-round", "선생님 관리"],
  ["관리", "rates", "badge-dollar-sign", "시급 · 계약 조건"],
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
  elements.nav.addEventListener("click", (event) => {
    const button = event.target.closest("[data-view]");
    if (!button) return;
    state.view = button.dataset.view;
    elements.workspace.classList.remove("menu-open");
    render();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeModal();
  });
}

function loadDemoData() {
  state.data = {
    teachers: structuredClone(demoTeachers),
    rateRules: structuredClone(demoRateRules),
    entries: structuredClone(demoEntries),
    payrollRuns: structuredClone(demoPayrollRuns),
    policies: [structuredClone(demoPolicy)],
    overrides: structuredClone(demoOverrides),
    payslips: [],
    payslipReceipts: []
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
  state.data.policies = loaded.policies || [];
  state.data.payslips = loaded.payslips || [];
  state.data.payslipReceipts = loaded.payslipReceipts || [];
  state.data.overrides = Object.fromEntries((loaded.payrollOverrides || []).map((item) => [`${item.month}:${item.teacherId}`, item]));
  const latestMonth = state.data.payrollRuns.map((run) => run.month).sort().at(-1);
  if (latestMonth) state.month = latestMonth;
}

async function logout() {
  if (state.store) await state.store.signOut();
  state.user = null;
  elements.workspace.hidden = true;
  elements.login.hidden = false;
  setLoginStatus("");
}

function render() {
  renderNav();
  const renderers = {
    dashboard: renderDashboard,
    entries: renderEntries,
    teachers: renderTeachers,
    rates: renderRates,
    ledger: renderLedger,
    settings: renderSettings,
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
  setPage("급여 대시보드", formatMonth(state.month), `
    <button class="button button-secondary" type="button" data-action="copy-notice" ${run.status !== "published" ? "disabled" : ""}><i data-lucide="send"></i><span>안내문 복사</span></button>
    <button class="button button-secondary" type="button" data-action="export-ledger"><i data-lucide="download"></i><span>내역서 저장</span></button>
    <button class="button button-primary" type="button" data-action="publish-run" ${run.status === "published" ? "disabled" : ""}><i data-lucide="check-check"></i><span>${run.status === "published" ? "확정 완료" : "급여 확정"}</span></button>
  `);
  elements.content.innerHTML = `
    ${run.status !== "published" ? `<div class="notice warning"><i data-lucide="triangle-alert"></i><span>현재 계산 결과는 초안입니다. 수업 내역과 공제액을 검토한 뒤 확정해 주세요. 사회보험·세액은 기장 회계사의 최종 확인이 필요합니다.</span></div>` : ""}
    <div class="toolbar">
      <input class="month-control" type="month" value="${e(state.month)}" aria-label="급여 월" data-control="month" />
      <span class="status-chip ${e(run.status)}">${statusLabel(run.status)}</span>
      <span class="toolbar-spacer"></span>
      <div class="search-wrap"><i data-lucide="search"></i><input class="search-control" type="search" value="${e(state.search)}" placeholder="선생님 검색" aria-label="선생님 검색" data-control="search" /></div>
    </div>
    <section class="metrics" aria-label="급여 요약">
      ${metric("users-round", "대상 선생님", `${payrolls.length}명`, `수업 내역 ${entriesForMonth(state.month).length}건`)}
      ${metric("circle-dollar-sign", "총 지급액", formatWon(summary.gross), "공제 전 금액")}
      ${metric("receipt-text", "총 공제액", formatWon(summary.deductions), `보험 적용 기준 ${formatWon(summary.insuredBase)}`)}
      ${metric("wallet-cards", "실 지급액", formatWon(summary.net), "선생님 지급 예정 합계")}
    </section>
    <section class="content-section">
      <div class="section-heading"><div><h2>선생님별 급여</h2><p>소득 구분별 계산 결과를 합산한 이번 달 초안</p></div></div>
      <div class="data-surface table-scroll">${payrollTable(payrolls)}</div>
    </section>
    <section class="content-section">
      <div class="section-heading"><div><h2>처리 진행 상황</h2><p>입력부터 명세서 공개까지의 월별 상태</p></div></div>
      <div class="progress-strip">
        ${progressStep("1", "수업 내역 입력", `${entriesForMonth(state.month).length}건`, true, true)}
        ${progressStep("2", "계산 검토", `${payrolls.length}명`, true, run.status !== "draft")}
        ${progressStep("3", "급여 확정", statusLabel(run.status), run.status !== "draft", run.status === "published")}
        ${progressStep("4", "명세서 공개", run.publishedAt ? "선생님 열람 가능" : "확정 후 공개", run.status === "published", false)}
      </div>
    </section>
  `;
  bindCommonControls();
  elements.topbarActions.querySelector("[data-action='export-ledger']").addEventListener("click", exportLedger);
  elements.topbarActions.querySelector("[data-action='publish-run']").addEventListener("click", openPublishModal);
  if (run.status === "published") elements.topbarActions.querySelector("[data-action='copy-notice']").addEventListener("click", copyPayslipNotice);
  bindPayrollRows();
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
  elements.content.innerHTML = `
    <div class="toolbar"><div class="search-wrap"><i data-lucide="search"></i><input class="search-control" type="search" value="${e(state.search)}" placeholder="이름 검색" aria-label="이름 검색" data-control="search" /></div></div>
    <div class="split-layout">
      <section class="data-surface table-scroll">
        <table><thead><tr><th>선생님</th><th>담당 과목</th><th>계약 요약</th><th>상태</th></tr></thead><tbody>
          ${filtered.map((teacher) => `<tr data-select-teacher="${e(teacher.id)}" tabindex="0"><td>${personCell(teacher)}</td><td>${e(teacher.subjects.join(", "))}</td><td>${e(teacher.contractSummary)}</td><td><span class="status-chip paid">활성</span></td></tr>`).join("") || emptyRow(4)}
        </tbody></table>
      </section>
      ${selected ? `<aside class="detail-panel">
        <div class="detail-panel-header"><h2>${e(selected.name)}</h2><p>${e(selected.email)}</p></div>
        <div class="detail-block"><h3>접근 연결</h3><dl class="definition-list"><div><dt>로그인 UID</dt><dd>${e(selected.authUid || "로그인 후 연결")}</dd></div><div><dt>상태</dt><dd>활성</dd></div></dl></div>
        <div class="detail-block"><h3>급여 조건</h3><dl class="definition-list"><div><dt>계약 형태</dt><dd>${e(selected.contractSummary)}</dd></div><div><dt>지급 예정일</dt><dd>매월 ${e(selected.paymentDay)}일</dd></div></dl></div>
        <div class="detail-block"><h3>담당 과목</h3><div class="tag-list">${selected.subjects.map((subject) => `<span class="tag">${e(subject)}</span>`).join("")}</div></div>
      </aside>` : ""}
    </div>
  `;
  bindCommonControls();
  elements.topbarActions.querySelector("[data-action='add-teacher']").addEventListener("click", openTeacherModal);
  elements.topbarActions.querySelector("[data-action='copy-portal']").addEventListener("click", copyPortalLink);
  elements.content.querySelectorAll("[data-select-teacher]").forEach((row) => row.addEventListener("click", () => {
    state.selectedTeacherId = row.dataset.selectTeacher;
    renderTeachers();
  }));
}

function renderRates() {
  setPage("시급 · 계약 조건", "적용 기간별 규칙", `<button class="button button-primary" type="button" data-action="add-rate"><i data-lucide="plus"></i><span>조건 추가</span></button>`);
  elements.content.innerHTML = `
    <div class="notice"><i data-lucide="layers-3"></i><span>한 선생님에게 과목별 시급과 서로 다른 소득 구분을 동시에 지정할 수 있습니다. 수업일에 유효한 가장 구체적인 조건이 적용됩니다.</span></div>
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
  const policy = policyForMonth(state.month);
  setPage("계산 · 보안 설정", "관리자 전용");
  elements.content.innerHTML = `
    <div class="notice warning"><i data-lucide="scale"></i><span>아래 비율은 계산 구조를 확인하기 위한 설정값입니다. 실제 적용 월의 법정 요율, 기준소득월액, 보수월액, 간이세액표와 계약 관계는 기장 회계사 확인 후 입력해야 합니다.</span></div>
    <div class="split-layout">
      <section class="detail-panel">
        <div class="detail-panel-header"><h2>계산 정책 ${e(policy.version || "미설정")}</h2><p>${formatMonth(policy.effectiveMonth || state.month)} 적용</p></div>
        <div class="detail-block"><h3>근로소득 보험</h3><dl class="definition-list"><div><dt>국민연금</dt><dd>${ratePercent(policy.employee?.nationalPension?.rate)}</dd></div><div><dt>건강보험</dt><dd>${ratePercent(policy.employee?.healthInsurance?.rate)}</dd></div><div><dt>장기요양</dt><dd>건강보험료의 ${ratePercent(policy.employee?.longTermCareRate)}</dd></div><div><dt>고용보험</dt><dd>${ratePercent(policy.employee?.employmentInsurance?.rate)}</dd></div></dl></div>
        <div class="detail-block"><h3>원천징수</h3><dl class="definition-list"><div><dt>사업소득 소득세</dt><dd>${ratePercent(policy.business?.incomeTaxRate)}</dd></div><div><dt>사업소득 지방세</dt><dd>${ratePercent(policy.business?.localIncomeTaxRate)}</dd></div><div><dt>기타소득</dt><dd>${ratePercent(policy.other?.withholdingRate)}</dd></div></dl></div>
      </section>
      <section class="detail-panel">
        <div class="detail-panel-header"><h2>보안 점검</h2><p>공개 GitHub Pages 운영 기준</p></div>
        <div class="detail-block"><dl class="definition-list"><div><dt>저장소 개인정보</dt><dd>포함 금지</dd></div><div><dt>Firestore 기본 권한</dt><dd>전면 거부</dd></div><div><dt>선생님 명세서</dt><dd>본인 UID만</dd></div><div><dt>관리자 쓰기</dt><dd>역할 확인</dd></div><div><dt>확정본 수정</dt><dd>금지</dd></div></dl></div>
        <div class="detail-block"><h3>현재 실행 모드</h3><span class="status-chip ${appConfig.demoMode ? "draft" : "published"}">${appConfig.demoMode ? "데모 데이터" : "Firebase 연결"}</span></div>
      </section>
    </div>
  `;
}

function renderPayslips() {
  const teacherId = state.user.role === "teacher" ? state.user.teacherId : state.selectedTeacherId;
  const teacher = teacherById(teacherId);
  const months = availablePayslipMonths(teacherId);
  if (!months.includes(state.selectedPayslipMonth)) state.selectedPayslipMonth = months[0] || state.month;
  const payroll = payrollForTeacher(teacherId, state.selectedPayslipMonth);
  const run = { ...runForMonth(state.selectedPayslipMonth), status: payslipStatus(teacherId, state.selectedPayslipMonth) };
  setPage(state.user.role === "teacher" ? "급여명세서" : `${teacher?.name || "선생님"} 급여명세서`, "발행된 월별 내역", `<button class="button button-primary" type="button" data-action="print-payslip"><i data-lucide="printer"></i><span>인쇄 · PDF</span></button>`);
  elements.content.innerHTML = `
    <div class="notice"><i data-lucide="lock-keyhole"></i><span>${state.user.role === "teacher" ? "본인에게 발행된 급여명세서만 표시됩니다." : "관리자 미리보기입니다."} 금액에 문의가 있으면 학원 담당자에게 확인해 주세요.</span></div>
    <div class="payslip-layout">
      <aside class="payslip-list"><div class="payslip-list-header"><h2>명세서 내역</h2></div>
        ${months.map((month) => { const item = payrollForTeacher(teacherId, month); return `<button class="payslip-item ${month === state.selectedPayslipMonth ? "active" : ""}" type="button" data-payslip-month="${e(month)}"><strong>${formatMonth(month)}</strong><span>${payslipStatus(teacherId, month) === "published" ? "발행 완료" : "관리자 미리보기"}</span><span class="amount">${formatWon(item?.payroll.net)}</span></button>`; }).join("") || `<div class="empty-state">발행된 명세서가 없습니다.</div>`}
      </aside>
      ${payroll && teacher ? payslipSheet(teacher, payroll.payroll, state.selectedPayslipMonth, run) : `<div class="empty-state">확인할 명세서가 없습니다.</div>`}
    </div>
  `;
  elements.topbarActions.querySelector("[data-action='print-payslip']").addEventListener("click", () => window.print());
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

function payrollsForMonth(month) {
  const search = state.search.trim();
  return state.data.teachers
    .filter((teacher) => !search || teacher.name.includes(search))
    .map((teacher) => payrollForTeacher(teacher.id, month))
    .filter((item) => item && item.payroll.earningLines.length);
}

function payrollForTeacher(teacherId, month) {
  if (!appConfig.demoMode && state.user?.role === "teacher" && state.data.payslips.length) {
    const saved = state.data.payslips.find((item) => item.month === month && item.teacherUid === state.user.uid);
    return saved ? { teacher: teacherById(teacherId), payroll: saved.calculation || saved } : null;
  }
  const teacher = teacherById(teacherId);
  if (!teacher) return null;
  const entries = entriesForMonth(month).filter((entry) => entry.teacherId === teacherId);
  if (!entries.length) return null;
  return {
    teacher,
    payroll: calculatePayroll(entries, policyForMonth(month), state.data.overrides[`${month}:${teacherId}`])
  };
}

function entriesForMonth(month) { return state.data.entries.filter((entry) => entry.month === month); }
function teacherById(id) { return state.data.teachers.find((teacher) => teacher.id === id); }
function runForMonth(month) { return state.data.payrollRuns.find((run) => run.month === month) || { month, status: "draft", publishedAt: null }; }
function policyForMonth(month) { return state.data.policies.find((policy) => policy.effectiveMonth === month) || state.data.policies[0] || demoPolicy; }

function availablePayslipMonths(teacherId) {
  if (!appConfig.demoMode && state.data.payslips.length) return state.data.payslips.map((item) => item.month).sort().reverse();
  return [...new Set(state.data.entries.filter((entry) => entry.teacherId === teacherId).map((entry) => entry.month))]
    .filter((month) => state.user.role !== "teacher" || runForMonth(month).status === "published")
    .sort().reverse();
}

function payslipStatus(teacherId, month) {
  const saved = state.data.payslips.find((item) => item.teacherId === teacherId && item.month === month);
  return saved?.status || runForMonth(month).status;
}

function payrollTable(items) {
  return `<table><thead><tr><th>선생님</th><th>소득 구성</th><th class="numeric">총 지급액</th><th class="numeric">공제액</th><th class="numeric">실 지급액</th><th>발행</th><th>열람</th><th aria-label="작업"></th></tr></thead><tbody>${items.map(({ teacher, payroll }) => {
    const receipt = receiptFor(teacher.id, state.month);
    const published = runForMonth(state.month).status === "published";
    return `<tr><td>${personCell(teacher)}</td><td><div class="tag-list">${Object.entries(payroll.grossByTreatment).filter(([, amount]) => amount > 0).map(([type]) => `<span class="tag">${e(TREATMENT_LABELS[type])}</span>`).join("")}</div></td><td class="numeric">${formatWon(payroll.gross)}</td><td class="numeric">${formatWon(payroll.totalDeductions)}</td><td class="numeric"><strong>${formatWon(payroll.net)}</strong></td><td><span class="status-chip ${runForMonth(state.month).status}">${statusLabel(runForMonth(state.month).status)}</span></td><td>${receipt ? `<span class="status-chip published" title="${e(formatViewedAt(receipt.viewedAt))}">열람 완료</span>` : `<span class="status-chip pending">${published ? "미열람" : "발행 전"}</span>`}</td><td><div class="row-actions"><button class="icon-button" type="button" title="명세서 보기" aria-label="${e(teacher.name)} 명세서 보기" data-view-payslip="${e(teacher.id)}"><i data-lucide="file-search"></i></button></div></td></tr>`;
  }).join("") || emptyRow(8)}</tbody></table>`;
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
    <div class="payslip-summary"><div><span>성명</span><strong>${e(teacher.name)}</strong></div><div><span>발행 상태</span><strong>${run.status === "published" ? "발행 완료" : "미리보기"}</strong></div></div>
    <h3>지급 내역</h3><div class="table-scroll"><table><thead><tr><th>과목</th><th>구분</th><th class="numeric">시간</th><th class="numeric">시급</th><th class="numeric">금액</th></tr></thead><tbody>${payroll.earningLines.map((line) => `<tr><td>${e(line.subjectName)}</td><td>${e(TREATMENT_LABELS[line.treatment])}</td><td class="numeric">${e(line.hours)}</td><td class="numeric">${formatNumber(line.hourlyRate)}</td><td class="numeric">${formatNumber(line.amount)}</td></tr>`).join("")}</tbody></table></div>
    <h3>공제 내역</h3><div class="table-scroll"><table><thead><tr><th>항목</th><th class="numeric">금액</th></tr></thead><tbody>${deductionRows.map(([key, label]) => `<tr><td>${e(label)}</td><td class="numeric">${formatNumber(payroll.deductions[key])}</td></tr>`).join("") || `<tr><td colspan="2">공제 내역 없음</td></tr>`}</tbody></table></div>
    <div class="payslip-totals"><div><span>총 지급액</span><strong>${formatWon(payroll.gross)}</strong></div><div><span>총 공제액</span><strong>${formatWon(payroll.totalDeductions)}</strong></div><div class="net"><span>실 지급액</span><strong>${formatWon(payroll.net)}</strong></div></div>
    <p class="payslip-footnote">본 명세서는 확정된 월별 수업 내역과 적용 조건을 기준으로 작성되었습니다. 세부 계약 또는 공제 관련 문의는 학원 담당자에게 연락해 주세요.</p>
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
}

function openEntryModal() {
  const teacherOptions = state.data.teachers.map((teacher) => `<option value="${e(teacher.id)}">${e(teacher.name)}</option>`).join("");
  openModal("수업 내역 추가", `
    <form id="entry-form" class="form-grid">
      <div class="form-field"><label for="entry-date">수업일</label><input id="entry-date" name="workedOn" type="date" value="${e(state.month)}-15" required /></div>
      <div class="form-field"><label for="entry-teacher">선생님</label><select id="entry-teacher" name="teacherId" required>${teacherOptions}</select></div>
      <div class="form-field full"><label for="entry-subject">과목명</label><input id="entry-subject" name="subjectName" required placeholder="예: 고등 수학" /></div>
      <div class="form-field"><label for="entry-hours">수업 시간</label><input id="entry-hours" name="hours" type="number" min="0.5" step="0.5" required /></div>
      <div class="form-field"><label for="entry-rate">시급</label><input id="entry-rate" name="hourlyRate" type="number" min="0" step="1000" required /></div>
      <div class="form-field"><label for="entry-treatment">소득 구분</label><select id="entry-treatment" name="treatment"><option value="employee">근로소득</option><option value="business">사업소득</option><option value="other">기타소득</option><option value="exempt">공제 없음</option></select></div>
      <div class="form-field"><label>보험 적용</label><label class="checkbox-row"><input name="insuranceCovered" type="checkbox" /> 이 수업을 보험 기준액에 포함</label></div>
    </form>`, "추가", async () => {
      const form = document.querySelector("#entry-form");
      if (!form.reportValidity()) return false;
      const data = Object.fromEntries(new FormData(form));
      const entry = { id: crypto.randomUUID(), month: data.workedOn.slice(0, 7), workedOn: data.workedOn, teacherId: data.teacherId, subjectName: data.subjectName, subjectId: slug(data.subjectName), hours: Number(data.hours), hourlyRate: Number(data.hourlyRate), treatment: data.treatment, insuranceCovered: data.insuranceCovered === "on", source: "manual" };
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
      <div class="form-field full"><label for="teacher-subjects">담당 과목</label><input id="teacher-subjects" name="subjects" placeholder="쉼표로 구분" /></div>
      <div class="form-field"><label for="teacher-contract">계약 요약</label><input id="teacher-contract" name="contractSummary" placeholder="예: 혼합 · 수업별 구분" /></div>
      <div class="form-field"><label for="teacher-payday">지급일</label><input id="teacher-payday" name="paymentDay" type="number" min="1" max="31" value="10" /></div>
      <p class="form-help full">실제 계정 연결은 사용자가 처음 로그인한 뒤 관리자 승인 절차에서 UID를 확인하도록 운영하세요.</p>
    </form>`, "등록", async () => {
      const form = document.querySelector("#teacher-form");
      if (!form.reportValidity()) return false;
      const data = Object.fromEntries(new FormData(form));
      const teacher = { id: crypto.randomUUID(), name: data.name, email: data.email, subjects: data.subjects.split(",").map((item) => item.trim()).filter(Boolean), contractSummary: data.contractSummary || "조건 미설정", paymentDay: Number(data.paymentDay), status: "active", authUid: null };
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
      <div class="form-field"><label for="rate-start">적용 시작일</label><input id="rate-start" name="effectiveFrom" type="date" value="${e(state.month)}-01" required /></div>
      <div class="form-field"><label>보험 적용</label><label class="checkbox-row"><input name="insuranceCovered" type="checkbox" /> 보험 적용 수업</label></div>
    </form>`, "추가", async () => {
      const form = document.querySelector("#rate-form");
      if (!form.reportValidity()) return false;
      const data = Object.fromEntries(new FormData(form));
      const rule = { id: crypto.randomUUID(), teacherId: data.teacherId, subjectName: data.subjectName, subjectId: slug(data.subjectName), hourlyRate: Number(data.hourlyRate), treatment: data.treatment, insuranceCovered: data.insuranceCovered === "on", effectiveFrom: data.effectiveFrom };
      state.data.rateRules.push(rule);
      if (state.store) await state.store.saveDocument("rateRules", rule.id, rule);
      showToast("계약 조건을 추가했습니다.");
      renderRates();
    });
}

function openCsvHelpModal() {
  openModal("CSV 수업 내역 업로드", `
    <div class="notice"><i data-lucide="file-spreadsheet"></i><span>첫 줄의 열 이름을 아래 형식과 같게 만든 UTF-8 CSV를 선택해 주세요.</span></div>
    <div class="data-surface table-scroll"><table><thead><tr><th>workedOn</th><th>teacherId</th><th>subjectName</th><th>hours</th><th>hourlyRate</th><th>treatment</th><th>insuranceCovered</th></tr></thead><tbody><tr><td>2026-08-05</td><td>teacher-id</td><td>중등 수학</td><td>2</td><td>42000</td><td>employee</td><td>true</td></tr></tbody></table></div>
    <form id="csv-form" class="form-grid" style="margin-top:16px"><div class="form-field full"><label for="csv-file">CSV 파일</label><input id="csv-file" name="file" type="file" accept=".csv,text/csv" required /><span class="form-help">treatment 값: employee, business, other, exempt</span></div></form>
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
      return { id: crypto.randomUUID(), month: item.workedOn.slice(0, 7), workedOn: item.workedOn, teacherId: item.teacherId, subjectName: item.subjectName, subjectId: slug(item.subjectName), hours: Number(item.hours), hourlyRate: Number(item.hourlyRate), treatment: item.treatment, insuranceCovered: item.insuranceCovered.toLowerCase() === "true", source: "csv" };
    });
    if (entries.some((entry) => !Number.isFinite(entry.hours) || !Number.isFinite(entry.hourlyRate))) throw new Error("시간 또는 시급에 숫자가 아닌 값이 있습니다.");
    state.data.entries.push(...entries);
    if (state.store) await Promise.all(entries.map((entry) => state.store.saveDocument("workEntries", entry.id, entry)));
    state.month = entries[0].month;
    showToast(`${entries.length}건의 수업 내역을 추가했습니다.`);
    renderEntries();
  });
}

function openPublishModal() {
  const currentRun = runForMonth(state.month);
  if (currentRun.status === "published") return;
  openModal("급여 확정 및 명세서 공개", `<div class="notice warning"><i data-lucide="lock"></i><span>${formatMonth(state.month)} 급여를 확정하면 선생님이 본인 명세서를 열람할 수 있습니다. 확정본을 수정해야 할 때는 취소 이력을 남기고 새 버전을 발행해야 합니다.</span></div><label class="checkbox-row"><input id="publish-confirm" type="checkbox" /> 계산 결과와 공제액을 모두 검토했습니다.</label>`, "확정", async () => {
    if (!document.querySelector("#publish-confirm").checked) { showToast("검토 확인을 선택해 주세요."); return false; }
    const payrolls = payrollsForMonth(state.month);
    const missingAccounts = payrolls.filter(({ teacher }) => !teacher.authUid);
    if (state.store && missingAccounts.length) throw new Error(`로그인 UID가 연결되지 않은 선생님이 있습니다: ${missingAccounts.map(({ teacher }) => teacher.name).join(", ")}`);
    const run = { ...currentRun, status: "published", publishedAt: new Date().toISOString() };
    if (state.store) {
      await state.store.publishPayrollRun(
        run,
        payrolls.map(({ teacher, payroll }) => ({
          id: `${state.month}_${teacher.id}`,
          data: {
            month: state.month,
            teacherId: teacher.id,
            teacherUid: teacher.authUid,
            teacherName: teacher.name,
            status: "published",
            policyVersion: payroll.policyVersion,
            calculation: payroll,
            publishedAt: run.publishedAt
          }
        })),
        {
          id: crypto.randomUUID(),
          data: { action: "PAYROLL_PUBLISHED", month: state.month, actorUid: state.user.uid, createdAt: run.publishedAt }
        }
      );
    }
    const runIndex = state.data.payrollRuns.findIndex((item) => item.month === state.month);
    if (runIndex >= 0) state.data.payrollRuns[runIndex] = run;
    else state.data.payrollRuns.push(run);
    showToast("급여를 확정하고 명세서를 공개했습니다.");
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
  const payslipId = `${month}_${teacherId}`;
  const receipt = { id: `${payslipId}_${state.user.uid}`, payslipId, teacherId, teacherUid: state.user.uid, month, viewedAt: new Date().toISOString() };
  state.data.payslipReceipts.push(receipt);
  if (state.store) {
    try {
      await state.store.recordPayslipView(payslipId, teacherId, month);
    } catch (error) {
      state.data.payslipReceipts = state.data.payslipReceipts.filter((item) => item.id !== receipt.id);
      console.error("급여명세서 열람 기록 저장 실패", error);
    }
  }
}

function receiptFor(teacherId, month) {
  return state.data.payslipReceipts.find((item) => item.teacherId === teacherId && item.month === month);
}

function formatViewedAt(value) {
  const date = value?.toDate ? value.toDate() : new Date(value);
  return Number.isNaN(date.getTime()) ? "열람 시간 기록" : date.toLocaleString("ko-KR");
}

function metric(icon, label, value, helper) { return `<div class="metric"><span class="metric-label"><i data-lucide="${icon}"></i>${e(label)}</span><strong>${e(value)}</strong><small>${e(helper)}</small></div>`; }
function progressStep(number, title, detail, active, complete) { return `<div class="progress-step ${active ? "active" : ""} ${complete ? "complete" : ""}"><strong>${e(number)}. ${e(title)}</strong><span>${e(detail)}</span></div>`; }
function personCell(teacher) { return `<div class="person-cell"><span class="avatar">${e(teacher.name.slice(0, 1))}</span><span class="person-meta"><strong>${e(teacher.name)}</strong><span>${e(teacher.email)}</span></span></div>`; }
function emptyRow(columns) { return `<tr><td colspan="${columns}"><div class="empty-state">표시할 내역이 없습니다.</div></td></tr>`; }
function statusLabel(status) { return ({ draft: "검토 중", ready: "확정 대기", published: "발행 완료", paid: "지급 완료" })[status] || status; }
function roleLabel(role) { return ({ admin: "관리자", teacher: "선생님" })[role] || role; }
function ratePercent(rate) { return `${((Number(rate) || 0) * 100).toLocaleString("ko-KR", { maximumFractionDigits: 3 })}%`; }
function slug(value) { return String(value).trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9가-힣-]/g, ""); }
function deductionLabels() { return { nationalPension: "국민연금", healthInsurance: "건강보험", longTermCare: "장기요양보험", employmentInsurance: "고용보험", employeeIncomeTax: "근로소득세", employeeLocalTax: "근로소득 지방세", businessIncomeTax: "사업소득세", businessLocalTax: "사업소득 지방세", otherIncomeTax: "기타소득 원천징수", custom: "기타 공제" }; }
function setLoginStatus(message, isError = true) { elements.loginStatus.textContent = message; elements.loginStatus.style.color = isError ? "var(--danger)" : "var(--muted)"; }
function showToast(message) { const toast = document.createElement("div"); toast.className = "toast"; toast.textContent = message; elements.toastRoot.append(toast); setTimeout(() => toast.remove(), 3200); }
function refreshIcons() { if (window.lucide) window.lucide.createIcons(); else setTimeout(() => window.lucide?.createIcons(), 300); }
