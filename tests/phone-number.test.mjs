import test from "node:test";
import assert from "node:assert/strict";
import {
  formatKoreanPhoneNumber,
  normalizePhoneNumber,
  phoneDigits
} from "../src/lib/phone-number.js";

test("휴대전화 번호에 하이픈을 자동 표시한다", () => {
  assert.equal(formatKoreanPhoneNumber("01012345678"), "010-1234-5678");
  assert.equal(formatKoreanPhoneNumber("010-1234-5678"), "010-1234-5678");
  assert.equal(formatKoreanPhoneNumber("010abc1234 5678"), "010-1234-5678");
});

test("지역번호와 대표번호 형식을 구분한다", () => {
  assert.equal(formatKoreanPhoneNumber("0212345678"), "02-1234-5678");
  assert.equal(formatKoreanPhoneNumber("021235678"), "02-123-5678");
  assert.equal(formatKoreanPhoneNumber("15881234"), "1588-1234");
  assert.equal(formatKoreanPhoneNumber("050512345678"), "0505-1234-5678");
});

test("저장할 때 완성되지 않은 연락처를 거부한다", () => {
  assert.equal(normalizePhoneNumber(""), "");
  assert.equal(normalizePhoneNumber("01012345678"), "010-1234-5678");
  assert.throws(() => normalizePhoneNumber("0101234"), /전체 번호/);
  assert.equal(phoneDigits("010-12가34-5678"), "01012345678");
});
