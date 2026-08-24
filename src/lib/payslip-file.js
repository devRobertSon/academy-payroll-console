export function payslipFilename(academyName, teacherName, month) {
  const academy = safeFilenamePart(academyName) || "academy";
  const teacher = safeFilenamePart(teacherName) || "teacher";
  return `${academy}-${month}-${teacher}-급여명세서.pdf`;
}

export async function createPayslipPdfFile(element, { academyName, teacherName, month }) {
  if (!element) throw new Error("PDF로 만들 급여명세서를 찾지 못했습니다.");
  if (typeof window.html2pdf !== "function") throw new Error("PDF 생성 모듈을 불러오지 못했습니다. 페이지를 새로고침해 주세요.");

  const filename = payslipFilename(academyName, teacherName, month);
  element.classList.add("pdf-export");
  try {
    const worker = window.html2pdf().set({
      margin: [7, 7, 7, 7],
      filename,
      image: { type: "jpeg", quality: 0.97 },
      html2canvas: {
        scale: 2,
        useCORS: true,
        backgroundColor: "#ffffff",
        logging: false
      },
      jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
      pagebreak: { mode: ["css", "legacy"], avoid: ["tr", ".payslip-totals"] }
    }).from(element).toPdf();
    const blob = await worker.outputPdf("blob");
    return new File([blob], filename, { type: "application/pdf", lastModified: Date.now() });
  } finally {
    element.classList.remove("pdf-export");
  }
}

export function downloadFile(file) {
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = file.name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function safeFilenamePart(value) {
  return String(value ?? "")
    .trim()
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "")
    .slice(0, 60);
}
