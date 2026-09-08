import test from "node:test";
import assert from "node:assert/strict";
import worker from "../cloudflare/receipt-worker/src/index.js";

const PROJECT = "app-check-test";
const UID = "test-user";
const APP_CHECK = "test-app-check-token";
const ORIGIN = "https://payroll.invalid";
const MONTH = "2026-09";
const RECEIPT_ID = "00000000-0000-4000-8000-000000000001";
const PREFIX = `projects/${PROJECT}/databases/(default)/documents/`;
const keys = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
const jwk = { ...await crypto.subtle.exportKey("jwk", keys.publicKey), kid: "test-key" };
const now = Math.floor(Date.now() / 1000);
const unsignedToken = [
  { alg: "RS256", kid: jwk.kid },
  { sub: UID, aud: PROJECT, iss: `https://securetoken.google.com/${PROJECT}`, iat: now, exp: now + 3600 }
].map((value) => Buffer.from(JSON.stringify(value)).toString("base64url")).join(".");
const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", keys.privateKey, new TextEncoder().encode(unsignedToken));
const ID_TOKEN = `${unsignedToken}.${Buffer.from(signature).toString("base64url")}`;

// All identities, encrypted values and remote responses in this file are local fixtures.
const encryptionSecret = "local-only-app-check-fixture-key";
const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(encryptionSecret));
const encryptionKey = await crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt"]);
const iv = crypto.getRandomValues(new Uint8Array(12));
const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, encryptionKey, new TextEncoder().encode("test-refresh-token"));
const encryptedRefreshToken = `${Buffer.from(iv).toString("base64")}.${Buffer.from(encrypted).toString("base64")}`;

function fields(data) {
  return Object.fromEntries(Object.entries(data).map(([key, value]) => [key,
    typeof value === "number" ? { integerValue: String(value) } : { stringValue: value }
  ]));
}

function fixture(t, { role = "admin", rejectAppCheck = false, rejectPath = null, receiptOwner = UID, receiptStatus = "pending", published = false } = {}) {
  const documents = {
    [`users/${UID}`]: { role, status: "active", teacherId: "teacher-test" },
    [`payrollRuns/${MONTH}`]: { status: published ? "published" : "draft", revision: 1 },
    "teachers/teacher-test": { name: "Test Teacher", email: "teacher@example.invalid" },
    [`payslips/${MONTH}_teacher-test`]: { status: "published", revision: 1 },
    [`expenseReceipts/${RECEIPT_ID}`]: {
      teacherUid: receiptOwner, teacherId: "teacher-test", status: receiptStatus, month: MONTH,
      fileId: "test-file", fileName: "test.pdf", mimeType: "application/pdf"
    }
  };
  const values = new Map([
    ["drive_connection", { connectedBy: UID, rootFolderId: "test-root", encryptedRefreshToken }],
    [`gmail_connection:${UID}`, { senderEmail: "admin@example.invalid", encryptedRefreshToken }]
  ]);
  const firestoreCalls = [];
  const googleCalls = [];
  t.mock.method(console, "error", () => {});
  t.mock.method(globalThis, "fetch", async (input, options = {}) => {
    const url = new URL(input);
    const headers = new Headers(options.headers);
    if (url.hostname === "firestore.googleapis.com") {
      assert.equal(headers.get("Authorization"), `Bearer ${ID_TOKEN}`);
      assert.equal(headers.get("X-Firebase-AppCheck"), APP_CHECK);
      const path = url.pathname.split("/documents/")[1] || "batchGet";
      firestoreCalls.push(path);
      if (rejectAppCheck || path === rejectPath) return Response.json({ error: { status: "PERMISSION_DENIED" } }, { status: 403 });
      if (path === "batchGet") {
        return Response.json(JSON.parse(options.body).documents.map((name) => ({ found: { name, fields: fields(documents[name.slice(PREFIX.length)]) } })));
      }
      return documents[path] ? Response.json({ fields: fields(documents[path]) }) : new Response(null, { status: 404 });
    }
    assert.equal(headers.has("X-Firebase-AppCheck"), false, "Do not forward App Check to Drive, Gmail or OAuth");
    if (url.pathname.includes("/service_accounts/v1/jwk/")) return Response.json({ keys: [jwk] });
    googleCalls.push({ url: String(url), method: options.method || "GET" });
    if (url.hostname === "oauth2.googleapis.com") return Response.json({ access_token: "test-google-access-token" });
    assert.equal(headers.get("Authorization"), "Bearer test-google-access-token");
    if (url.pathname === "/drive/v3/files/test-file") {
      return options.method === "DELETE" ? new Response(null, { status: 204 }) : new Response("test receipt", { headers: { "Content-Type": "application/pdf" } });
    }
    if (url.pathname === "/drive/v3/files") return Response.json({ files: [{ id: "test-folder" }] });
    if (url.pathname === "/upload/drive/v3/files") return Response.json({ id: "test-file" });
    if (url.hostname === "gmail.googleapis.com") return Response.json({ id: "test-message" });
    assert.fail(`Unexpected request: ${url}`);
  });
  const env = {
    FIREBASE_PROJECT_ID: PROJECT, APP_ORIGIN: ORIGIN, API_ORIGIN: "https://receipts.invalid",
    GOOGLE_CLIENT_ID: "test-client", GOOGLE_CLIENT_SECRET: "test-client-secret", TOKEN_ENCRYPTION_KEY: encryptionSecret,
    RECEIPT_KV: {
      async get(key) { return structuredClone(values.get(key) || null); },
      async put(key, value) { values.set(key, JSON.parse(value)); }
    }
  };
  return { env, firestoreCalls, googleCalls, values };
}

function request(path, options = {}, appCheck = APP_CHECK) {
  return new Request(`https://receipts.invalid${path}`, {
    ...options,
    headers: {
      Origin: ORIGIN, Authorization: `Bearer ${ID_TOKEN}`,
      ...(appCheck ? { "X-Firebase-AppCheck": appCheck } : {}), ...options.headers
    }
  });
}

function uploadRequest() {
  const form = new FormData();
  form.set("file", new File(["test receipt"], "test.pdf", { type: "application/pdf" }));
  Object.entries({ receiptId: RECEIPT_ID, teacherId: "teacher-test", month: MONTH, category: "parking" }).forEach(([key, value]) => form.set(key, value));
  return request("/receipts", { method: "POST", body: form });
}

function noticeRequest() {
  return request("/payslip-notices", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ month: MONTH, revision: 1, teacherIds: ["teacher-test"] })
  });
}

const actions = [
  { name: "upload", request: uploadRequest, options: { role: "teacher" }, path: `payrollRuns/${MONTH}`, status: 201 },
  { name: "read", request: () => request(`/receipts/${RECEIPT_ID}/file`), options: { role: "teacher" }, path: `expenseReceipts/${RECEIPT_ID}`, status: 200 },
  { name: "delete", request: () => request(`/receipts/${RECEIPT_ID}/file`, { method: "DELETE" }), options: { role: "teacher" }, path: `payrollRuns/${MONTH}`, status: 200 },
  { name: "automatic notice", request: noticeRequest, options: { published: true }, path: "batchGet", status: 200 }
];

test("a payroll-linked administrator can upload own receipts without losing Gmail access", async (t) => {
  const { env, values } = fixture(t, { role: "admin" });
  const upload = await worker.fetch(uploadRequest(), env);
  assert.equal(upload.status, 201, await upload.clone().text());
  const status = await worker.fetch(request("/integration/status"), env);
  assert.equal(status.status, 200);
  assert.equal((await status.json()).gmailSenderEmail, "admin@example.invalid");
  assert.ok(values.has(`gmail_connection:${UID}`));
});

test("CORS allows App Check for the portal but not arbitrary origins", async (t) => {
  const { env, firestoreCalls } = fixture(t);
  const response = await worker.fetch(request("/receipts", { method: "OPTIONS" }, ""), env);
  assert.equal(response.status, 204);
  assert.match(response.headers.get("Access-Control-Allow-Headers"), /X-Firebase-AppCheck/);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), ORIGIN);
  const denied = await worker.fetch(request("/receipts", { method: "OPTIONS", headers: { Origin: "https://other.invalid" } }), env);
  assert.equal(denied.headers.has("Access-Control-Allow-Origin"), false);
  const health = await worker.fetch(new Request("https://receipts.invalid/health"), env);
  assert.equal(health.status, 200);
  assert.equal(firestoreCalls.length, 0);
});

test("a missing App Check token is rejected before accessing any data", async (t) => {
  const { env, firestoreCalls, googleCalls } = fixture(t);
  const response = await worker.fetch(request("/integration/status", {}, ""), env);
  assert.equal(response.status, 401);
  assert.equal(firestoreCalls.length, 0);
  assert.equal(googleCalls.length, 0);
});

test("App Check does not replace Firebase login verification", async (t) => {
  const { env, firestoreCalls, googleCalls } = fixture(t);
  const response = await worker.fetch(request("/integration/status", { headers: { Authorization: "Bearer invalid" } }), env);
  assert.equal(response.status, 401);
  assert.equal(firestoreCalls.length, 0);
  assert.equal(googleCalls.length, 0);
});

test("integration status forwards App Check and preserves connection ownership", async (t) => {
  const { env, firestoreCalls, googleCalls } = fixture(t);
  const response = await worker.fetch(request("/integration/status"), env);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    connected: true, driveConnected: true, driveConnectionOwner: true, driveConnectionLocked: false,
    gmailConnected: true, gmailSenderEmail: "admin@example.invalid"
  });
  assert.deepEqual(firestoreCalls, [`users/${UID}`]);
  assert.equal(googleCalls.length, 0);
});

for (const action of actions) {
  test(`${action.name} forwards App Check on every Firestore request`, async (t) => {
    const { env, firestoreCalls, googleCalls, values } = fixture(t, action.options);
    const response = await worker.fetch(action.request(), env);
    assert.equal(response.status, action.status, await response.clone().text());
    assert.equal(firestoreCalls[0], `users/${UID}`);
    assert.ok(firestoreCalls.includes(action.path));
    assert.ok(googleCalls.length > 0);
    if (action.name === "read") assert.equal(await response.text(), "test receipt");
    if (action.name === "automatic notice") {
      assert.equal((await response.json()).results[0].status, "sent");
      assert.equal(values.get(`mail_delivery:${MONTH}:1:teacher-test`).gmailMessageId, "test-message");
      const again = await worker.fetch(action.request(), env);
      assert.equal((await again.json()).results[0].status, "already_sent");
      assert.equal(googleCalls.filter(({ url }) => url.includes("gmail.googleapis.com")).length, 1);
    }
  });

  test(`${action.name} stops if Firestore rejects App Check at authentication`, async (t) => {
    const { env, googleCalls, values } = fixture(t, { ...action.options, rejectAppCheck: true });
    const response = await worker.fetch(action.request(), env);
    assert.equal(response.status, 403);
    assert.equal(googleCalls.length, 0);
    assert.equal(values.size, 2);
  });

  test(`${action.name} stops if the later Firestore lookup is denied`, async (t) => {
    const { env, googleCalls, values } = fixture(t, { ...action.options, rejectPath: action.path });
    const response = await worker.fetch(action.request(), env);
    assert.equal(response.status, 403);
    assert.equal(googleCalls.length, 0);
    assert.equal(values.size, 2);
  });
}

test("a valid App Check token does not let a teacher read another teacher's receipt", async (t) => {
  const { env, googleCalls } = fixture(t, { role: "teacher", receiptOwner: "other-user" });
  const response = await worker.fetch(request(`/receipts/${RECEIPT_ID}/file`), env);
  assert.equal(response.status, 403);
  assert.equal(googleCalls.length, 0);
});

test("teachers cannot send automatic notices even with a valid App Check token", async (t) => {
  const { env, googleCalls } = fixture(t, { role: "teacher" });
  assert.equal((await worker.fetch(noticeRequest(), env)).status, 403);
  assert.equal(googleCalls.length, 0);
});

test("approved receipt files remain restricted to administrators", async (t) => {
  const { env, googleCalls } = fixture(t, { role: "teacher", receiptStatus: "approved" });
  const response = await worker.fetch(request(`/receipts/${RECEIPT_ID}/file`), env);
  assert.equal(response.status, 403);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), ORIGIN);
  assert.ok((await response.json()).error);
  assert.equal(googleCalls.length, 0);
});

test("published payroll still prevents receipt uploads", async (t) => {
  const { env, googleCalls } = fixture(t, { role: "teacher", published: true });
  assert.equal((await worker.fetch(uploadRequest(), env)).status, 409);
  assert.equal(googleCalls.length, 0);
});
