import test from "node:test";
import assert from "node:assert/strict";
import { createReceiptApi } from "../src/lib/receipt-api.js";

test("all receipt and notice requests include fresh App Check and login tokens", async (t) => {
  const calls = [];
  let tokenRequests = 0;
  const api = createReceiptApi("https://receipts.invalid/", async () => "test-id-token", async () => `test-app-check-${++tokenRequests}`);
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls.push({ url, ...options });
    return Response.json({ connected: true });
  });
  await api.status();
  await api.connectUrl();
  await api.connectGmailUrl();
  const payload = { month: "2026-09", revision: 1, teacherIds: ["teacher-test"] };
  await api.sendPayslipNotices(payload);
  const file = new File(["test receipt"], "test.pdf", { type: "application/pdf" });
  await api.upload(file, { teacherId: "teacher-test", month: "2026-09" });
  await api.fetchFile("receipt-test");
  await api.deleteFile("receipt-test");

  assert.deepEqual(calls.map(({ url }) => new URL(url).pathname), [
    "/integration/status", "/oauth/google/start", "/oauth/gmail/start", "/payslip-notices",
    "/receipts", "/receipts/receipt-test/file", "/receipts/receipt-test/file"
  ]);
  calls.forEach((call, index) => {
    assert.equal(call.headers.get("Authorization"), "Bearer test-id-token");
    assert.equal(call.headers.get("X-Firebase-AppCheck"), `test-app-check-${index + 1}`);
    assert.equal(new URL(call.url).search, "");
  });
  assert.equal(calls[3].headers.get("Content-Type"), "application/json");
  assert.deepEqual(JSON.parse(calls[3].body), payload);
  assert.ok(calls[4].body instanceof FormData);
  assert.equal(calls[4].body.get("file").name, "test.pdf");
  assert.equal(calls[4].headers.has("Content-Type"), false);
  assert.equal(calls[6].method, "DELETE");
});

test("App Check failures stop the request without sending or uploading", async (t) => {
  const fetchMock = t.mock.method(globalThis, "fetch", async () => assert.fail("Network must not be used"));
  const api = createReceiptApi("https://receipts.invalid", async () => "test-id-token", async () => {
    throw new Error("App Check unavailable");
  });
  await assert.rejects(api.sendPayslipNotices({}), /App Check unavailable/);
  const missing = createReceiptApi("https://receipts.invalid", async () => "test-id-token", async () => "");
  await assert.rejects(missing.status());
  assert.equal(fetchMock.mock.callCount(), 0);
});

test("Worker errors are preserved and failed sends are not automatically repeated", async (t) => {
  const api = createReceiptApi("https://receipts.invalid", async () => "test-id-token", async () => "test-app-check");
  const fetchMock = t.mock.method(globalThis, "fetch", async () => Response.json({ error: "Permission denied" }, { status: 403 }));
  await assert.rejects(api.sendPayslipNotices({}), /Permission denied/);
  assert.equal(fetchMock.mock.callCount(), 1);
});
