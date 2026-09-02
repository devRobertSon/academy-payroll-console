import test from "node:test";
import assert from "node:assert/strict";
import { accessRequestAction, payrollRunCancellationUpdate } from "../src/lib/firebase-store.js";

test("처음 로그인한 계정은 승인 요청을 새로 만든다", () => {
  assert.equal(accessRequestAction(null), "create");
});

test("반려된 계정은 다음 로그인에서 승인 요청을 다시 보낸다", () => {
  assert.equal(accessRequestAction({ status: "rejected" }), "resubmit");
});

test("대기 또는 승인 상태는 로그인으로 덮어쓰지 않는다", () => {
  assert.equal(accessRequestAction({ status: "pending" }), "wait");
  assert.equal(accessRequestAction({ status: "approved" }), "wait");
});

test("급여 확정 취소는 Firestore 규칙이 허용한 필드만 갱신한다", () => {
  const update = payrollRunCancellationUpdate({
    month: "2026-09",
    status: "cancelled",
    revision: 1,
    cancellationId: "2026-09_v1",
    cancellationReason: "재발행 테스트",
    releaseId: "2026-09_v1",
    publishedAt: "2026-09-01T00:00:00.000Z",
    unexpectedField: true
  }, {
    cancelledAt: "server-time",
    updatedAt: "server-time",
    updatedBy: "admin-uid"
  });

  assert.deepEqual(Object.keys(update).sort(), [
    "cancellationId",
    "cancellationReason",
    "cancelledAt",
    "revision",
    "status",
    "updatedAt",
    "updatedBy"
  ].sort());
  assert.equal(update.status, "cancelled");
  assert.equal(update.revision, 1);
});
