import test from "node:test";
import assert from "node:assert/strict";
import { helpArticles } from "../src/data/help-content.js";
import { buildGeminiPrompt, buildLocalHelpAnswer, detectSensitiveInput, searchHelpArticles } from "../src/lib/help-assistant.js";

test("명세서 이메일 질문에는 개인 명세서 전달 안내를 우선 제시한다", () => {
  const [result] = searchHelpArticles("선생님 급여명세서를 이메일로 보내려면?", helpArticles);
  assert.equal(result.id, "payslip-delivery");
});

test("일반적인 급여월 질문은 개인정보로 잘못 차단하지 않는다", () => {
  assert.deepEqual(detectSensitiveInput("2026년 8월 급여명세서는 어디서 출력하나요?"), []);
});

test("이메일과 주민등록번호 형태를 외부 AI 전송 전에 감지한다", () => {
  const detected = detectSensitiveInput("teacher@example.com 900101-1234567");
  assert.deepEqual(detected, ["이메일 주소", "주민등록번호"]);
});

test("개인정보가 포함된 질문에는 로컬에서도 삭제 안내를 반환한다", () => {
  const answer = buildLocalHelpAnswer("010-1234-5678로 명세서를 보내 줘", helpArticles);
  assert.match(answer, /AI 도움말로 보내지 않았습니다/);
});

test("Gemini 프롬프트에는 현재 화면과 관련 설명서만 포함한다", () => {
  const prompt = buildGeminiPrompt("CSV 업로드 방법", helpArticles, "수업 내역");
  assert.match(prompt, /현재 화면: 수업 내역/);
  assert.match(prompt, /수업 내역 입력과 CSV 업로드/);
  assert.doesNotMatch(prompt, /teacher@example.com/);
});

