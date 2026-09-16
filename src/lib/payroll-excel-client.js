export function payrollExcelJob(data) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./payroll-excel-worker.js", import.meta.url));
    const finish = (error, result) => {
      clearTimeout(timer);
      worker.terminate();
      if (error) reject(new Error(error));
      else resolve(result);
    };
    const timer = setTimeout(() => finish("엑셀 처리 시간이 초과되었습니다. 시트와 불필요한 행을 줄여 다시 시도해 주세요."), 45000);
    worker.onmessage = ({ data: message }) => finish(message.error, message.result);
    worker.onerror = () => finish("엑셀 도구를 불러오지 못했습니다. 페이지를 새로고침한 뒤 다시 시도해 주세요.");
    worker.postMessage(data);
  });
}
