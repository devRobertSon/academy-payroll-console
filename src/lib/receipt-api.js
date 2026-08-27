import { RECEIPT_MAX_FILE_BYTES, validateReceiptFile } from "./expense-receipts.js";

const MAX_IMAGE_EDGE = 1800;
const JPEG_QUALITY = 0.84;

export function createReceiptApi(baseUrl, getIdToken) {
  const normalizedBaseUrl = String(baseUrl || "").replace(/\/$/, "");

  async function request(path, options = {}) {
    if (!normalizedBaseUrl) throw new Error("Google Drive 영수증 연결 주소가 설정되지 않았습니다.");
    const token = await getIdToken();
    const response = await fetch(`${normalizedBaseUrl}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(options.headers || {})
      }
    });
    if (!response.ok) {
      const details = await response.json().catch(() => null);
      throw new Error(details?.error || "Google Drive 영수증 서비스 요청을 처리하지 못했습니다.");
    }
    return response;
  }

  return {
    configured: Boolean(normalizedBaseUrl),
    async status() {
      return (await request("/integration/status")).json();
    },
    async connectUrl() {
      return (await request("/oauth/google/start")).json();
    },
    async upload(file, metadata) {
      const form = new FormData();
      form.append("file", file, file.name);
      Object.entries(metadata).forEach(([key, value]) => form.append(key, String(value ?? "")));
      return (await request("/receipts", { method: "POST", body: form })).json();
    },
    async fetchFile(receiptId) {
      return (await request(`/receipts/${encodeURIComponent(receiptId)}/file`)).blob();
    },
    async deleteFile(receiptId) {
      await request(`/receipts/${encodeURIComponent(receiptId)}/file`, { method: "DELETE" });
    }
  };
}

export async function prepareReceiptFile(file) {
  let prepared = file;
  if (file?.type?.startsWith("image/") && file.type !== "image/gif") {
    prepared = await compressReceiptImage(file);
  }
  const validationError = validateReceiptFile(prepared);
  if (validationError) throw new Error(validationError);
  return {
    file: prepared,
    sha256: await sha256Hex(prepared)
  };
}

async function compressReceiptImage(file) {
  if (typeof createImageBitmap !== "function" || typeof document === "undefined") return file;
  const image = await createImageBitmap(file);
  const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  if (scale === 1 && file.size <= RECEIPT_MAX_FILE_BYTES) {
    image.close();
    return file;
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { alpha: false });
  context.fillStyle = "#fff";
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);
  image.close();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY));
  if (!blob) return file;
  const baseName = String(file.name || "receipt").replace(/\.[^.]+$/, "");
  return new File([blob], `${baseName}.jpg`, { type: "image/jpeg", lastModified: file.lastModified });
}

async function sha256Hex(file) {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
