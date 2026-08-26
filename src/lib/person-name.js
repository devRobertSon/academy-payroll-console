const PERSON_NAME_PATTERN = /^[A-Za-z가-힣]+(?: [A-Za-z가-힣]+)*$/;

export function sanitizePersonNameInput(value) {
  return String(value || "")
    .replace(/[^A-Za-z가-힣\s]/g, "")
    .replace(/\s+/g, " ")
    .replace(/^ +/, "")
    .slice(0, 100);
}

export function normalizePersonName(value) {
  const name = sanitizePersonNameInput(value).trim();
  if (!PERSON_NAME_PATTERN.test(name)) {
    throw new Error("이름은 한글 또는 영문으로 입력해 주세요.");
  }
  return name;
}
