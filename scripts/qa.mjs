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
await checkRepositorySafety();
await checkDeliverySecurity();
await checkLifecycleSecurity();
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
    "src/app.js",
    "src/config.js",
    "firestore.rules",
    "storage.rules",
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
  const localReferences = [...html.matchAll(/(?:href|src)="\.\/([^"?#]+)["?#]?/g)].map((match) => match[1]);
  for (const reference of localReferences) {
    if (!(await exists(join(root, reference)))) failures.push(`index.html references a missing file: ${reference}`);
  }
  for (const id of ["login-view", "workspace", "page-content", "modal-root"]) {
    if (!html.includes(`id="${id}"`)) failures.push(`Required application surface is missing: #${id}`);
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
    "match /payslipVersions/{versionId}",
    "match /payrollCancellations/{cancellationId}",
    "request.resource.data.status == 'cancelled'",
    "request.resource.data.revision == resource.data.revision + 1"
  ];
  for (const rule of requiredRules) {
    if (!rules.includes(rule)) failures.push(`Payroll lifecycle security rule is missing: ${rule}`);
  }

  const store = await readFile(join(root, "src", "lib", "firebase-store.js"), "utf8");
  for (const operation of ["approveTeacherAccess", "updateTeacher", "cancelPayrollRun"]) {
    if (!store.includes(`async function ${operation}`)) failures.push(`Firebase store operation is missing: ${operation}`);
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
    if (rootResponse.status !== 200) failures.push(`Local page returned HTTP ${rootResponse.status}.`);
    if (cssResponse.status !== 200) failures.push(`Local stylesheet returned HTTP ${cssResponse.status}.`);
    if (appResponse.status !== 200) failures.push(`Local application script returned HTTP ${appResponse.status}.`);
    if (!(await rootResponse.text()).includes("Academy Payroll Console")) failures.push("Local page is missing the application title.");
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
