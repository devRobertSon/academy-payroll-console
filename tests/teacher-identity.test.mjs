import test from "node:test";
import assert from "node:assert/strict";
import {
  formatTeacherIdentity,
  parseOptionalTeacherIdentity,
  parseTeacherIdentity,
  validateOptionalTeacherIdentity,
  validateTeacherIdentity
} from "../src/lib/teacher-identity.js";

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

test("한 칸의 생년월일·성별번호를 900101-1 형식으로 분리한다", () => {
  assert.deepEqual(parseTeacherIdentity("900101-1"), {
    birthDateCode: "900101",
    genderCode: "1"
  });
  assert.deepEqual(parseTeacherIdentity(" 010228-4 "), {
    birthDateCode: "010228",
    genderCode: "4"
  });
  assert.throws(() => parseTeacherIdentity("9001011"), /900101-1 형식/);
  assert.throws(() => parseTeacherIdentity("990230-1"), /생년월일 6자리를 확인/);
});

test("신규 등록 때 식별정보를 비워 두고 선생님이 나중에 입력할 수 있다", () => {
  assert.deepEqual(validateOptionalTeacherIdentity("", ""), {});
  assert.deepEqual(validateOptionalTeacherIdentity("900101", "1"), {
    birthDateCode: "900101",
    genderCode: "1"
  });
  assert.throws(() => validateOptionalTeacherIdentity("900101", ""), /성별번호/);
  assert.deepEqual(parseOptionalTeacherIdentity(""), {});
  assert.deepEqual(parseOptionalTeacherIdentity("900101-1"), {
    birthDateCode: "900101",
    genderCode: "1"
  });
});

