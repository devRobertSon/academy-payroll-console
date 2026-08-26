import { spawn, spawnSync } from "node:child_process";
import { access, readdir, readFile } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const staticOnly = process.argv.includes("--static-only");
const failures = [];

await checkRequiredFiles();
await checkJavaScriptSyntax();
await checkHtmlAssets();
await checkLegalNotices();
await checkRepositorySafety();
await checkDeliverySecurity();
await checkLifecycleSecurity();
await checkTeacherMonthlyPayroll();
await checkTeacherSelfService();
await checkHelpAssistantSafety();
await checkAuthenticationCompatibility();
if (!staticOnly) await checkLocalPage();

if (failures.length) {
  console.error("\nQA failed:");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log(`QA passed: static checks${staticOnly ? "" : " and local page smoke test"}.`);

async function checkRequiredFiles() {
  const required = [
    "index.html",
    "styles.css",
    "legal.css",
    "privacy.html",
    "terms.html",
    "src/app.js",
    "src/config.js",
    "firestore.rules",
    "storage.rules",
    "docs/user-guide.md",
    "docs/ai-assistant-setup.md",
    "src/data/help-content.js",
    "src/lib/help-assistant.js",
    "src/lib/phone-number.js",
    "src/lib/teacher-self-service.js",
    "src/lib/admin-notifications.js",
    ".nojekyll"
  ];
  for (const path of required) {
    if (!(await exists(join(root, path)))) failures.push(`Required file is missing: ${path}`);
  }
}

async function checkJavaScriptSyntax() {
  const files = (await walk(root)).filter((path) => [".js", ".mjs"].includes(extname(path)));
  for (const path of files) {
    const result = spawnSync(process.execPath, ["--check", path], { encoding: "utf8" });
    if (result.status !== 0) failures.push(`JavaScript syntax error: ${relative(root, path)}`);
  }
}

async function checkHtmlAssets() {
  const html = await readFile(join(root, "index.html"), "utf8");
  const css = await readFile(join(root, "styles.css"), "utf8");
  const app = await readFile(join(root, "src", "app.js"), "utf8");
  const localReferences = [...html.matchAll(/(?:href|src)="\.\/([^"?#]+)["?#]?/g)].map((match) => match[1]);
  for (const reference of localReferences) {
    if (!(await exists(join(root, reference)))) failures.push(`index.html references a missing file: ${reference}`);
  }
  for (const id of ["login-view", "workspace", "page-content", "modal-root"]) {
    if (!html.includes(`id="${id}"`)) failures.push(`Required application surface is missing: #${id}`);
  }
  if (html.includes("급여 자료는 GitHub 저장소가 아닌 Firebase의 접근 제어 영역에 보관됩니다.")) {
    failures.push("Login page must not expose an infrastructure storage description.");
  }
  if (!html.includes("<p>학원 급여 포털</p>")) failures.push("Login page is missing the concise portal label.");
  if (!css.includes("--login-brand: #2563a6") || !css.includes("background: #173f6b")) {
    failures.push("Login page must use the blue color treatment.");
  }
  if (!css.includes("--brand: #2563a6") || !css.includes("--brand-pale: #e4effb")) {
    failures.push("Admin workspace must use the blue color treatment.");
  }
  if (!app.includes('split-layout ${selected ? "" : "single-column"}')) {
    failures.push("Teacher table must switch to a single-column layout when no detail panel is shown.");
  }
  if (!css.includes(".split-layout.single-column { grid-template-columns: minmax(0, 1fr); }")) {
    failures.push("Single-column teacher table layout must fill the available width.");
  }
  const teacherModal = app.slice(app.indexOf("function openTeacherModal"), app.indexOf("function openAccessApprovalModal"));
  if (!teacherModal.includes("incomeCompositionOptions()")) {
    failures.push("Teacher registration must render the controlled income-composition choices.");
  }
  for (const composition of ["employee", "business", "mixed"]) {
    if (!app.includes(`["${composition}",`)) failures.push(`Teacher income composition is missing: ${composition}`);
  }
  if (teacherModal.indexOf("teacher-identity") > teacherModal.indexOf("income-composition-field")) {
    failures.push("Teacher personal information must appear before the contract summary choice.");
  }
  if (!teacherModal.includes('data-income-section="employee"')
    || !teacherModal.includes('data-income-section="business"')
    || !app.includes("function bindIncomeCompositionForm")) {
    failures.push("Teacher registration must conditionally show employee and business settings.");
  }
  if (teacherModal.includes('name="contractSummary"')) {
    failures.push("Teacher contract summary must be a controlled income-composition choice, not free text.");
  }
  if (teacherModal.indexOf("teacher-employee-pay") > teacherModal.indexOf("insuranceEditorHtml")) {
    failures.push("Teacher registration must show monthly employee pay before insurance settings.");
  }
  if (!teacherModal.includes('id="teacher-employee-pay" name="defaultEmployeePay" type="number" min="0" step="1"')) {
    failures.push("Teacher monthly pay must accept one-won increments.");
  }
  if (!app.includes("function bindInsuranceEditorAutomation") || !app.includes("data-insurance-preview")) {
    failures.push("Teacher insurance settings must provide automatic bases and deduction previews.");
  }
  if (!app.includes("base.value = String(monthlyPay)") || !app.includes("update(true);")) {
    failures.push("Checked teacher insurance rows must immediately show the monthly pay as their reporting base.");
  }
  if (!app.includes("data-insurance-row-estimate") || !app.includes("적용 기간") || !app.includes("예상 보험료")) {
    failures.push("Each insurance setting row must label its period and show the calculated premium.");
  }
  if (!app.includes('data-tax-estimate="incomeTax"') || !app.includes('data-tax-estimate="localIncomeTax"')) {
    failures.push("Insurance preview must show income tax and local income tax below premiums.");
  }
  if (!app.includes("form.elements.dependentCount") || !app.includes("form.elements.children8To20") || !app.includes("form.elements.withholdingRatio")) {
    failures.push("Tax preview must use the teacher's withholding profile fields.");
  }
  if (!app.includes("보험료의 10원 미만을 절사") || !app.includes('name="insuranceRoundingUnit"')) {
    failures.push("Insurance preview and policy editor must expose the official rounding rule.");
  }
  if (!css.includes(".insurance-auto-preview") || !css.includes(".insurance-preview-grid") || !css.includes(".insurance-tax-preview")) {
    failures.push("Automatic insurance preview styles are missing.");
  }
  for (const legacyGreen of ["#126b57", "#0d4c40", "#dff1eb", "#cfebe2", "#f4faf7"]) {
    if (css.includes(legacyGreen)) failures.push(`Legacy green workspace color remains: ${legacyGreen}`);
  }
  const releaseVersion = html.match(/src\/app\.js\?v=([^"']+)/)?.[1];
  if (!releaseVersion) {
    failures.push("Application release version is missing from index.html.");
  } else {
    for (const modulePath of [
      "./config.js",
      "./data/help-content.js",
      "./data/demo-data.js",
      "./data/nts-tax-policy.js",
      "./lib/admin-notifications.js",
      "./lib/firebase-store.js",
      "./lib/payroll.js",
      "./lib/payroll-lifecycle.js",
      "./lib/payslip-file.js",
      "./lib/phone-number.js",
      "./lib/teacher-identity.js",
      "./lib/teacher-self-service.js"
    ]) {
      if (!app.includes(`"${modulePath}?v=${releaseVersion}"`)) {
        failures.push(`Changed application module is missing the release version: ${modulePath}`);
      }
    }
  }
}

async function checkLegalNotices() {
  const html = await readFile(join(root, "index.html"), "utf8");
  const privacy = await readFile(join(root, "privacy.html"), "utf8");
  const terms = await readFile(join(root, "terms.html"), "utf8");
  const legalCss = await readFile(join(root, "legal.css"), "utf8");

  for (const path of ["./privacy.html", "./terms.html"]) {
    if ((html.match(new RegExp(`href="${path.replace(".", "\\.")}"`, "g")) || []).length < 2) {
      failures.push(`Login and signed-in pages must both link to ${path}.`);
    }
  }
  for (const disclosure of [
    "Firebase Authentication UID",
    "https://www.googleapis.com/auth/gmail.send",
    "Gmail 접근 토큰",
    "Google API Services User Data Policy",
    "Google 계정의 서드 파티 연결 관리",
    "Cloudflare, Inc.",
    "전체 주민등록번호"
  ]) {
    if (!privacy.includes(disclosure)) failures.push(`Privacy policy disclosure is missing: ${disclosure}`);
  }
  for (const term of ["관리자와 선생님의 의무", "Google 계정과 Gmail 기능", "급여·세금·보험 계산의 성격"]) {
    if (!terms.includes(term)) failures.push(`Terms of service section is missing: ${term}`);
  }
  if (!privacy.includes('href="./terms.html"') || !terms.includes('href="./privacy.html"')) {
    failures.push("Legal notice pages must link to each other.");
  }
  if (!legalCss.includes("@media (max-width: 700px)") || !legalCss.includes("min-width: 320px")) {
    failures.push("Legal notice pages are missing mobile layout safeguards.");
  }
}

async function checkRepositorySafety() {
  const workflowPath = join(root, ".github", "workflows");
  if (await exists(workflowPath)) {
    const workflowFiles = (await walk(workflowPath)).filter((path) => [".yml", ".yaml"].includes(extname(path)));
    if (workflowFiles.length) failures.push("GitHub Actions workflow found; Pages must deploy from main/(root).");
  }

  const privatePatterns = [
    /BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY/,
    /client[_-]?secret\s*[:=]\s*["'][^"']+/i,
    /service[_-]?account\s*[:=]/i,
    /password\s*[:=]\s*["'][^"']+/i
  ];
  const textExtensions = new Set([".html", ".css", ".js", ".mjs", ".json", ".md", ".rules", ".yml", ".yaml"]);
  const files = (await walk(root)).filter((path) => textExtensions.has(extname(path)) && !path.endsWith("scripts\\qa.mjs") && !path.endsWith("scripts/qa.mjs"));
  for (const path of files) {
    const content = await readFile(path, "utf8");
    if (privatePatterns.some((pattern) => pattern.test(content))) failures.push(`Possible private credential found: ${relative(root, path)}`);
  }

  const demoData = await readFile(join(root, "src", "data", "demo-data.js"), "utf8");
  const demoEmails = demoData.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
  if (demoEmails.some((email) => !email.endsWith(".invalid"))) failures.push("Demo data contains a non-.invalid email address.");
}

async function checkDeliverySecurity() {
  const rules = await readFile(join(root, "firestore.rules"), "utf8");
  const requiredRules = [
    "match /payslipDeliveries/{deliveryId}",
    "request.resource.data.channel == 'gmail_attachment'",
    "request.resource.data.sentBy == request.auth.uid",
    "request.resource.data.sentAt == request.time"
  ];
  for (const rule of requiredRules) {
    if (!rules.includes(rule)) failures.push(`Payslip delivery security rule is missing: ${rule}`);
  }

  const store = await readFile(join(root, "src", "lib", "firebase-store.js"), "utf8");
  if (!store.includes('loadCollection("payslips")')) {
    failures.push("Admin workspace must load immutable payslip snapshots for delivery.");
  }
  if (store.includes("localStorage.setItem") && store.includes("gmailAccessToken")) {
    failures.push("Gmail OAuth token must not be persisted in localStorage.");
  }
}

async function checkLifecycleSecurity() {
  const rules = await readFile(join(root, "firestore.rules"), "utf8");
  const requiredRules = [
    "match /accessRequests/{uid}",
    "request.resource.data.email == request.auth.token.email",
    "request.resource.data.status == 'rejected'",
    "match /payslipVersions/{versionId}",
    "match /payrollCancellations/{cancellationId}",
    "request.resource.data.status == 'cancelled'",
    "request.resource.data.revision == resource.data.revision + 1"
  ];
  for (const rule of requiredRules) {
    if (!rules.includes(rule)) failures.push(`Payroll lifecycle security rule is missing: ${rule}`);
  }

  const store = await readFile(join(root, "src", "lib", "firebase-store.js"), "utf8");
  for (const operation of ["approveTeacherAccess", "rejectTeacherAccess", "updateTeacher", "deleteTeacher", "cancelPayrollRun"]) {
    if (!store.includes(`async function ${operation}`)) failures.push(`Firebase store operation is missing: ${operation}`);
  }
  const app = await readFile(join(root, "src", "app.js"), "utf8");
  for (const rejectionSurface of ["data-reject-access", "openAccessRejectionModal", 'request.status = "rejected"']) {
    if (!app.includes(rejectionSurface)) failures.push(`Access-request rejection surface is missing: ${rejectionSurface}`);
  }
  for (const resubmissionSurface of ["accessRequestAction", 'accessRequest.status === "rejected"', "승인 요청을 다시 보냈습니다"]) {
    if (!store.includes(resubmissionSurface)) failures.push(`Rejected access-request resubmission is missing: ${resubmissionSurface}`);
  }
  for (const resubmissionRule of ["resource.data.status == 'rejected'", "request.auth.uid == uid", "request.resource.data.status == 'pending'"]) {
    if (!rules.includes(resubmissionRule)) failures.push(`Rejected access-request resubmission rule is missing: ${resubmissionRule}`);
  }
  const lifecycle = await readFile(join(root, "src", "lib", "payroll-lifecycle.js"), "utf8");
  for (const deletionSurface of ["data-delete-teacher", "openTeacherDeletionModal", "teacher-delete-email", "validateTeacherDeletion"]) {
    if (!app.includes(deletionSurface)) failures.push(`Teacher deletion confirmation surface is missing: ${deletionSurface}`);
  }
  for (const safeguard of ["teacherDeletionBlockers", "급여 관련 기록이 있어 삭제할 수 없습니다", "Google 이메일을 정확히 입력"]) {
    if (!lifecycle.includes(safeguard)) failures.push(`Teacher deletion safeguard is missing: ${safeguard}`);
  }
  if ((rules.match(/allow delete: if isAdmin\(\);/g) || []).length < 2
    || !store.includes('action: "TEACHER_DELETED"')
    || !store.includes('batch.delete(firestoreSdk.doc(db, "users", teacher.authUid))')) {
    failures.push("Teacher deletion must remove the teacher portal account under admin-only rules and retain an audit log.");
  }
}

async function checkTeacherMonthlyPayroll() {
  const app = await readFile(join(root, "src", "app.js"), "utf8");
  const payroll = await readFile(join(root, "src", "lib", "payroll.js"), "utf8");
  const policies = await readFile(join(root, "src", "data", "nts-tax-policy.js"), "utf8");
  const tests = await readFile(join(root, "tests", "payroll.test.mjs"), "utf8");
  const adminNav = app.match(/const adminNav = \[([\s\S]*?)\n\];/)?.[1] || "";

  for (const field of [
    "insuranceSettings", "defaultEmployeePay", "defaultBusinessHourlyRate", "usesMultipleRates", "businessRates", "employeeGrossPay",
    "employeeWorkHours", "businessWorkLines", "transportTrips", "parkingAmount",
    "additionalEarnings", "nationalPensionBase", "healthInsuranceBase", "employmentInsuranceBase"
  ]) {
    if (!app.includes(field)) failures.push(`Teacher monthly payroll field is missing: ${field}`);
  }
  if (!app.includes('["업무", "payrollInputs"')) failures.push("Monthly payroll input navigation is missing.");
  if (adminNav.includes('"entries"') || adminNav.includes('"rates"')) {
    failures.push("Legacy class and hourly-rate pages must not be in the admin navigation.");
  }
  if (!payroll.includes("createMonthlyEarningLines") || !tests.includes("수업이 없어도") || !tests.includes("시급 항목별 금액과 수업시간을 곱해")) {
    failures.push("Monthly salary calculation must cover insured teachers without classes.");
  }
  if (!payroll.includes("floorToUnit") || !payroll.includes("rule.baseUnit") || !payroll.includes("rule.roundingUnit")) {
    failures.push("Automatic insurance calculation must apply configurable base and premium truncation units.");
  }
  if (!policies.includes("baseUnit: 1000") || !policies.includes("roundingUnit: 10") || !tests.includes("자동 사회보험료의 10원 미만을 절사")) {
    failures.push("Built-in insurance policies and regression tests must preserve official truncation behavior.");
  }
  for (const reportField of ["lectureWithholding", "additionalPaymentWithholding", "healthAndLongTermCare", "insuranceBases", "unconfirmedEarningLines"]) {
    if (!payroll.includes(reportField)) failures.push(`Accounting payroll report field is missing: ${reportField}`);
  }
  for (const heading of ["생년월일", "소득 구분", "총 지급액<br>(신고액)", "강사료 원천징수<br>(3.3%)", "교통·주차·기타<br>원천징수", "건강+요양", "보험료 합계", "실 지급액"]) {
    if (!app.includes(heading)) failures.push(`Accounting ledger column is missing: ${heading}`);
  }
  if (!payroll.includes("export function splitPayrollByIncome") || !tests.includes("혼합 급여는 근로소득과 사업소득 명세서 두 개로 분리")) {
    failures.push("Mixed employee and business income must be split with a regression-tested calculation.");
  }
  for (const splitSurface of ["ledgerItemsForMonth", "data-ledger-income", "data-payslip-type", 'documentType: "income"', "selectedPayslipType"]) {
    if (!app.includes(splitSurface)) failures.push(`Mixed-income ledger or payslip surface is missing: ${splitSurface}`);
  }
  if (!app.includes('"총 지급액(신고액)"') || !app.includes('"실 지급액"')) {
    failures.push("Accounting CSV must distinguish reported gross from the actual net payment.");
  }
  if (app.includes("추가 지급 원천징수") || app.includes("강사료 세액공제")) {
    failures.push("Ambiguous withholding labels must not remain in the application UI or CSV.");
  }
  if (app.includes("사업 시수")) failures.push("Use '수업 시수' instead of the incorrect '사업 시수' label.");
  if (app.includes("수업료")) failures.push("Use '강사료' for teacher compensation instead of '수업료'.");
  if (app.includes("CSV 파일에는 급여")) failures.push("Monthly ledger must not show the removed CSV privacy notice.");
  if (!app.includes('<th class="numeric">수업 시수</th>')) failures.push("Monthly payroll table is missing the class-hours label.");
  for (const heading of ["교통비", "주차비", "기타"]) {
    if (!app.includes(`<th class="numeric">${heading}</th>`)) {
      failures.push(`Monthly payroll table must show a separate ${heading} column.`);
    }
  }
  if (!payroll.includes("otherPaymentAmount") || !app.includes("amounts.otherPaymentAmount")) {
    failures.push("Monthly payroll input must expose transport, parking, and other payments separately.");
  }
  const rules = await readFile(join(root, "firestore.rules"), "utf8");
  if (!rules.includes("excludesResidentRegistrationNumber")) {
    failures.push("Firestore rules must reject resident-registration-number fields.");
  }
  if (!rules.includes("hasValidTeacherIdentity") || !app.includes("parseTeacherIdentity")) {
    failures.push("Teacher birth-date and gender-code validation must be enforced in UI and Firestore rules.");
  }
  if (!rules.includes("hasValidIncomeComposition") || !rules.includes("hasValidTeacherDocument")) {
    failures.push("Firestore rules must validate the complete current teacher document.");
  }
  if ((app.match(/teacherIdentityEditorHtml\(/g) || []).length !== 4
    || !app.includes('type="hidden" name="teacherIdentity"')
    || app.includes('name="birthDateCode"')
    || app.includes('name="genderCode"')) {
    failures.push("All three teacher profile forms must use the shared segmented identity editor.");
  }
  if (!app.includes('data-identity-index="6"')
    || !app.includes("teacher-identity-mask-dot")
    || !app.includes("function bindTeacherIdentityInput")
    || app.includes("생년월일·성별번호")
    || app.includes("생년월일 6자리와 성별번호 1자리만 저장합니다.")) {
    failures.push("Segmented teacher identity entry, rear-number masking, or concise labels are missing.");
  }
  const phone = await readFile(join(root, "src", "lib", "phone-number.js"), "utf8");
  if ((app.match(/mobilePhoneEditorHtml\(/g) || []).length !== 4
    || !app.includes('type="hidden" name="phone"')
    || !app.includes("normalizeMobilePhoneNumber(data.phone)")
    || !phone.includes("MOBILE_PHONE_PATTERN")
    || !phone.includes("return digits;")
    || !rules.includes("phone.matches('^010[0-9]{8}$')")
    || app.includes("<th>연락처</th>")) {
    failures.push("Teacher mobile-phone inputs must fix the 010 prefix and store only 11 digits in Firestore.");
  }
  if (app.includes("회계사 식별번호") || app.includes("validateAccountingReference")) {
    failures.push("Legacy accountant reference input must not remain in the admin UI.");
  }
  const guide = await readFile(join(root, "docs", "user-guide.md"), "utf8");
  if (!guide.includes("근로소득 명세서") || !guide.includes("교통·주차·기타 원천징수")) {
    failures.push("User guide must explain split payslips and non-lecture payment withholding.");
  }
}

async function checkTeacherSelfService() {
  const app = await readFile(join(root, "src", "app.js"), "utf8");
  const store = await readFile(join(root, "src", "lib", "firebase-store.js"), "utf8");
  const rules = await readFile(join(root, "firestore.rules"), "utf8");
  const guide = await readFile(join(root, "docs", "user-guide.md"), "utf8");

  for (const surface of ["workHours", "renderWorkHours", "openTeacherSelfProfileModal", "teacherMonthlyInputs", "openAdminNotifications", "notification-button"]) {
    if (!app.includes(surface)) failures.push(`Teacher self-service surface is missing: ${surface}`);
  }
  for (const operation of ["saveTeacherProfile", "saveTeacherMonthlyInput", "saveAdminMonthlyPayroll", "markAdminNotificationRead"]) {
    if (!store.includes(`async function ${operation}`)) failures.push(`Teacher self-service store operation is missing: ${operation}`);
  }
  for (const safeguard of [
    "match /teacherMonthlyInputs/{inputId}",
    "request.resource.data.businessHours is map",
    "monthIsEditable(request.resource.data.month)",
    "request.resource.data.diff(resource.data).affectedKeys().hasOnly"
  ]) {
    if (!rules.includes(safeguard)) failures.push(`Teacher self-service security rule is missing: ${safeguard}`);
  }
  for (const safeguard of [
    "match /adminNotifications/{notificationId}",
    "validTeacherWorkHoursNotification(notificationId)",
    "request.resource.data.type == 'teacher_monthly_input_submitted'",
    "existsAfter(/databases/$(database)/documents/teacherMonthlyInputs/$(request.resource.data.month + '_' + account().teacherId))",
    ".data.updatedAt == request.time",
    "request.resource.data.status == 'read'",
    "'status', 'readAt', 'readBy'"
  ]) {
    if (!rules.includes(safeguard)) failures.push(`Admin notification security rule is missing: ${safeguard}`);
  }
  for (const workflow of [
    'loadOptionalCollection("adminNotifications")',
    'workHoursNotificationId(input.month, input.teacherId)',
    'state.view = "payrollInputs"',
    "openMonthlyPayModal(teacher)"
  ]) {
    if (!app.includes(workflow) && !store.includes(workflow)) failures.push(`Admin notification workflow is missing: ${workflow}`);
  }
  for (const adminOnlyField of ["email", "authUid", "status", "defaultEmployeePay", "transportPolicy", "taxProfile"]) {
    const teacherUpdateRule = rules.match(/\|\| \(isOwnTeacher\(teacherId\)([\s\S]*?)\)\);/)?.[1] || "";
    if (teacherUpdateRule.includes(`'${adminOnlyField}'`)) failures.push(`Teacher self-update rule exposes admin-only field: ${adminOnlyField}`);
  }
  for (const selfField of ["insuranceSettings", "defaultBusinessHourlyRate", "usesMultipleRates", "businessRates", "profileCompleted"]) {
    const teacherUpdateRule = rules.match(/\|\| \(isOwnTeacher\(teacherId\)([\s\S]*?)\)\);/)?.[1] || "";
    if (!teacherUpdateRule.includes(`'${selfField}'`)) failures.push(`Teacher self-update rule is missing the allowed field: ${selfField}`);
  }
  for (const safeguard of ["preservesInsuranceAdministrationFields", "validBusinessRateAt", "hasValidBusinessRates", "hasValidSelfIncomeComposition"]) {
    if (!rules.includes(safeguard)) failures.push(`Teacher self-reported pay setting safeguard is missing: ${safeguard}`);
  }
  for (const onboardingSurface of ["provisionalTeacherForAccessRequest", "신규 선생님 계정 생성", "businessPayRateEditorHtml", "시급 1개 사용", "여러 시급 사용", "businessRateLabel(index)"]) {
    if (!app.includes(onboardingSurface)) failures.push(`Teacher self-onboarding surface is missing: ${onboardingSurface}`);
  }
  for (const removedSurface of ["teacher-subjects", "teacher-edit-subjects", "data-rate-subject"]) {
    if (app.includes(removedSurface)) failures.push(`Subject-based hourly-rate input must be removed: ${removedSurface}`);
  }
  for (const legacyCollection of ["rateRules", "workEntries"]) {
    if (app.includes(legacyCollection) || store.includes(`loadCollection("${legacyCollection}")`) || rules.includes(`match /${legacyCollection}/`)) {
      failures.push(`Unused legacy collection must be removed: ${legacyCollection}`);
    }
  }
  if (!guide.includes("선생님 정보와 수업시간 직접 입력")) {
    failures.push("User guide is missing the teacher self-service workflow.");
  }
}

async function checkHelpAssistantSafety() {
  const html = await readFile(join(root, "index.html"), "utf8");
  const app = await readFile(join(root, "src", "app.js"), "utf8");
  const helper = await readFile(join(root, "src", "lib", "help-assistant.js"), "utf8");
  const store = await readFile(join(root, "src", "lib", "firebase-store.js"), "utf8");
  const config = await readFile(join(root, "src", "config.js"), "utf8");

  for (const id of ["assistant-entry", "assistant-panel", "assistant-messages", "assistant-form"]) {
    if (!html.includes(`id="${id}"`)) failures.push(`AI help surface is missing: #${id}`);
  }
  for (const safeguard of ["detectSensitiveInput", "buildGeminiPrompt", "buildLocalHelpAnswer"]) {
    if (!app.includes(safeguard)) failures.push(`AI help safeguard is not connected: ${safeguard}`);
  }
  for (const label of ["이메일 주소", "휴대전화 번호", "주민등록번호", "생년월일 식별값", "계좌번호"]) {
    if (!helper.includes(label)) failures.push(`Sensitive input detector is missing: ${label}`);
  }
  if (!store.includes('import(sdk("ai"))') || !store.includes("GoogleAIBackend")) {
    failures.push("Firebase AI Logic must be loaded through the Firebase SDK proxy.");
  }
  if (/gemini(?:Api)?Key\s*:/i.test(config)) failures.push("A Gemini API key must not be stored in public client configuration.");
  if (app.includes("askHelpAssistant(state.data")) failures.push("Payroll workspace data must not be passed to the AI assistant.");
}

async function checkAuthenticationCompatibility() {
  const store = await readFile(join(root, "src", "lib", "firebase-store.js"), "utf8");
  if (store.includes("signInWithRedirect")) {
    failures.push("Google sign-in must not use cross-domain redirects on GitHub Pages.");
  }
  if (!store.includes("signInWithPopup")) {
    failures.push("Google sign-in must use the GitHub Pages-compatible popup flow.");
  }
  for (const errorCode of ["auth/popup-blocked", "auth/operation-not-supported-in-this-environment"]) {
    if (!store.includes(errorCode)) failures.push(`Google sign-in guidance is missing: ${errorCode}`);
  }
}

async function checkLocalPage() {
  const port = await reservePort();
  const server = spawn(process.execPath, [join(root, "scripts", "serve.mjs")], {
    cwd: root,
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"]
  });

  try {
    const baseUrl = `http://127.0.0.1:${port}`;
    const rootResponse = await waitForResponse(`${baseUrl}/`);
    const cssResponse = await fetch(`${baseUrl}/styles.css`);
    const appResponse = await fetch(`${baseUrl}/src/app.js`);
    const privacyResponse = await fetch(`${baseUrl}/privacy.html`);
    const termsResponse = await fetch(`${baseUrl}/terms.html`);
    const legalCssResponse = await fetch(`${baseUrl}/legal.css`);
    if (rootResponse.status !== 200) failures.push(`Local page returned HTTP ${rootResponse.status}.`);
    if (cssResponse.status !== 200) failures.push(`Local stylesheet returned HTTP ${cssResponse.status}.`);
    if (appResponse.status !== 200) failures.push(`Local application script returned HTTP ${appResponse.status}.`);
    if (privacyResponse.status !== 200) failures.push(`Local privacy policy returned HTTP ${privacyResponse.status}.`);
    if (termsResponse.status !== 200) failures.push(`Local terms of service returned HTTP ${termsResponse.status}.`);
    if (legalCssResponse.status !== 200) failures.push(`Local legal stylesheet returned HTTP ${legalCssResponse.status}.`);
    if (!(await rootResponse.text()).includes("학원 급여 포털")) failures.push("Local page is missing the application title.");
  } finally {
    server.kill();
  }
}

async function waitForResponse(url) {
  let lastError;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      return await fetch(url);
    } catch (error) {
      lastError = error;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
    }
  }
  throw lastError;
}

async function reservePort() {
  const server = createServer();
  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const { port } = server.address();
  await new Promise((resolveClose) => server.close(resolveClose));
  return port;
}

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name === ".git" || entry.name === "node_modules") continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path));
    else files.push(path);
  }
  return files;
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

