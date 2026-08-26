const CENTURY_BY_GENDER_CODE = Object.freeze({
  "1": 1900,
  "2": 1900,
  "3": 2000,
  "4": 2000,
  "5": 1900,
  "6": 1900,
  "7": 2000,
  "8": 2000
});

export function validateTeacherIdentity(birthDateCode, genderCode) {
  const normalizedBirthDateCode = String(birthDateCode || "").trim();
  const normalizedGenderCode = String(genderCode || "").trim();

  if (!/^\d{6}$/.test(normalizedBirthDateCode)) {
    throw new Error("생년월일은 주민등록번호 앞의 숫자 6자리로 입력해 주세요.");
  }
  if (!/^[1-8]$/.test(normalizedGenderCode)) {
    throw new Error("성별번호는 주민등록번호 뒷자리의 첫 숫자 1개로 입력해 주세요.");
  }

  const year = CENTURY_BY_GENDER_CODE[normalizedGenderCode] + Number(normalizedBirthDateCode.slice(0, 2));
  const month = Number(normalizedBirthDateCode.slice(2, 4));
  const day = Number(normalizedBirthDateCode.slice(4, 6));
  const date = new Date(Date.UTC(year, month - 1, day));
  const today = new Date();
  const todayUtc = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());

  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
    || date.getTime() > todayUtc
  ) {
    throw new Error("생년월일 6자리를 확인해 주세요.");
  }

  return {
    birthDateCode: normalizedBirthDateCode,
    genderCode: normalizedGenderCode
  };
}

export function validateOptionalTeacherIdentity(birthDateCode, genderCode) {
  const normalizedBirthDateCode = String(birthDateCode || "").trim();
  const normalizedGenderCode = String(genderCode || "").trim();
  if (!normalizedBirthDateCode && !normalizedGenderCode) return {};
  return validateTeacherIdentity(normalizedBirthDateCode, normalizedGenderCode);
}

export function parseTeacherIdentity(value) {
  const normalized = String(value || "").trim();
  const match = normalized.match(/^(\d{6})-([1-8])$/);
  if (!match) {
    throw new Error("생년월일·성별번호는 900101-1 형식으로 입력해 주세요.");
  }
  return validateTeacherIdentity(match[1], match[2]);
}

export function parseOptionalTeacherIdentity(value) {
  const normalized = String(value || "").trim();
  if (!normalized) return {};
  return parseTeacherIdentity(normalized);
}

export function formatTeacherIdentity(teacher) {
  if (!/^\d{6}$/.test(String(teacher?.birthDateCode || ""))) return "";
  if (!/^[1-8]$/.test(String(teacher?.genderCode || ""))) return "";
  return `${teacher.birthDateCode}-${teacher.genderCode}`;
}

