import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { artifactRevision, cancellationActorName } from "../src/lib/payroll-lifecycle.js";
import { escapeHtml } from "../src/lib/format.js";

const app = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
const store = await readFile(new URL("../src/lib/firebase-store.js", import.meta.url), "utf8");
const admin = { uid: "admin-current", role: "admin", name: "Current Admin", displayName: "Current Admin" };

function storeFunction(name, context) {
  const start = store.indexOf(`  async function ${name}(`);
  const end = store.indexOf("\n  async function ", start + 1);
  assert.ok(start > 0 && end > start);
  return vm.runInNewContext(`${store.slice(start, end)}\n${name}`, context);
}

test("stored actor name takes precedence after an account is renamed", () => {
  assert.equal(cancellationActorName({ actorUid: admin.uid, actorName: " Former Name " }, admin), "Former Name");
});

test("legacy history resolves only the matching account or teacher", () => {
  assert.equal(cancellationActorName({ actorUid: admin.uid }, admin), "Current Admin");
  assert.equal(cancellationActorName({ actorUid: "other" }, admin), "관리자");
  assert.equal(cancellationActorName({ actorUid: "other" }, null, [{ authUid: "other", name: "Linked Teacher" }]), "Linked Teacher");
  assert.equal(cancellationActorName({ actorUid: admin.uid }, admin, [{ authUid: admin.uid, name: "Teacher Alias" }]), "Current Admin");
});

test("missing names never fall back to a UID or email address", () => {
  for (const actorName of [undefined, null, "", "  ", 42, admin.uid, "admin@example.invalid"]) {
    assert.equal(cancellationActorName({ actorUid: admin.uid, actorName }), "관리자");
  }
  assert.equal(cancellationActorName({ actorUid: admin.uid }, { uid: admin.uid, name: "admin@example.invalid" }), "관리자");
  assert.equal(cancellationActorName({}, admin, [{ name: "Unlinked Teacher" }]), "관리자");
});

test("legacy name lookup is read-only and deduplicated by actor UID", async () => {
  const reads = [];
  const load = storeFunction("loadCancellationNames", {
    db: {}, cancellationActorName, console,
    firestoreSdk: {
      doc: (_db, collection, uid) => `${collection}/${uid}`,
      getDoc: async (path) => {
        reads.push(path);
        return { exists: () => true, data: () => ({ displayName: "Other Admin", status: "inactive" }) };
      }
    }
  });
  const history = [
    { id: "old-1", actorUid: "other", reason: "First reason" },
    { id: "old-2", actorUid: "other", reason: "Second reason" },
    { id: "current", actorUid: admin.uid },
    { id: "snapshot", actorUid: "removed", actorName: "Saved Name" }
  ];
  const original = structuredClone(history);
  const loaded = await load(history, admin, []);
  assert.deepEqual(reads, ["users/other"]);
  assert.deepEqual(Array.from(loaded, (item) => item.actorName), ["Other Admin", "Other Admin", "Current Admin", "Saved Name"]);
  assert.deepEqual(history, original);
  assert.equal(loaded[0].actorUid, "other");
  assert.equal(loaded[1].reason, "Second reason");
});

test("deleted accounts and failed optional lookups do not block the workspace", async () => {
  let warnings = 0;
  const load = storeFunction("loadCancellationNames", {
    db: {}, cancellationActorName, console: { warn: () => warnings++ },
    firestoreSdk: {
      doc: (_db, _collection, uid) => uid,
      getDoc: async (uid) => {
        if (uid === "offline") throw new Error("unavailable");
        return { exists: () => false };
      }
    }
  });
  const loaded = await load([{ actorUid: "deleted" }, { actorUid: "offline" }, {}], admin,
    [{ authUid: "deleted", name: "Retained Teacher" }]);
  assert.deepEqual(Array.from(loaded, (item) => item.actorName), ["Retained Teacher", "관리자", "관리자"]);
  assert.equal(warnings, 1);
});

test("only the administrator workspace loads cancellation actor names", async () => {
  const lookups = [];
  const load = storeFunction("loadWorkspace", {
    db: {}, loadCollection: async () => [],
    loadCancellationNames: async (items, user) => { lookups.push(user.uid); return [{ actorName: "Resolved Name" }]; },
    firestoreSdk: { where: (...args) => args }
  });
  const adminWorkspace = await load(admin);
  assert.equal(adminWorkspace.payrollCancellations[0].actorName, "Resolved Name");
  const teacherWorkspace = await load({ uid: "teacher", role: "teacher" });
  assert.equal(teacherWorkspace.payrollCancellations, undefined);
  assert.deepEqual(lookups, [admin.uid]);
});

test("the dashboard renders escaped names rather than raw actor UIDs", () => {
  const template = app.split(/\r?\n/).find((line) => line.includes("취소·재발행 이력"));
  assert.ok(template);
  const html = vm.runInNewContext(`\`${template.trim()}\``, {
    cancellations: [
      { actorUid: "uid-must-not-render", actorName: "<b>Admin</b>", revision: 1, reason: "Correction" },
      { actorUid: admin.uid, revision: 2, reason: "Correction" }
    ],
    state: { user: admin, data: { teachers: [] } }, e: escapeHtml,
    cancellationActorName, formatDateTime: () => "2026-09-18"
  });
  assert.match(html, /&lt;b&gt;Admin&lt;\/b&gt;/);
  assert.match(html, /Current Admin/);
  assert.doesNotMatch(html, /uid-must-not-render|admin-current|<b>Admin<\/b>/);
});

test("new cancellations preserve UID and snapshot the administrator name", async () => {
  let submit;
  let saved;
  const currentRun = { month: "2026-09", status: "published", revision: 1 };
  const state = {
    month: currentRun.month, user: admin,
    data: {
      teachers: [], payrollRuns: [currentRun], payrollCancellations: [],
      payslips: [{ id: "payslip", teacherId: "teacher", teacherUid: "teacher-uid", month: currentRun.month, status: "published" }],
      payslipVersions: []
    },
    store: { cancelPayrollRun: async (...args) => { saved = args; } }
  };
  const start = app.indexOf("function openCancelPayrollModal()");
  const end = app.indexOf("\nfunction openModal(", start);
  const open = vm.runInNewContext(`${app.slice(start, end)}\nopenCancelPayrollModal`, {
    state, cancellationActorName, artifactRevision, runForMonth: () => currentRun,
    teacherById: () => null, formatMonth: (month) => month,
    openModal: (_title, _body, _label, callback) => { submit = callback; },
    elements: { modalRoot: { querySelector: () => ({ reportValidity: () => true, elements: { confirmed: { checked: true } } }) } },
    FormData: class { get() { return "Monthly salary correction"; } },
    crypto: { randomUUID: () => "audit-id" }, showToast: () => {}, renderDashboard: () => {}
  });
  open();
  await submit();
  assert.equal(saved[3].data.actorUid, admin.uid);
  assert.equal(saved[3].data.actorName, "Current Admin");
  assert.equal(saved[4].data.actorName, "Current Admin");
  assert.equal(state.data.payrollCancellations[0].actorName, "Current Admin");
  assert.equal(state.data.payrollCancellations[0].reason, "Monthly salary correction");
});

test("cancellation persistence includes the saved actor name without changing old history", async () => {
  const writes = [];
  const batch = {
    set: (path, data) => writes.push({ path, data }),
    update: () => {}, commit: async () => {}
  };
  const cancel = storeFunction("cancelPayrollRun", {
    db: {}, auth: { currentUser: admin }, payrollRunCancellationUpdate: () => ({}),
    firestoreSdk: { writeBatch: () => batch, serverTimestamp: () => "server-time", doc: (_db, collection, id) => `${collection}/${id}` }
  });
  await cancel({ month: "2026-09" }, [], [], {
    id: "2026-09_v1", data: { actorUid: admin.uid, actorName: "Current Admin", reason: "Correction" }
  }, { id: "audit", data: { actorUid: admin.uid, actorName: "Current Admin" } });
  const saved = writes.find((item) => item.path === "payrollCancellations/2026-09_v1");
  assert.equal(saved.data.actorName, "Current Admin");
  assert.equal(saved.data.actorUid, admin.uid);
  assert.equal(saved.data.createdAt, "server-time");
  assert.equal(writes.length, 2);
});
