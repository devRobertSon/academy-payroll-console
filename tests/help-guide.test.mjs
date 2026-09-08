import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { helpArticles } from "../src/data/help-content.js";
import { searchHelpArticles } from "../src/lib/help-assistant.js";

const root = new URL("../", import.meta.url);
const guide = await readFile(new URL("docs/user-guide.md", root), "utf8");
const app = await readFile(new URL("src/app.js", root), "utf8");

test("사이트 설명서와 문서 파일이 현재 급여 업무를 함께 설명한다", () => {
  const inAppText = helpArticles.map((article) => [article.title, ...article.steps, ...article.cautions].join(" ")).join(" ");
  for (const text of [inAppText, guide]) {
    for (const label of ["내 급여 등록", "관리 업무", "수업 전체 학원비 비율 포함", "선생님 제출값 반영", "과세·공제 조정"]) {
      assert.ok(text.includes(label), `Missing current workflow: ${label}`);
    }
    assert.match(text, /선생님 수, 총 지급액, 실 지급액/);
    assert.match(text, /총 공제액은.*선생님별 급여 표/);
    assert.match(text, /일괄 발송 버튼이 없습니다/);
    assert.doesNotMatch(text, /월 급여 입력에서 수동 공제액/);
    assert.match(text, /해당 수업 전체 학원비 × 약정 비율/);
    assert.doesNotMatch(text, /학생 수 × 1인당|학원비 항목 추가|담당 학생 학원비 비율 포함/);
  }
});

test("설명서의 화면 링크는 두 문서에서 동일한 실제 PNG를 참조한다", async () => {
  const articleImages = new Set(helpArticles.flatMap((article) => article.screenshots || []).map((item) => item.src));
  const documentImages = new Set([...guide.matchAll(/!\[[^\]]*\]\((\.\/images\/[^)]+)\)/g)].map((match) => match[1].replace("./images/", "./docs/images/")));
  assert.deepEqual(articleImages, documentImages);
  for (const path of articleImages) {
    assert.match(path, /^\.\/docs\/images\/guide-[\w-]+\.png$/);
    const image = await readFile(new URL(path, root));
    assert.equal(image.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", path);
    assert.ok(image.readUInt32BE(16) > 0 && image.readUInt32BE(20) > 0, path);
  }
});

test("검색 후에도 설명서 제목 번호는 전체 목차 번호를 유지한다", () => {
  const eventTarget = { addEventListener() {} };
  const content = {
    innerHTML: "",
    querySelector: () => eventTarget,
    querySelectorAll: () => []
  };
  const context = {
    state: { helpSearch: "관리자 본인 내 급여" },
    helpArticles,
    searchHelpArticles,
    setPage() {},
    openAssistant() {},
    e: (value) => String(value),
    elements: { content, topbarActions: { querySelector: () => eventTarget } }
  };
  const source = app.slice(app.indexOf("function renderHelp()"), app.indexOf("function renderWorkHours()"));
  runInNewContext(`${source}\nrenderHelp();`, context);
  const article = helpArticles.find((item) => item.id === "admin-own-payroll");
  const expected = String(helpArticles.indexOf(article) + 1).padStart(2, "0");
  assert.match(content.innerHTML, new RegExp(`id="help-admin-own-payroll"[^]*?<header><span>${expected}</span>`));
  assert.doesNotMatch(content.innerHTML, /테스트 계정과 가상 급여로 전체 절차/);
});
