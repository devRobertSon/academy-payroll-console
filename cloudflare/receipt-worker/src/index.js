const GOOGLE_JWKS_URL = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
const ALLOWED_CATEGORIES = new Set(["transport", "parking"]);
const MAX_FILE_BYTES = 5 * 1024 * 1024;

let certificateCache = { expiresAt: 0, certificates: null };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return corsResponse(request, env, new Response(null, { status: 204 }));
    try {
      if (url.pathname === "/health") return json(request, env, { ok: true });
      if (url.pathname === "/oauth/google/callback") return handleOAuthCallback(request, env);

      const session = await authenticate(request, env);
      if (url.pathname === "/integration/status" && request.method === "GET") {
        requireAdmin(session);
        return json(request, env, { connected: Boolean(await loadDriveConnection(env)) });
      }
      if (url.pathname === "/oauth/google/start" && request.method === "GET") {
        requireAdmin(session);
        return json(request, env, await startOAuth(session, env));
      }
      if (url.pathname === "/receipts" && request.method === "POST") {
        return json(request, env, await uploadReceipt(request, session, env), 201);
      }
      const fileMatch = url.pathname.match(/^\/receipts\/([^/]+)\/file$/);
      if (fileMatch && request.method === "GET") return downloadReceiptFile(request, decodeURIComponent(fileMatch[1]), session, env);
      if (fileMatch && request.method === "DELETE") {
        await deleteReceiptFile(request, decodeURIComponent(fileMatch[1]), session, env);
        return json(request, env, { deleted: true });
      }
      return json(request, env, { error: "요청한 기능을 찾을 수 없습니다." }, 404);
    } catch (error) {
      console.error(error);
      return json(request, env, { error: publicError(error) }, error.status || 500);
    }
  }
};

async function authenticate(request, env) {
  const authorization = request.headers.get("Authorization") || "";
  if (!authorization.startsWith("Bearer ")) throw httpError(401, "로그인이 필요합니다.");
  const token = authorization.slice(7);
  const claims = await verifyFirebaseToken(token, env.FIREBASE_PROJECT_ID);
  const account = await getFirestoreDocument(env.FIREBASE_PROJECT_ID, `users/${claims.sub}`, token);
  if (!account || account.status !== "active") throw httpError(403, "활성 계정만 사용할 수 있습니다.");
  return { token, claims, account, uid: claims.sub };
}

async function verifyFirebaseToken(token, projectId) {
  const parts = token.split(".");
  if (parts.length !== 3) throw httpError(401, "로그인 토큰 형식이 올바르지 않습니다.");
  const header = JSON.parse(decodeBase64Url(parts[0]));
  const claims = JSON.parse(decodeBase64Url(parts[1]));
  if (header.alg !== "RS256" || !header.kid) throw httpError(401, "로그인 토큰 서명을 확인할 수 없습니다.");
  const certificates = await getGoogleCertificates();
  const certificate = certificates[header.kid];
  if (!certificate) throw httpError(401, "로그인 토큰 인증서를 찾을 수 없습니다.");
  const key = await crypto.subtle.importKey("jwk", certificate, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, base64UrlBytes(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  const now = Math.floor(Date.now() / 1000);
  if (!valid || claims.aud !== projectId || claims.iss !== `https://securetoken.google.com/${projectId}` || claims.exp <= now || claims.iat > now + 60 || !claims.sub) {
    throw httpError(401, "로그인 토큰이 만료되었거나 올바르지 않습니다.");
  }
  return claims;
}

async function getGoogleCertificates() {
  if (certificateCache.certificates && certificateCache.expiresAt > Date.now()) return certificateCache.certificates;
  const response = await fetch(GOOGLE_JWKS_URL);
  if (!response.ok) throw httpError(503, "Google 로그인 인증서를 불러오지 못했습니다.");
  const maxAge = Number(response.headers.get("cache-control")?.match(/max-age=(\d+)/)?.[1] || 1800);
  const body = await response.json();
  certificateCache = { certificates: Object.fromEntries((body.keys || []).map((key) => [key.kid, key])), expiresAt: Date.now() + maxAge * 1000 };
  return certificateCache.certificates;
}

async function startOAuth(session, env) {
  requireKv(env);
  requireOAuthConfig(env);
  const state = crypto.randomUUID();
  await env.RECEIPT_KV.put(`oauth_state:${state}`, JSON.stringify({ uid: session.uid, createdAt: Date.now() }), { expirationTtl: 600 });
  const redirectUri = `${env.API_ORIGIN.replace(/\/$/, "")}/oauth/google/callback`;
  const authorizationUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authorizationUrl.search = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: DRIVE_SCOPE,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state
  }).toString();
  return { authorizationUrl: authorizationUrl.toString() };
}

async function handleOAuthCallback(request, env) {
  requireKv(env);
  requireOAuthConfig(env);
  const url = new URL(request.url);
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  const savedState = state ? await env.RECEIPT_KV.get(`oauth_state:${state}`, "json") : null;
  if (!savedState || !code) throw httpError(400, "Google Drive 연결 요청이 만료되었거나 취소되었습니다.");
  await env.RECEIPT_KV.delete(`oauth_state:${state}`);
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: `${url.origin}/oauth/google/callback`,
      grant_type: "authorization_code"
    })
  });
  const tokens = await tokenResponse.json();
  if (!tokenResponse.ok || !tokens.refresh_token) throw httpError(400, tokens.error_description || "Google Drive 장기 연결 토큰을 받지 못했습니다.");
  await env.RECEIPT_KV.put("drive_connection", JSON.stringify({
    encryptedRefreshToken: await encryptSecret(tokens.refresh_token, env.TOKEN_ENCRYPTION_KEY),
    connectedBy: savedState.uid,
    connectedAt: new Date().toISOString(),
    rootFolderId: null
  }));
  return Response.redirect(`${env.APP_ORIGIN.replace(/\/$/, "")}/?drive=connected`, 302);
}

async function uploadReceipt(request, session, env) {
  if (session.account.role !== "teacher" && session.account.role !== "admin") throw httpError(403, "영수증 제출 권한이 없습니다.");
  const form = await request.formData();
  const file = form.get("file");
  const receiptId = String(form.get("receiptId") || "");
  const teacherId = String(form.get("teacherId") || "");
  const month = String(form.get("month") || "");
  const category = String(form.get("category") || "");
  if (!(file instanceof File) || !ALLOWED_MIME_TYPES.has(file.type) || file.size <= 0 || file.size > MAX_FILE_BYTES) throw httpError(400, "허용된 5MB 이하 영수증 파일만 제출할 수 있습니다.");
  if (!/^[0-9a-f-]{36}$/i.test(receiptId) || !/^\d{4}-\d{2}$/.test(month) || !ALLOWED_CATEGORIES.has(category)) throw httpError(400, "영수증 정보가 올바르지 않습니다.");
  if (session.account.role === "teacher" && (session.account.teacherId !== teacherId || session.uid !== session.claims.sub)) throw httpError(403, "본인의 영수증만 제출할 수 있습니다.");
  await assertMonthEditable(month, session, env);
  await enforceUploadQuota(session.uid, file.size, env);

  const accessToken = await driveAccessToken(env);
  const rootFolder = await ensureRootFolder(accessToken, env);
  const monthFolder = await ensureFolder(accessToken, month, rootFolder);
  const teacherFolder = await ensureFolder(accessToken, teacherId, monthFolder);
  const extension = file.type === "application/pdf" ? "pdf" : file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const storedName = `${category}-${crypto.randomUUID()}.${extension}`;
  const uploaded = await driveMultipartUpload(accessToken, { name: storedName, parents: [teacherFolder] }, file);
  return { fileId: uploaded.id, fileName: sanitizeFileName(file.name) };
}

async function downloadReceiptFile(request, receiptId, session, env) {
  const receipt = await authorizedReceipt(receiptId, session, env);
  if (session.account.role === "teacher" && receipt.status === "approved") throw httpError(403, "승인된 영수증 파일은 관리자만 열람할 수 있습니다.");
  const response = await driveFetch(env, `/files/${encodeURIComponent(receipt.fileId)}?alt=media`);
  if (!response.ok) throw httpError(response.status === 404 ? 404 : 502, "Google Drive에서 영수증 파일을 불러오지 못했습니다.");
  const headers = new Headers(response.headers);
  headers.set("Content-Type", receipt.mimeType || "application/octet-stream");
  headers.set("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(sanitizeFileName(receipt.fileName || "receipt"))}`);
  return corsResponse(request, env, new Response(response.body, { status: 200, headers }));
}

async function deleteReceiptFile(request, receiptId, session, env) {
  const receipt = await authorizedReceipt(receiptId, session, env);
  if (session.account.role === "teacher" && receipt.status !== "pending") throw httpError(403, "검토 대기 중인 영수증만 취소할 수 있습니다.");
  await assertMonthEditable(receipt.month, session, env);
  const response = await driveFetch(env, `/files/${encodeURIComponent(receipt.fileId)}`, { method: "DELETE" });
  if (!response.ok && response.status !== 404) throw httpError(502, "Google Drive 영수증 파일을 삭제하지 못했습니다.");
}

async function authorizedReceipt(receiptId, session, env) {
  const receipt = await getFirestoreDocument(env.FIREBASE_PROJECT_ID, `expenseReceipts/${receiptId}`, session.token);
  if (!receipt) throw httpError(404, "영수증 정보를 찾을 수 없습니다.");
  if (session.account.role === "teacher" && (receipt.teacherUid !== session.uid || receipt.teacherId !== session.account.teacherId)) throw httpError(403, "본인의 영수증만 열람할 수 있습니다.");
  return receipt;
}

async function assertMonthEditable(month, session, env) {
  const run = await getFirestoreDocument(env.FIREBASE_PROJECT_ID, `payrollRuns/${month}`, session.token);
  if (run?.status === "published") throw httpError(409, "확정된 급여월의 영수증은 변경할 수 없습니다.");
}

async function enforceUploadQuota(uid, sizeBytes, env) {
  requireKv(env);
  const day = new Date().toISOString().slice(0, 10);
  const key = `upload_quota:${day}:${uid}`;
  const current = await env.RECEIPT_KV.get(key, "json") || { count: 0, bytes: 0 };
  if (current.count >= 40 || current.bytes + sizeBytes > 100 * 1024 * 1024) {
    throw httpError(429, "오늘 제출 가능한 영수증 파일 한도를 초과했습니다. 관리자에게 문의해 주세요.");
  }
  await env.RECEIPT_KV.put(key, JSON.stringify({ count: current.count + 1, bytes: current.bytes + sizeBytes }), { expirationTtl: 172800 });
}

async function getFirestoreDocument(projectId, path, token) {
  const response = await fetch(`https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${path}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (response.status === 404) return null;
  if (!response.ok) throw httpError(response.status === 403 ? 403 : 502, "Firebase 권한 정보를 확인하지 못했습니다.");
  return decodeFirestoreFields((await response.json()).fields || {});
}

function decodeFirestoreFields(fields) {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, decodeFirestoreValue(value)]));
}

function decodeFirestoreValue(value) {
  if (Object.hasOwn(value, "stringValue")) return value.stringValue;
  if (Object.hasOwn(value, "integerValue")) return Number(value.integerValue);
  if (Object.hasOwn(value, "doubleValue")) return value.doubleValue;
  if (Object.hasOwn(value, "booleanValue")) return value.booleanValue;
  if (Object.hasOwn(value, "nullValue")) return null;
  if (value.timestampValue) return value.timestampValue;
  if (value.mapValue) return decodeFirestoreFields(value.mapValue.fields || {});
  if (value.arrayValue) return (value.arrayValue.values || []).map(decodeFirestoreValue);
  return null;
}

async function driveAccessToken(env) {
  requireOAuthConfig(env);
  const connection = await loadDriveConnection(env);
  if (!connection) throw httpError(503, "관리자가 Google Drive를 먼저 연결해야 합니다.");
  const refreshToken = await decryptSecret(connection.encryptedRefreshToken, env.TOKEN_ENCRYPTION_KEY);
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, refresh_token: refreshToken, grant_type: "refresh_token" })
  });
  const result = await response.json();
  if (!response.ok || !result.access_token) throw httpError(503, "Google Drive 연결이 만료되었습니다. 관리자가 다시 연결해 주세요.");
  return result.access_token;
}

async function driveFetch(env, path, options = {}) {
  const accessToken = await driveAccessToken(env);
  return fetch(`https://www.googleapis.com/drive/v3${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${accessToken}`, ...(options.headers || {}) }
  });
}

async function ensureRootFolder(accessToken, env) {
  const connection = await loadDriveConnection(env);
  if (connection.rootFolderId) return connection.rootFolderId;
  const rootFolderId = await ensureFolder(accessToken, env.DRIVE_ROOT_FOLDER_NAME || "Academy Payroll Receipts");
  connection.rootFolderId = rootFolderId;
  await env.RECEIPT_KV.put("drive_connection", JSON.stringify(connection));
  return rootFolderId;
}

async function ensureFolder(accessToken, name, parentId = null) {
  const parentQuery = parentId ? ` and '${escapeDriveQuery(parentId)}' in parents` : "";
  const query = `name = '${escapeDriveQuery(name)}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false${parentQuery}`;
  const listResponse = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name)&spaces=drive`, { headers: { Authorization: `Bearer ${accessToken}` } });
  const list = await listResponse.json();
  if (!listResponse.ok) throw httpError(502, "Google Drive 폴더를 확인하지 못했습니다.");
  if (list.files?.[0]?.id) return list.files[0].id;
  const createResponse = await fetch("https://www.googleapis.com/drive/v3/files?fields=id", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder", ...(parentId ? { parents: [parentId] } : {}) })
  });
  const created = await createResponse.json();
  if (!createResponse.ok) throw httpError(502, "Google Drive 폴더를 만들지 못했습니다.");
  return created.id;
}

async function driveMultipartUpload(accessToken, metadata, file) {
  const boundary = `academy-payroll-${crypto.randomUUID()}`;
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`,
    `--${boundary}\r\nContent-Type: ${file.type}\r\n\r\n`,
    file,
    `\r\n--${boundary}--`
  ]);
  const response = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": `multipart/related; boundary=${boundary}` },
    body
  });
  const result = await response.json();
  if (!response.ok) throw httpError(502, "Google Drive에 영수증을 저장하지 못했습니다.");
  return result;
}

async function loadDriveConnection(env) {
  requireKv(env);
  return env.RECEIPT_KV.get("drive_connection", "json");
}

async function encryptSecret(value, keySecret) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await encryptionKey(keySecret);
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(value));
  return `${bytesToBase64(iv)}.${bytesToBase64(new Uint8Array(cipher))}`;
}

async function decryptSecret(value, keySecret) {
  const [ivValue, cipherValue] = String(value || "").split(".");
  if (!ivValue || !cipherValue) throw httpError(503, "저장된 Google Drive 연결 정보를 읽지 못했습니다.");
  const key = await encryptionKey(keySecret);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64Bytes(ivValue) }, key, base64Bytes(cipherValue));
  return new TextDecoder().decode(plain);
}

async function encryptionKey(secret) {
  if (!secret || secret.length < 24) throw httpError(503, "Worker 암호화 Secret을 설정해 주세요.");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

function requireAdmin(session) {
  if (session.account.role !== "admin") throw httpError(403, "관리자만 설정할 수 있습니다.");
}

function requireKv(env) {
  if (!env.RECEIPT_KV) throw httpError(503, "Cloudflare KV binding RECEIPT_KV를 설정해 주세요.");
}

function requireOAuthConfig(env) {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.TOKEN_ENCRYPTION_KEY || !env.APP_ORIGIN || !env.API_ORIGIN) {
    throw httpError(503, "Worker의 Google OAuth 변수와 Secret을 모두 설정해 주세요.");
  }
}

function json(request, env, body, status = 200) {
  return corsResponse(request, env, new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8" } }));
}

function corsResponse(request, env, response) {
  const headers = new Headers(response.headers);
  const origin = request.headers.get("Origin");
  if (origin && origin === env.APP_ORIGIN) headers.set("Access-Control-Allow-Origin", origin);
  headers.set("Vary", "Origin");
  headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
  headers.set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function publicError(error) {
  return error?.status && error.status < 500 ? error.message : error?.message || "영수증 서비스를 처리하지 못했습니다.";
}

function decodeBase64Url(value) {
  return new TextDecoder().decode(base64UrlBytes(value));
}

function base64UrlBytes(value) {
  return base64Bytes(value.replace(/-/g, "+").replace(/_/g, "/"));
}

function base64Bytes(value) {
  const normalized = value.padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(normalized), (character) => character.charCodeAt(0));
}

function bytesToBase64(bytes) {
  let value = "";
  bytes.forEach((byte) => { value += String.fromCharCode(byte); });
  return btoa(value);
}

function escapeDriveQuery(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function sanitizeFileName(value) {
  return String(value || "receipt").replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").slice(0, 200) || "receipt";
}
