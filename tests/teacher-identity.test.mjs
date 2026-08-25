import test from "node:test";
import assert from "node:assert/strict";
import { formatTeacherIdentity, validateTeacherIdentity } from "../src/lib/teacher-identity.js";

test("생년월일 6자리와 성별번호 1자리를 분리해 검증한다", () => {
  assert.deepEqual(validateTeacherIdentity("900101", "1"), {
    birthDateCode: "900101",
    genderCode: "1"
  });
  assert.deepEqual(validateTeacherIdentity(" 010228 ", " 4 "), {
    birthDateCode: "010228",
    genderCode: "4"
  });
});

test("존재하지 않는 날짜와 전체 주민등록번호 입력을 거부한다", () => {
  assert.throws(() => validateTeacherIdentity("990230", "1"), /생년월일 6자리를 확인/);
  assert.throws(() => validateTeacherIdentity("9001011234567", "1"), /숫자 6자리/);
  assert.throws(() => validateTeacherIdentity("900101", "9"), /성별번호/);
});

test("회계용 표시값은 앞 6자리와 성별번호 1자리만 결합한다", () => {
  assert.equal(formatTeacherIdentity({ birthDateCode: "900101", genderCode: "1" }), "900101-1");
  assert.equal(formatTeacherIdentity({ birthDateCode: "900101" }), "");
});

