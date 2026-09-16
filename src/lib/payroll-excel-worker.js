/* ExcelJS is loaded locally; workbook contents are never uploaded. */
importScripts("../../vendor/exceljs.min.js");
self.onmessage = async ({ data }) => {
  try {
    const { readPayrollWorkbook, createPayrollWorkbook } = await import("./payroll-excel.js");
    if (data.kind === "read") {
      const book = new ExcelJS.Workbook();
      await book.xlsx.load(data.buffer, { ignoreNodes: ["picture", "drawing", "hyperlinks", "dataValidations", "conditionalFormatting"] });
      self.postMessage({ result: readPayrollWorkbook(book) });
    } else if (data.kind === "write") {
      const book = createPayrollWorkbook(ExcelJS, data.month, data.rows);
      const result = await book.xlsx.writeBuffer();
      self.postMessage({ result });
    } else throw new Error("지원하지 않는 엑셀 작업입니다.");
  } catch (error) { self.postMessage({ error: error.message || "엑셀 파일을 처리하지 못했습니다." }); }
};
