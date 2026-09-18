import { retirementId, buildRetirementConfirmation } from "./retirement.js";
import { excelSnapshot } from "./payroll-excel-state.js";

export function createRetirementStore({ firestoreSdk: sdk, db, auth }) {
  const ref = (collection, id) => sdk.doc(db, collection, id);
  const data = (snapshot) => snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;

  async function loadRetirementData(teacherId) {
    const [settings, records] = await Promise.all([
      sdk.getDoc(ref("retirementSettings", teacherId)),
      sdk.getDocs(sdk.query(sdk.collection(db, "retirementContributions"), sdk.where("teacherId", "==", teacherId)))
    ]);
    return { settings: data(settings), records: records.docs.map(data) };
  }

  async function saveRetirementSettings(teacherId, enabled, expected) {
    if (typeof enabled !== "boolean") throw new Error("퇴직연금 대상 여부를 확인해 주세요.");
    await sdk.runTransaction(db, async (transaction) => {
      const settingsRef = ref("retirementSettings", teacherId);
      const current = data(await transaction.get(settingsRef));
      const teacher = await transaction.get(ref("teachers", teacherId));
      if (!teacher.exists()) throw new Error("선생님 정보를 찾지 못했습니다.");
      if (excelSnapshot(current) !== excelSnapshot(expected)) throw new Error("다른 관리자가 대상 설정을 변경했습니다. 다시 열어 주세요.");
      const now = sdk.serverTimestamp();
      transaction.set(settingsRef, { teacherId, enabled, updatedAt: now, updatedBy: auth.currentUser.uid });
      transaction.set(ref("auditLogs", crypto.randomUUID()), {
        action: "RETIREMENT_SETTINGS_UPDATED", teacherId, enabled, actorUid: auth.currentUser.uid, createdAt: now
      });
    });
  }

  async function confirmRetirementContribution(input, expected, actorName) {
    const id = retirementId(input.month, input.teacherId);
    await sdk.runTransaction(db, async (transaction) => {
      const [current, settings, payslip, run] = await Promise.all([
        transaction.get(ref("retirementContributions", id)),
        transaction.get(ref("retirementSettings", input.teacherId)),
        transaction.get(ref("payslips", id)),
        transaction.get(ref("payrollRuns", input.month))
      ]);
      if (excelSnapshot(data(current)) !== excelSnapshot(expected.record)) throw new Error("다른 관리자가 납입액을 확정했습니다. 다시 열어 주세요.");
      if (!settings.exists() || !settings.data().enabled) throw new Error("DC형 퇴직연금 대상 설정을 먼저 확인해 주세요.");
      if (!run.exists() || run.data().status !== "published" || !payslip.exists()
        || (run.data().revision || 1) !== (payslip.data().revision || 1)
        || excelSnapshot(data(payslip)) !== expected.payslip) {
        throw new Error("급여가 취소되거나 변경되었습니다. 최신 확정본을 다시 확인해 주세요.");
      }
      const record = buildRetirementConfirmation({ ...input, payslip: data(payslip), previous: data(current) });
      const confirmationId = crypto.randomUUID();
      const confirmedAt = sdk.serverTimestamp();
      const saved = { ...record, confirmationId, confirmedAt, confirmedBy: auth.currentUser.uid,
        confirmedName: String(actorName || "관리자").slice(0, 100) };
      transaction.set(ref("retirementContributions", id), saved);
      transaction.set(sdk.doc(db, "retirementContributions", id, "history", confirmationId), saved);
      transaction.set(ref("auditLogs", crypto.randomUUID()), {
        action: "RETIREMENT_CONTRIBUTION_CONFIRMED", teacherId: input.teacherId, month: input.month,
        revision: saved.revision, actualAmount: saved.actualAmount, actorUid: auth.currentUser.uid, createdAt: confirmedAt
      });
    });
  }

  async function loadRetirementHistory(id) {
    const snapshot = await sdk.getDocs(sdk.collection(db, "retirementContributions", id, "history"));
    return snapshot.docs.map(data).sort((a, b) => b.revision - a.revision);
  }

  return { loadRetirementData, saveRetirementSettings, confirmRetirementContribution, loadRetirementHistory };
}
