import assert from "node:assert/strict";
import test from "node:test";

import { buildGmailMessage } from "../src/lib/gmail.js";
import { payslipFilename } from "../src/lib/payslip-file.js";

test("Gmail 메시지는 한글 본문과 PDF를 MIME 첨부로 인코딩한다", () => {
  const pdf = new TextEncoder().encode("%PDF-1.7 sample");
  const raw = buildGmailMessage({
    to: "teacher@example.com",
    subject: "2026년 8월 급여명세서",
    body: "안녕하세요. 첨부 파일을 확인해 주세요.",
    attachmentName: "샘플학원-2026-08-홍길동-급여명세서.pdf",
    attachmentBytes: pdf,
    boundary: "academy-payroll-test"
  });
  const mime = Buffer.from(raw.replaceAll("-", "+").replaceAll("_", "/"), "base64").toString("utf8");

  assert.match(mime, /^To: teacher@example\.com\r\n/);
  assert.match(mime, /Content-Type: multipart\/mixed/);
  assert.match(mime, /Content-Type: application\/pdf/);
  assert.match(mime, /filename\*=UTF-8''%EC%83%98%ED%94%8C/);
  assert.ok(mime.includes(Buffer.from(pdf).toString("base64")));
  assert.ok(mime.includes(Buffer.from("안녕하세요. 첨부 파일을 확인해 주세요.").toString("base64")));
  assert.match(mime, /--academy-payroll-test--\r\n$/);
});

test("메일 헤더 줄바꿈 삽입을 거부한다", () => {
  assert.throws(() => buildGmailMessage({
    to: "teacher@example.com\r\nBcc: outsider@example.com",
    subject: "급여명세서",
    body: "본문",
    attachmentName: "payslip.pdf",
    attachmentBytes: new Uint8Array([1]),
    boundary: "academy-payroll-test"
  }), /줄바꿈/);
});

test("급여명세서 PDF 파일명에서 운영체제 금지 문자를 제거한다", () => {
  assert.equal(
    payslipFilename("샘플/학원", "홍:길동", "2026-08"),
    "샘플-학원-2026-08-홍-길동-급여명세서.pdf"
  );
  assert.equal(
    payslipFilename("샘플/학원", "홍:길동", "2026-08", "사업소득"),
    "샘플-학원-2026-08-홍-길동-사업소득-급여명세서.pdf"
  );
});
