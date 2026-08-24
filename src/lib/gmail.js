export const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";

export function buildGmailMessage({ to, subject, body, attachmentName, attachmentBytes, boundary = createBoundary() }) {
  assertHeaderValue(to, "수신자 이메일");
  assertHeaderValue(subject, "메일 제목");
  if (!/^\S+@\S+\.\S+$/.test(to)) throw new Error("수신자 이메일 형식을 확인해 주세요.");
  if (!(attachmentBytes instanceof Uint8Array)) throw new Error("첨부할 PDF 파일을 읽지 못했습니다.");

  const encodedFilename = encodeURIComponent(attachmentName);
  const mime = [
    `To: ${to}`,
    `Subject: ${encodeHeader(subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    wrapBase64(bytesToBase64(new TextEncoder().encode(body))),
    `--${boundary}`,
    `Content-Type: application/pdf; name*=UTF-8''${encodedFilename}`,
    `Content-Disposition: attachment; filename*=UTF-8''${encodedFilename}`,
    "Content-Transfer-Encoding: base64",
    "",
    wrapBase64(bytesToBase64(attachmentBytes)),
    `--${boundary}--`,
    ""
  ].join("\r\n");

  return bytesToBase64(new TextEncoder().encode(mime))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/g, "");
}

export async function fileToBytes(file) {
  return new Uint8Array(await file.arrayBuffer());
}

function encodeHeader(value) {
  return `=?UTF-8?B?${bytesToBase64(new TextEncoder().encode(value))}?=`;
}

function assertHeaderValue(value, label) {
  if (!String(value || "").trim()) throw new Error(`${label}을 입력해 주세요.`);
  if (/[\r\n]/.test(value)) throw new Error(`${label}에 줄바꿈을 넣을 수 없습니다.`);
}

function createBoundary() {
  return `academy-payroll-${crypto.randomUUID()}`;
}

function wrapBase64(value) {
  return value.match(/.{1,76}/g)?.join("\r\n") || "";
}

function bytesToBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}
