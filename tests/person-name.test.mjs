import test from "node:test";
import assert from "node:assert/strict";
import { normalizePersonName, sanitizePersonNameInput } from "../src/lib/person-name.js";

test("이름 입력에는 한글·영문과 단어 사이 공백만 남긴다", () => {
  assert.equal(sanitizePersonNameInput(" 홍123 길!동 "), "홍 길동 ");
  assert.equal(sanitizePersonNameInput("Jane  D0e"), "Jane De");
});

test("저장할 이름은 한글 또는 영문 이름이어야 한다", () => {
  assert.equal(normalizePersonName("  홍 길동  "), "홍 길동");
  assert.equal(normalizePersonName("Jane Doe"), "Jane Doe");
  assert.throws(() => normalizePersonName("1234"), /한글 또는 영문/);
  assert.throws(() => normalizePersonName(""), /한글 또는 영문/);
});
