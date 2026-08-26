const COMPLETE_PHONE_PATTERN = /^(?:[0-9]{4}-[0-9]{4}|02-[0-9]{3,4}-[0-9]{4}|[0-9]{3,4}-[0-9]{3,4}-[0-9]{4})$/;

export function phoneDigits(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.startsWith("0505") ? digits.slice(0, 12) : digits.slice(0, 11);
}

export function formatKoreanPhoneNumber(value) {
  const digits = phoneDigits(value);
  if (!digits) return "";

  if (digits.startsWith("02")) {
    if (digits.length <= 2) return digits;
    if (digits.length <= 5) return `${digits.slice(0, 2)}-${digits.slice(2)}`;
    if (digits.length <= 9) return `${digits.slice(0, 2)}-${digits.slice(2, 5)}-${digits.slice(5)}`;
    return `${digits.slice(0, 2)}-${digits.slice(2, 6)}-${digits.slice(6)}`;
  }

  if (digits.startsWith("0505")) {
    if (digits.length <= 4) return digits;
    if (digits.length <= 8) return `${digits.slice(0, 4)}-${digits.slice(4)}`;
    return `${digits.slice(0, 4)}-${digits.slice(4, 8)}-${digits.slice(8)}`;
  }

  if (digits.startsWith("1") && digits.length <= 8) {
    return digits.length <= 4 ? digits : `${digits.slice(0, 4)}-${digits.slice(4)}`;
  }

  if (digits.length <= 3) return digits;
  if (digits.length <= 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  if (digits.length <= 10) return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
}

export function normalizePhoneNumber(value) {
  const formatted = formatKoreanPhoneNumber(value);
  if (formatted && !COMPLETE_PHONE_PATTERN.test(formatted)) {
    throw new Error("연락처 전체 번호를 숫자로 입력해 주세요.");
  }
  return formatted;
}
