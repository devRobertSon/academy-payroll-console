import test from "node:test";
import assert from "node:assert/strict";
import { accessRequestAction } from "../src/lib/firebase-store.js";

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
