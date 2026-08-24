export const formatWon = (value) => `${new Intl.NumberFormat("ko-KR").format(Math.round(Number(value) || 0))}원`;
export const formatNumber = (value) => new Intl.NumberFormat("ko-KR").format(Math.round(Number(value) || 0));
export const formatHours = (value) => `${Number(value || 0).toLocaleString("ko-KR", { maximumFractionDigits: 1 })}시간`;

export function formatMonth(month) {
  const [year, monthNumber] = month.split("-");
  return `${year}년 ${Number(monthNumber)}월`;
}

export function downloadCsv(filename, rows) {
  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
  const blob = new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

