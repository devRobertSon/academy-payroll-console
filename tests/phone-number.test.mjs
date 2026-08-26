import test from "node:test";
import assert from "node:assert/strict";
import {
  formatMobilePhoneNumber,
  mobilePhoneParts,
  normalizeMobilePhoneNumber,
  phoneDigits
} from "../src/lib/phone-number.js";

test("010 휴대전화 번호만 화면용 하이픈 형식으로 표시한다", () => {
  assert.equal(formatMobilePhoneNumber("01012345678"), "010-1234-5678");
  assert.equal(formatMobilePhoneNumber("010-1234-5678"), "010-1234-5678");
  assert.equal(formatMobilePhoneNumber("0212345678"), "");
  assert.deepEqual(mobilePhoneParts("010-1234-5678"), { middle: "1234", last: "5678" });
});

test("Firestore 저장값은 하이픈 없는 010 숫자 11자리다", () => {
  assert.equal(normalizeMobilePhoneNumber(""), "");
  assert.equal(normalizeMobilePhoneNumber("010-1234-5678"), "01012345678");
  assert.equal(phoneDigits("010-12가34-5678"), "01012345678");
});

test("010이 아니거나 완성되지 않은 휴대전화 번호를 거부한다", () => {
  assert.throws(() => normalizeMobilePhoneNumber("0101234"), /숫자 8자리/);
  assert.throws(() => normalizeMobilePhoneNumber("01112345678"), /010 뒤/);
  assert.throws(() => normalizeMobilePhoneNumber("0212345678"), /010 뒤/);
});
