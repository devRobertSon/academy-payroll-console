const MOBILE_PHONE_PATTERN = /^010[0-9]{8}$/;

export function phoneDigits(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 11);
}

export function mobilePhoneParts(value) {
  const digits = phoneDigits(value);
  const subscriberDigits = digits.startsWith("010") ? digits.slice(3) : "";
  return {
    middle: subscriberDigits.slice(0, 4),
    last: subscriberDigits.slice(4, 8)
  };
}

export function formatMobilePhoneNumber(value) {
  const digits = phoneDigits(value);
  if (!MOBILE_PHONE_PATTERN.test(digits)) return "";
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
}

export function normalizeMobilePhoneNumber(value) {
  const digits = phoneDigits(value);
  if (!digits) return "";
  if (!MOBILE_PHONE_PATTERN.test(digits)) {
    throw new Error("휴대전화는 010 뒤의 숫자 8자리를 모두 입력해 주세요.");
  }
  return digits;
}
