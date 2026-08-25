const STOP_WORDS = new Set(["어떻게", "어디", "무엇", "뭐", "하면", "하는", "있나요", "주세요", "알려줘", "프로그램"]);

const SENSITIVE_PATTERNS = [
  ["이메일 주소", /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i],
  ["전화번호", /(?:01[016789])[- .]?\d{3,4}[- .]?\d{4}/],
  ["주민등록번호", /\b\d{6}[- ]?[1-4]\d{6}\b/],
  ["생년월일·성별번호", /\b\d{6}[- ][1-8]\b/],
  ["계좌번호", /\b\d{3,6}-\d{3,6}-\d{3,6}\b/],
  ["긴 숫자 정보", /\b\d{9,}\b/]
];

export function detectSensitiveInput(value) {
  const text = String(value || "");
  return SENSITIVE_PATTERNS.filter(([, pattern]) => pattern.test(text)).map(([label]) => label);
}

export function searchHelpArticles(query, articles, limit = 3) {
  const normalized = normalize(query);
  const terms = normalized.split(/\s+/)
    .map(stripKoreanParticle)
    .filter((term) => term.length > 1 && !STOP_WORDS.has(term));
  if (!terms.length) return articles.slice(0, limit);

  return articles
    .map((article, index) => ({ article, index, score: scoreArticle(article, normalized, terms) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map((item) => item.article);
}

export function buildLocalHelpAnswer(question, articles, currentPage = "현재 화면") {
  const sensitive = detectSensitiveInput(question);
  if (sensitive.length) return privacyRefusal(sensitive);

  const matches = searchHelpArticles(question, articles, 2);
  if (!matches.length) {
    return `${currentPage}에 대한 답을 찾지 못했습니다. 질문을 "선생님 등록", "수업 입력", "명세서 이메일"처럼 기능 이름으로 다시 입력해 주세요.`;
  }

  return matches.map((article, articleIndex) => {
    const steps = article.steps.slice(0, articleIndex ? 2 : 4).map((step, index) => `${index + 1}. ${step}`).join("\n");
    const caution = article.cautions[0] ? `\n주의: ${article.cautions[0]}` : "";
    return `[${article.title}]\n${article.summary}\n${steps}${caution}`;
  }).join("\n\n함께 확인할 내용\n");
}

export function buildGeminiPrompt(question, articles, currentPage = "현재 화면") {
  const sensitive = detectSensitiveInput(question);
  if (sensitive.length) throw new Error(privacyRefusal(sensitive));
  const selected = searchHelpArticles(question, articles, 4);
  const context = selected.map((article) => [
    `제목: ${article.title}`,
    `요약: ${article.summary}`,
    ...article.steps.map((step, index) => `${index + 1}. ${step}`),
    ...article.cautions.map((caution) => `주의: ${caution}`)
  ].join("\n")).join("\n\n");
  return `현재 화면: ${currentPage}\n사용자 질문: ${question.trim()}\n\n사용 설명서 발췌:\n${context}`;
}

export function privacyRefusal(labels) {
  return `${labels.join(", ")}처럼 보이는 정보가 포함되어 AI 도움말로 보내지 않았습니다. 실제 개인정보와 급여액을 지우고 사용 방법만 질문해 주세요.`;
}

function scoreArticle(article, normalizedQuery, terms) {
  const title = normalize(article.title);
  const keywords = normalize(article.keywords.join(" "));
  const summary = normalize(article.summary);
  const body = normalize([...article.steps, ...article.cautions].join(" "));
  let score = 0;
  for (const term of terms) {
    if (title.includes(term)) score += 8;
    if (keywords.includes(term)) score += 5;
    if (summary.includes(term)) score += 3;
    if (body.includes(term)) score += 1;
  }
  if (title && normalizedQuery.includes(title)) score += 12;
  return score;
}

function normalize(value) {
  return String(value || "").toLowerCase().replace(/[^0-9a-z가-힣\s]/g, " ").replace(/\s+/g, " ").trim();
}

function stripKoreanParticle(term) {
  return term.replace(/(?:으로|에서|에게|까지|부터|처럼|하고|이나|거나|하려면|을|를|은|는|이|가|에|로|과|와)$/u, "");
}

