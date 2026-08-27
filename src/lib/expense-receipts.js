export const EXPENSE_RECEIPT_NOTIFICATION_TYPE = "expense_receipt_submitted";

export const EXPENSE_CATEGORY_LABELS = {
  transport: "교통비",
  parking: "주차비"
};

export const EXPENSE_RECEIPT_STATUS_LABELS = {
  pending: "검토 대기",
  approved: "승인",
  rejected: "반려"
};

export const RECEIPT_ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf"
]);

export const RECEIPT_MAX_FILE_BYTES = 5 * 1024 * 1024;

export function expenseReceiptNotificationId(receiptId) {
  return `expense-receipt_${receiptId}`;
}

export function unreadExpenseReceiptNotifications(notifications = []) {
  return notifications.filter((notification) => (
    notification?.type === EXPENSE_RECEIPT_NOTIFICATION_TYPE
    && notification?.status === "unread"
  ));
}

export function approvedReceiptEarnings(receipts = [], teacherId, month) {
  return receipts
    .filter((receipt) => (
      receipt?.teacherId === teacherId
      && receipt?.month === month
      && receipt?.status === "approved"
      && Object.hasOwn(EXPENSE_CATEGORY_LABELS, receipt?.category)
      && Number(receipt?.amount) > 0
    ))
    .map((receipt) => ({
      id: String(receipt.id),
      category: receipt.category,
      amount: Math.round(Number(receipt.amount)),
      treatment: receipt.treatment,
      insuranceCovered: receipt.insuranceCovered === true,
      expenseDate: receipt.expenseDate || null
    }));
}

export function approvedReceiptTotals(receipts = [], teacherId, month) {
  return approvedReceiptEarnings(receipts, teacherId, month).reduce((totals, receipt) => {
    totals[receipt.category] += receipt.amount;
    totals.total += receipt.amount;
    return totals;
  }, { transport: 0, parking: 0, total: 0 });
}

export function validateExpenseReceiptDraft(receipt = {}) {
  if (!/^\d{4}-\d{2}$/.test(String(receipt.month || ""))) return "급여 월을 확인해 주세요.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(receipt.expenseDate || ""))) return "사용 날짜를 확인해 주세요.";
  if (!Object.hasOwn(EXPENSE_CATEGORY_LABELS, receipt.category)) return "교통비 또는 주차비를 선택해 주세요.";
  const amount = Number(receipt.amount);
  if (!Number.isInteger(amount) || amount <= 0 || amount > 10000000) return "금액은 1원부터 1,000만원까지 1원 단위로 입력해 주세요.";
  if (String(receipt.note || "").length > 200) return "메모는 200자 이내로 입력해 주세요.";
  return null;
}

export function validateReceiptFile(file) {
  if (!file) return "영수증 이미지 또는 PDF 파일을 선택해 주세요.";
  if (!RECEIPT_ALLOWED_MIME_TYPES.has(file.type)) return "JPG, PNG, WebP 또는 PDF 파일만 제출할 수 있습니다.";
  if (Number(file.size) <= 0) return "비어 있는 파일은 제출할 수 없습니다.";
  if (Number(file.size) > RECEIPT_MAX_FILE_BYTES) return "파일 크기는 5MB 이하여야 합니다.";
  return null;
}
