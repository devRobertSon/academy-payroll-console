import test from "node:test";
import assert from "node:assert/strict";
import { helpArticles } from "../src/data/help-content.js";
import { buildGeminiPrompt, buildLocalHelpAnswer, detectSensitiveInput, searchHelpArticles } from "../src/lib/help-assistant.js";

test("관리자 본인 급여 질문은 계정 연결과 화면 전환 안내를 먼저 제시한다", () => {
  const question = "관리자도 같은 계정으로 내 급여를 등록하려면?";
  const [result] = searchHelpArticles(question, helpArticles);
  assert.equal(result.id, "admin-own-payroll");
  const answer = buildLocalHelpAnswer(question, helpArticles);
  assert.match(answer, /선생님 관리에서 내 급여 등록/);
  assert.match(answer, /관리 업무/);
  assert.match(answer, /별도 Google 계정이나 UID 입력은 필요하지 않습니다/);
});

test("혼합 안내는 소득 구분과 강사료 계산 방식을 구별한다", () => {
  const article = helpArticles.find((item) => item.id === "teacher-pay-configuration");
  const text = article.steps.join(" ");
  assert.match(text, /수업 전체 학원비 비율 포함/);
  assert.match(text, /최대 9개 시급/);
  assert.match(text, /근로소득 \+ 사업소득/);
  assert.match(text, /서로 다른 설정/);
});

test("학원비 비율제 질문은 약정 비율과 관리자 월 학원비 입력 안내를 찾는다", () => {
  const results = searchHelpArticles("학원비 비율 월 급여 입력", helpArticles);
  assert.ok(results.some((article) => article.id === "monthly-pay-input"));
  const answer = buildLocalHelpAnswer("학원비 비율 월 급여 입력", helpArticles);
  assert.match(answer, /학원비/);
});

test("수업 전체 학원비 질문은 총액 입력과 관리자 보완 안내를 찾는다", () => {
  const results = searchHelpArticles("해당 수업 전체 학원비 총액 입력", helpArticles);
  assert.ok(results.some((article) => article.id === "monthly-pay-input"));
  const article = helpArticles.find((item) => item.id === "monthly-pay-input");
  assert.match(article.steps.join(" "), /학원 전체 매출은 입력하지 않습니다/);
  assert.match(article.steps.join(" "), /입력 대기/);
  assert.match(article.steps.join(" "), /선생님 제출값 반영/);
  assert.match(article.steps.join(" "), /해당 수업 전체 학원비 × 약정 비율/);
  assert.doesNotMatch(article.steps.join(" "), /학생 수 × 1인당/);
});

test("명세서 이메일 질문에는 개인 명세서 전달 안내를 우선 제시한다", () => {
  const [result] = searchHelpArticles("선생님 급여명세서를 이메일로 보내려면?", helpArticles);
  assert.equal(result.id, "payslip-delivery");
});

test("일반적인 급여월 질문은 개인정보로 잘못 차단하지 않는다", () => {
  assert.deepEqual(detectSensitiveInput("2026년 8월 급여명세서는 어디서 출력하나요?"), []);
});

test("익명 가상 금액을 사용한 세무 질문은 허용한다", () => {
  assert.deepEqual(detectSensitiveInput("근로소득 월 300만원과 사업소득 월 100만원이면 무엇을 확인하나요?"), []);
});

test("합법적 절세 질문에는 회계·세무 안내를 우선 제시한다", () => {
  const [result] = searchHelpArticles("근로소득과 사업소득을 함께 받는 경우 합법적으로 절세하려면?", helpArticles);
  assert.equal(result.id, "lawful-tax-guidance");
});

test("이메일과 주민등록번호 형태를 외부 AI 전송 전에 감지한다", () => {
  const detected = detectSensitiveInput("teacher@example.com 900101-1234567");
  assert.deepEqual(detected, ["이메일 주소", "주민등록번호"]);
});

test("생년월일 식별값도 외부 AI 전송 전에 감지한다", () => {
  assert.deepEqual(detectSensitiveInput("선생님 정보는 900101-1입니다"), ["생년월일 식별값"]);
});

test("개인정보가 포함된 질문에는 로컬에서도 삭제 안내를 반환한다", () => {
  const answer = buildLocalHelpAnswer("010-1234-5678로 명세서를 보내 줘", helpArticles);
  assert.match(answer, /AI 도움말로 보내지 않았습니다/);
});

test("Gemini 프롬프트에는 현재 화면과 관련 설명서만 포함한다", () => {
  const prompt = buildGeminiPrompt("이번 달 지급액 수정 방법", helpArticles, "월 급여 입력");
  assert.match(prompt, /현재 화면: 월 급여 입력/);
  assert.match(prompt, /선생님별 월 급여 입력/);
  assert.doesNotMatch(prompt, /teacher@example.com/);
});

test("세무 프롬프트에는 공식 근거와 위법한 절세 방법 금지가 포함된다", () => {
  const prompt = buildGeminiPrompt("3.3% 사업소득의 필요경비와 종합소득세를 알려줘", helpArticles, "AI 도움말");
  assert.match(prompt, /국세청 사업소득 안내/);
  assert.match(prompt, /소득 누락, 허위 계약, 가공 경비/);
});

