import assert from "node:assert/strict";
import test from "node:test";

import {
  pendingPortalNoticeTeachers,
  PORTAL_NOTICE_CHANNEL,
  portalNoticeDeliveryId
} from "../src/lib/payslip-notifications.js";
import { buildPortalNoticeMessage } from "../cloudflare/receipt-worker/src/index.js";

test("현재 급여월과 발행 차수에서 아직 안내하지 않은 선생님만 고른다", () => {
  const payrolls = [
    { teacher: { id: "t1", email: "one@example.com" } },
    { teacher: { id: "t2", email: "two@example.com" } },
    { teacher: { id: "t3", email: "invalid" } }
  ];
  const deliveries = [
    { teacherId: "t1", month: "2026-08", revision: 2, channel: PORTAL_NOTICE_CHANNEL },
    { teacherId: "t2", month: "2026-08", revision: 1, channel: PORTAL_NOTICE_CHANNEL },
    { teacherId: "t2", month: "2026-08", revision: 2, channel: "gmail_attachment" }
  ];

  assert.deepEqual(
    pendingPortalNoticeTeachers(payrolls, deliveries, "2026-08", 2).map((teacher) => teacher.id),
    ["t2"]
  );
  assert.equal(portalNoticeDeliveryId("2026-08", "t2", 2), "portal-notice_2026-08_t2_v2");
});

test("Worker 안내 메일은 급여액 없이 포털 링크와 수정 차수를 담는다", () => {
  const raw = buildPortalNoticeMessage({
    to: "teacher@example.com",
    teacherName: "홍길동",
    month: "2026-08",
    revision: 2,
    academyName: "알파학원",
    portalUrl: "https://payroll.robertson.kr"
  });
  const mime = Buffer.from(raw.replaceAll("-", "+").replaceAll("_", "/"), "base64").toString("utf8");
  const bodyValue = mime.split("\r\n\r\n")[1].replace(/\s/g, "");
  const body = Buffer.from(bodyValue, "base64").toString("utf8");

  assert.match(mime, /^To: teacher@example\.com\r\n/);
  assert.match(mime, new RegExp(Buffer.from("알파학원에서 보낸 2026년 8월 급여명세서 수정 2차").toString("base64")));
  assert.match(body, /알파학원에서 보낸 2026년 8월 급여명세서 수정 2차/);
  assert.match(body, /https:\/\/payroll\.robertson\.kr/);
  assert.doesNotMatch(body, /\d[\d,]*원|지급액|공제액/);
});

test("Worker 안내 메일은 헤더 줄바꿈 삽입을 거부한다", () => {
  assert.throws(() => buildPortalNoticeMessage({
    to: "teacher@example.com\r\nBcc: outsider@example.com",
    teacherName: "홍길동",
    month: "2026-08",
    revision: 1,
    academyName: "알파학원",
    portalUrl: "https://payroll.robertson.kr"
  }), /이메일 형식/);
});
