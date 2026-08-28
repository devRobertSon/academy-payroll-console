import test from "node:test";
import assert from "node:assert/strict";
import { driveConnectionAccess, gmailConnectionKey } from "../cloudflare/receipt-worker/src/index.js";

test("Drive 연결 전에는 모든 관리자가 최초 연결을 시작할 수 있다", () => {
  assert.deepEqual(driveConnectionAccess(null, "admin-a"), {
    connected: false,
    owner: false,
    locked: false
  });
});

test("Drive 최초 연결 관리자만 재연결할 수 있다", () => {
  const connection = { connectedBy: "admin-a" };
  assert.deepEqual(driveConnectionAccess(connection, "admin-a"), {
    connected: true,
    owner: true,
    locked: false
  });
  assert.deepEqual(driveConnectionAccess(connection, "admin-b"), {
    connected: true,
    owner: false,
    locked: true
  });
});

test("소유자 정보가 없는 기존 연결은 임의로 덮어쓰지 못한다", () => {
  assert.deepEqual(driveConnectionAccess({ encryptedRefreshToken: "legacy" }, "admin-a"), {
    connected: true,
    owner: false,
    locked: true
  });
});

test("Gmail 연결은 관리자 UID별로 분리한다", () => {
  assert.equal(gmailConnectionKey("admin-a"), "gmail_connection:admin-a");
  assert.equal(gmailConnectionKey("admin-b"), "gmail_connection:admin-b");
  assert.notEqual(gmailConnectionKey("admin-a"), gmailConnectionKey("admin-b"));
});
