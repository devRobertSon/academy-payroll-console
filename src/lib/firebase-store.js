import { GMAIL_SEND_SCOPE } from "./gmail.js";
import { WORK_HOURS_NOTIFICATION_TYPE, workHoursNotificationId } from "./admin-notifications.js";
import { EXPENSE_RECEIPT_NOTIFICATION_TYPE, expenseReceiptNotificationId } from "./expense-receipts.js";
import { assertTeacherAccountLink, teacherAccountUpdate } from "./teacher-account.js";

const FIREBASE_VERSION = "12.17.1";
const sdk = (module) => `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-${module}.js`;

const HELP_SYSTEM_INSTRUCTION = `당신은 Academy Payroll Console의 사용법과 합법적인 회계·세무 검토를 돕는 한국어 도우미입니다.
제공된 사용 설명서와 공식 근거 발췌만 사용하고, 근거에 없는 최신 세율·공제 한도·신고 기한을 추측하지 마세요.
세무 질문에는 사실관계와 소득 구분, 원천징수와 최종 신고의 차이, 적용 가능한 공제·필요경비, 필요한 증빙, 확인할 신고 절차 순서로 답하세요.
익명·가상 금액을 이용한 단순 예시는 가능하지만 확정 세액이나 신고 결론처럼 말하지 말고, 전제와 확인이 필요한 항목을 분명히 밝히세요.
근로소득·사업소득 구분은 세금을 줄이기 위해 선택하는 항목이 아니라 실제 고용관계와 업무 실질에 따라 판단해야 합니다.
소득 누락, 허위 계약, 가공 경비·영수증, 명의 분산, 지급 쪼개기, 소급 문서 작성 등 탈세나 위법한 방법은 거절하고 합법적인 대안을 안내하세요.
개인정보나 실제 개인별 급여자료를 요청하지 마세요. 이 도우미는 Firestore의 선생님·급여 데이터를 읽지 않으며 데이터를 수정·확정·발송할 수도 없습니다.
개별 사례는 기장 회계사·세무사·노무사 또는 국세청 126에 최종 확인하도록 안내하고, 가능하면 발췌에 포함된 공식 출처를 함께 제시하세요.`;

export function accessRequestAction(accessRequest) {
  if (!accessRequest) return "create";
  if (accessRequest.status === "rejected") return "resubmit";
  return "wait";
}

export function payrollRunCancellationUpdate(run, common = {}) {
  return {
    status: "cancelled",
    revision: run.revision,
    cancellationId: run.cancellationId,
    cancellationReason: run.cancellationReason,
    ...common
  };
}

export async function createFirebaseStore(config) {
  const [appSdk, authSdk, firestoreSdk, appCheckSdk] = await Promise.all([
    import(sdk("app")),
    import(sdk("auth")),
    import(sdk("firestore")),
    import(sdk("app-check"))
  ]);

  const app = appSdk.initializeApp(config);
  let appCheck = null;
  if (config.appCheckEnterpriseSiteKey) {
    appCheck = appCheckSdk.initializeAppCheck(app, {
      provider: new appCheckSdk.ReCaptchaEnterpriseProvider(config.appCheckEnterpriseSiteKey),
      isTokenAutoRefreshEnabled: true
    });
  }
  const auth = authSdk.getAuth(app);
  const db = firestoreSdk.getFirestore(app);
  let gmailAccessToken = null;
  let gmailAccessTokenExpiresAt = 0;
  let helpModel = null;
  let helpModelName = null;
  await authSdk.setPersistence(auth, authSdk.browserLocalPersistence);

  async function sessionFromUser(firebaseUser) {
    if (!firebaseUser) return null;
    const userSnap = await firestoreSdk.getDoc(firestoreSdk.doc(db, "users", firebaseUser.uid));
    if (!userSnap.exists()) {
      const accessRequest = await createAccessRequest(firebaseUser);
      await authSdk.signOut(auth);
      if (accessRequest.action === "resubmit") {
        throw new Error("승인 요청을 다시 보냈습니다. 관리자가 승인한 뒤 다시 로그인해 주세요.");
      }
      throw new Error(accessRequest.action === "create"
        ? "계정 승인 요청을 보냈습니다. 관리자가 연결한 뒤 다시 로그인해 주세요."
        : "계정 승인 요청이 대기 중입니다. 관리자가 연결한 뒤 다시 로그인해 주세요.");
    }
    const accountData = userSnap.data();
    if (accountData.status !== "active") {
      await authSdk.signOut(auth);
      throw new Error("비활성화된 계정입니다. 관리자에게 문의해 주세요.");
    }
    return {
      uid: firebaseUser.uid,
      email: firebaseUser.email,
      name: accountData.displayName || firebaseUser.displayName || firebaseUser.email,
      ...accountData
    };
  }

  async function createAccessRequest(firebaseUser) {
    const reference = firestoreSdk.doc(db, "accessRequests", firebaseUser.uid);
    const snapshot = await firestoreSdk.getDoc(reference);
    const existingRequest = snapshot.exists() ? snapshot.data() : null;
    const action = accessRequestAction(existingRequest);
    if (action === "wait") return { ...existingRequest, action };
    await firestoreSdk.setDoc(reference, {
      uid: firebaseUser.uid,
      email: firebaseUser.email || "",
      displayName: firebaseUser.displayName || firebaseUser.email || "승인 대기 사용자",
      status: "pending",
      requestedAt: firestoreSdk.serverTimestamp()
    });
    return { status: "pending", action };
  }

  async function signIn() {
    const provider = new authSdk.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    try {
      const credential = await authSdk.signInWithPopup(auth, provider);
      return sessionFromUser(credential.user);
    } catch (error) {
      if (error.code === "auth/popup-blocked") {
        throw new Error("Google 로그인 창이 차단되었습니다. 팝업을 허용한 뒤 다시 시도해 주세요.");
      }
      if (["auth/popup-closed-by-user", "auth/cancelled-popup-request"].includes(error.code)) {
        throw new Error("Google 로그인이 취소되었습니다. 다시 로그인해 주세요.");
      }
      if (["auth/operation-not-supported-in-this-environment", "auth/web-storage-unsupported"].includes(error.code)) {
        throw new Error("이 브라우저에서는 Google 로그인을 사용할 수 없습니다. Safari 또는 Chrome에서 링크를 직접 열어 주세요.");
      }
      throw error;
    }
  }

  async function restoreSession() {
    const firebaseUser = await new Promise((resolve) => {
      const unsubscribe = authSdk.onAuthStateChanged(auth, (user) => {
        unsubscribe();
        resolve(user);
      });
    });
    return sessionFromUser(firebaseUser);
  }

  async function loadCollection(path, constraints = []) {
    const reference = constraints.length
      ? firestoreSdk.query(firestoreSdk.collection(db, path), ...constraints)
      : firestoreSdk.collection(db, path);
    const snapshot = await firestoreSdk.getDocs(reference);
    return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
  }

  async function loadWorkspace(user) {
    if (user.role === "admin") {
      const [teachers, payrollRuns, taxPolicies, insurancePolicies, payrollOverrides, teacherMonthlyInputs, expenseReceipts, adminNotifications, payslips, payslipVersions, payslipReceipts, payslipDeliveries, payrollCancellations, accessRequests] = await Promise.all([
        loadCollection("teachers"),
        loadCollection("payrollRuns"),
        loadCollection("taxPolicies"),
        loadCollection("insurancePolicies"),
        loadCollection("payrollOverrides"),
        loadCollection("teacherMonthlyInputs"),
        loadCollection("expenseReceipts"),
        loadCollection("adminNotifications"),
        loadCollection("payslips"),
        loadCollection("payslipVersions"),
        loadCollection("payslipReceipts"),
        loadCollection("payslipDeliveries"),
        loadCollection("payrollCancellations"),
        loadCollection("accessRequests")
      ]);
      return {
        teachers,
        payrollRuns,
        taxPolicies,
        insurancePolicies,
        payrollOverrides,
        teacherMonthlyInputs,
        expenseReceipts,
        adminNotifications,
        payslips,
        payslipVersions,
        payslipReceipts,
        payslipDeliveries,
        payrollCancellations,
        accessRequests
      };
    }

    const [payslips, teacherMonthlyInputs, expenseReceipts, payrollRuns] = await Promise.all([
      loadCollection("payslips", [
        firestoreSdk.where("teacherUid", "==", user.uid),
        firestoreSdk.where("status", "==", "published")
      ]),
      loadCollection("teacherMonthlyInputs", [
        firestoreSdk.where("teacherUid", "==", user.uid),
        firestoreSdk.where("teacherId", "==", user.teacherId)
      ]),
      loadCollection("expenseReceipts", [
        firestoreSdk.where("teacherUid", "==", user.uid),
        firestoreSdk.where("teacherId", "==", user.teacherId)
      ]),
      loadCollection("payrollRuns")
    ]);
    const teacherSnap = user.teacherId
      ? await firestoreSdk.getDoc(firestoreSdk.doc(db, "teachers", user.teacherId))
      : null;
    return {
      payslips,
      teacherMonthlyInputs,
      expenseReceipts,
      payrollRuns,
      teachers: teacherSnap?.exists() ? [{ id: teacherSnap.id, ...teacherSnap.data() }] : []
    };
  }

  async function saveDocument(collectionName, id, data) {
    const reference = id
      ? firestoreSdk.doc(db, collectionName, id)
      : firestoreSdk.doc(firestoreSdk.collection(db, collectionName));
    await firestoreSdk.setDoc(reference, {
      ...data,
      updatedAt: firestoreSdk.serverTimestamp(),
      updatedBy: auth.currentUser.uid
    }, { merge: true });
    return reference.id;
  }

  async function approveTeacherAccess(request, teacher, { createTeacher = false } = {}) {
    return firestoreSdk.runTransaction(db, async (batch) => {
      const userReference = firestoreSdk.doc(db, "users", request.uid);
      const teacherReference = firestoreSdk.doc(db, "teachers", teacher.id);
      const requestReference = firestoreSdk.doc(db, "accessRequests", request.uid);
      const userSnap = await batch.get(userReference);
      const teacherSnap = await batch.get(teacherReference);
      const requestSnap = await batch.get(requestReference);
      if (!requestSnap.exists() || requestSnap.data().status !== "pending") {
        throw new Error("이미 처리된 승인 요청입니다. 새로고침해 주세요.");
      }
      if (createTeacher ? teacherSnap.exists() : !teacherSnap.exists()) {
        throw new Error("선생님 등록 상태가 변경됐습니다. 새로고침해 주세요.");
      }
      const currentTeacher = createTeacher ? teacher : { id: teacher.id, ...teacherSnap.data() };
      if (currentTeacher.status !== "active"
        || currentTeacher.email.trim().toLowerCase() !== requestSnap.data().email.trim().toLowerCase()) {
        throw new Error("활성 선생님의 Google 이메일과 승인 요청이 일치해야 합니다.");
      }
      const reviewedAt = firestoreSdk.serverTimestamp();
      batch.set(userReference, {
        ...teacherAccountUpdate(userSnap.exists() ? userSnap.data() : null, currentTeacher, request.uid),
        updatedAt: reviewedAt,
        updatedBy: auth.currentUser.uid
      }, { merge: true });
      const linkedTeacher = {
        ...teacher,
        authUid: request.uid,
        updatedAt: reviewedAt,
        updatedBy: auth.currentUser.uid
      };
      if (createTeacher) batch.set(teacherReference, linkedTeacher);
      else batch.update(teacherReference, {
        authUid: request.uid,
        updatedAt: reviewedAt,
        updatedBy: auth.currentUser.uid
      });
      batch.update(firestoreSdk.doc(db, "accessRequests", request.uid), {
        status: "approved",
        teacherId: teacher.id,
        reviewedAt,
        reviewedBy: auth.currentUser.uid
      });
      batch.set(firestoreSdk.doc(db, "auditLogs", crypto.randomUUID()), {
        action: "TEACHER_ACCESS_APPROVED",
        teacherId: teacher.id,
        subjectUid: request.uid,
        actorUid: auth.currentUser.uid,
        createdAt: reviewedAt
      });
    });
  }

  async function linkAdminTeacher(teacher, { createTeacher = false } = {}) {
    return firestoreSdk.runTransaction(db, async (transaction) => {
      const uid = auth.currentUser.uid;
      const userReference = firestoreSdk.doc(db, "users", uid);
      const teacherReference = firestoreSdk.doc(db, "teachers", teacher.id);
      const userSnap = await transaction.get(userReference);
      const teacherSnap = await transaction.get(teacherReference);
      const account = userSnap.exists() ? userSnap.data() : null;
      if (account?.role !== "admin" || account.status !== "active") {
        throw new Error("활성 관리자 계정으로 다시 로그인해 주세요.");
      }
      if (createTeacher ? teacherSnap.exists() : !teacherSnap.exists()) {
        throw new Error("선생님 등록 상태가 변경됐습니다. 새로고침 후 다시 연결해 주세요.");
      }
      const currentTeacher = createTeacher ? teacher : { id: teacher.id, ...teacherSnap.data() };
      assertTeacherAccountLink(account, currentTeacher, uid);
      if (currentTeacher.status !== "active"
        || currentTeacher.email.trim().toLowerCase() !== String(auth.currentUser.email).trim().toLowerCase()) {
        throw new Error("본인 Google 이메일의 활성 선생님 정보만 연결할 수 있습니다.");
      }
      const common = { updatedAt: firestoreSdk.serverTimestamp(), updatedBy: uid };
      const linked = { ...currentTeacher, authUid: uid, ...common };
      if (createTeacher) transaction.set(teacherReference, linked);
      else transaction.update(teacherReference, { authUid: uid, ...common });
      transaction.update(userReference, { teacherId: teacher.id, ...common });
      transaction.set(firestoreSdk.doc(db, "auditLogs", crypto.randomUUID()), {
        action: "ADMIN_TEACHER_LINKED", teacherId: teacher.id, subjectUid: uid,
        actorUid: uid, createdAt: common.updatedAt
      });
      return linked;
    });
  }

  async function rejectTeacherAccess(request) {
    const batch = firestoreSdk.writeBatch(db);
    const reviewedAt = firestoreSdk.serverTimestamp();
    batch.update(firestoreSdk.doc(db, "accessRequests", request.uid || request.id), {
      status: "rejected",
      reviewedAt,
      reviewedBy: auth.currentUser.uid
    });
    batch.set(firestoreSdk.doc(db, "auditLogs", crypto.randomUUID()), {
      action: "TEACHER_ACCESS_REJECTED",
      subjectUid: request.uid || request.id,
      actorUid: auth.currentUser.uid,
      createdAt: reviewedAt
    });
    await batch.commit();
  }

  async function updateTeacher(teacher) {
    return firestoreSdk.runTransaction(db, async (batch) => {
      const teacherReference = firestoreSdk.doc(db, "teachers", teacher.id);
      const current = await batch.get(teacherReference);
      if (!current.exists() || (current.data().authUid || null) !== (teacher.authUid || null)) {
        throw new Error("선생님 연결 상태가 변경됐습니다. 새로고침해 주세요.");
      }
      const account = teacher.authUid
        ? await batch.get(firestoreSdk.doc(db, "users", teacher.authUid)) : null;
      const accountUpdate = teacher.authUid
        ? teacherAccountUpdate(account?.exists() ? account.data() : null, teacher, teacher.authUid) : null;
      const updatedAt = firestoreSdk.serverTimestamp();
      batch.set(firestoreSdk.doc(db, "teachers", teacher.id), {
        ...teacher,
        updatedAt,
        updatedBy: auth.currentUser.uid
      }, { merge: true });
      if (teacher.authUid) {
        batch.set(firestoreSdk.doc(db, "users", teacher.authUid), {
          ...accountUpdate,
          updatedAt,
          updatedBy: auth.currentUser.uid
        }, { merge: true });
      }
      batch.set(firestoreSdk.doc(db, "auditLogs", crypto.randomUUID()), {
        action: "TEACHER_UPDATED",
        teacherId: teacher.id,
        status: teacher.status,
        actorUid: auth.currentUser.uid,
        createdAt: updatedAt
      });
    });
  }

  async function deleteTeacher(teacher, cleanupReferences = []) {
    if (!teacher?.id) throw new Error("삭제할 선생님 정보를 확인할 수 없습니다.");
    if (cleanupReferences.length > 490) throw new Error("정리할 미확정 기록이 너무 많습니다. 관리자에게 문의해 주세요.");
    return firestoreSdk.runTransaction(db, async (batch) => {
      const current = await batch.get(firestoreSdk.doc(db, "teachers", teacher.id));
      if (!current.exists() || (current.data().authUid || null) !== (teacher.authUid || null)) {
        throw new Error("선생님 연결 상태가 변경됐습니다. 새로고침해 주세요.");
      }
      const userReference = teacher.authUid ? firestoreSdk.doc(db, "users", teacher.authUid) : null;
      const accountSnap = userReference ? await batch.get(userReference) : null;
      const account = accountSnap?.exists() ? accountSnap.data() : null;
      if (teacher.authUid) assertTeacherAccountLink(account, teacher, teacher.authUid);
      const deletedAt = firestoreSdk.serverTimestamp();
      const allowedCleanupCollections = new Set(["teacherMonthlyInputs", "payrollOverrides", "adminNotifications"]);
      cleanupReferences.forEach(({ collection, id }) => {
        if (allowedCleanupCollections.has(collection) && id) {
          batch.delete(firestoreSdk.doc(db, collection, id));
        }
      });
      batch.delete(firestoreSdk.doc(db, "teachers", teacher.id));
      if (teacher.authUid) {
        if (account?.role === "admin") {
          batch.update(userReference, {
            teacherId: firestoreSdk.deleteField(), updatedAt: deletedAt, updatedBy: auth.currentUser.uid
          });
        } else {
          batch.delete(userReference);
          batch.delete(firestoreSdk.doc(db, "accessRequests", teacher.authUid));
        }
      }
      batch.set(firestoreSdk.doc(db, "auditLogs", crypto.randomUUID()), {
        action: "TEACHER_DELETED",
        teacherId: teacher.id,
        subjectUid: teacher.authUid || null,
        removedDraftReferenceCount: cleanupReferences.length,
        actorUid: auth.currentUser.uid,
        createdAt: deletedAt
      });
    });
  }

  async function saveTeacherProfile(teacherId, profile) {
    const batch = firestoreSdk.writeBatch(db);
    const updatedAt = firestoreSdk.serverTimestamp();
    batch.update(firestoreSdk.doc(db, "teachers", teacherId), {
      ...profile,
      updatedAt,
      updatedBy: auth.currentUser.uid
    });
    batch.update(firestoreSdk.doc(db, "users", auth.currentUser.uid), {
      displayName: profile.name,
      updatedAt,
      updatedBy: auth.currentUser.uid
    });
    await batch.commit();
  }

  async function saveTeacherMonthlyInput(input) {
    const batch = firestoreSdk.writeBatch(db);
    const submittedAt = firestoreSdk.serverTimestamp();
    const monthlyData = {
      teacherId: input.teacherId,
      teacherUid: input.teacherUid,
      month: input.month,
      employeeWorkHours: input.employeeWorkHours,
      businessHours: input.businessHours,
      tuitionInput: input.tuitionInput ?? firestoreSdk.deleteField(),
      submittedAt,
      updatedAt: submittedAt,
      updatedBy: auth.currentUser.uid
    };
    // Replace nested tuition data so a new total does not retain legacy groups.
    batch.set(firestoreSdk.doc(db, "teacherMonthlyInputs", input.id), monthlyData, { mergeFields: Object.keys(monthlyData) });
    batch.set(firestoreSdk.doc(db, "adminNotifications", workHoursNotificationId(input.month, input.teacherId)), {
      type: WORK_HOURS_NOTIFICATION_TYPE,
      teacherId: input.teacherId,
      teacherUid: input.teacherUid,
      month: input.month,
      status: "unread",
      submittedAt,
      readAt: null,
      readBy: null
    }, { merge: true });
    await batch.commit();
  }

  async function saveExpenseReceipt(receipt) {
    const batch = firestoreSdk.writeBatch(db);
    const submittedAt = firestoreSdk.serverTimestamp();
    batch.set(firestoreSdk.doc(db, "expenseReceipts", receipt.id), {
      id: receipt.id,
      teacherId: receipt.teacherId,
      teacherUid: receipt.teacherUid,
      month: receipt.month,
      expenseDate: receipt.expenseDate,
      category: receipt.category,
      amount: receipt.amount,
      note: receipt.note || "",
      status: "pending",
      treatment: "pending",
      insuranceCovered: false,
      fileId: receipt.fileId,
      fileName: receipt.fileName,
      mimeType: receipt.mimeType,
      sizeBytes: receipt.sizeBytes,
      sha256: receipt.sha256,
      submittedAt,
      reviewedAt: null,
      reviewedBy: null,
      reviewNote: "",
      updatedAt: submittedAt,
      updatedBy: auth.currentUser.uid
    });
    batch.set(firestoreSdk.doc(db, "adminNotifications", expenseReceiptNotificationId(receipt.id)), {
      type: EXPENSE_RECEIPT_NOTIFICATION_TYPE,
      receiptId: receipt.id,
      teacherId: receipt.teacherId,
      teacherUid: receipt.teacherUid,
      month: receipt.month,
      category: receipt.category,
      amount: receipt.amount,
      status: "unread",
      submittedAt,
      readAt: null,
      readBy: null
    });
    await batch.commit();
  }

  async function reviewExpenseReceipt(receipt, review) {
    const batch = firestoreSdk.writeBatch(db);
    const reviewedAt = firestoreSdk.serverTimestamp();
    batch.update(firestoreSdk.doc(db, "expenseReceipts", receipt.id), {
      status: review.status,
      treatment: review.status === "approved" ? review.treatment : "pending",
      insuranceCovered: review.status === "approved" && review.insuranceCovered === true,
      reviewNote: review.reviewNote || "",
      reviewedAt,
      reviewedBy: auth.currentUser.uid,
      updatedAt: reviewedAt,
      updatedBy: auth.currentUser.uid
    });
    batch.set(firestoreSdk.doc(db, "auditLogs", crypto.randomUUID()), {
      action: review.status === "approved" ? "EXPENSE_RECEIPT_APPROVED" : "EXPENSE_RECEIPT_REJECTED",
      receiptId: receipt.id,
      teacherId: receipt.teacherId,
      month: receipt.month,
      actorUid: auth.currentUser.uid,
      createdAt: reviewedAt
    });
    await batch.commit();
  }

  async function deleteExpenseReceipt(receipt) {
    const batch = firestoreSdk.writeBatch(db);
    batch.delete(firestoreSdk.doc(db, "expenseReceipts", receipt.id));
    batch.delete(firestoreSdk.doc(db, "adminNotifications", expenseReceiptNotificationId(receipt.id)));
    await batch.commit();
  }

  async function markAdminNotificationRead(notificationId) {
    await firestoreSdk.updateDoc(firestoreSdk.doc(db, "adminNotifications", notificationId), {
      status: "read",
      readAt: firestoreSdk.serverTimestamp(),
      readBy: auth.currentUser.uid
    });
  }

  async function saveAdminMonthlyPayroll(override, monthlyInput = null) {
    const batch = firestoreSdk.writeBatch(db);
    const updatedAt = firestoreSdk.serverTimestamp();
    batch.set(firestoreSdk.doc(db, "payrollOverrides", override.id), {
      ...override,
      updatedAt,
      updatedBy: auth.currentUser.uid
    }, { merge: true });
    if (monthlyInput) {
      const monthlyData = {
        teacherId: monthlyInput.teacherId,
        teacherUid: monthlyInput.teacherUid,
        month: monthlyInput.month,
        employeeWorkHours: monthlyInput.employeeWorkHours,
        businessHours: monthlyInput.businessHours,
        tuitionInput: monthlyInput.tuitionInput ?? firestoreSdk.deleteField(),
        submittedAt: updatedAt,
        updatedAt,
        updatedBy: auth.currentUser.uid
      };
      batch.set(firestoreSdk.doc(db, "teacherMonthlyInputs", monthlyInput.id), monthlyData, { mergeFields: Object.keys(monthlyData) });
    }
    await batch.commit();
  }

  async function publishPayrollRun(run, payslips, auditLog) {
    const batch = firestoreSdk.writeBatch(db);
    const common = {
      updatedAt: firestoreSdk.serverTimestamp(),
      updatedBy: auth.currentUser.uid
    };
    payslips.forEach((payslip) => {
      batch.set(firestoreSdk.doc(db, "payslips", payslip.id), { ...payslip.data, ...common });
      batch.set(firestoreSdk.doc(db, "payslipVersions", payslip.versionId), { ...payslip.data, ...common });
    });
    batch.set(firestoreSdk.doc(db, "payrollRuns", run.month), { ...run, ...common });
    batch.set(firestoreSdk.doc(db, "auditLogs", auditLog.id), auditLog.data);
    await batch.commit();
  }

  async function cancelPayrollRun(run, payslips, archives, cancellation, auditLog) {
    const batch = firestoreSdk.writeBatch(db);
    const common = {
      updatedAt: firestoreSdk.serverTimestamp(),
      updatedBy: auth.currentUser.uid
    };
    const missingArchives = await Promise.all(archives.map(async (archive) => {
      const reference = firestoreSdk.doc(db, "payslipVersions", archive.id);
      return (await firestoreSdk.getDoc(reference)).exists() ? null : { archive, reference };
    }));
    missingArchives.filter(Boolean).forEach(({ archive, reference }) => {
      batch.set(reference, { ...archive.data, ...common });
    });
    payslips.forEach((payslip) => {
      batch.update(firestoreSdk.doc(db, "payslips", payslip.id), {
        status: "cancelled",
        cancellationId: cancellation.id,
        cancellationReason: cancellation.data.reason,
        cancelledAt: firestoreSdk.serverTimestamp(),
        ...common
      });
    });
    batch.update(firestoreSdk.doc(db, "payrollRuns", run.month), payrollRunCancellationUpdate(run, {
      cancelledAt: firestoreSdk.serverTimestamp(),
      ...common
    }));
    batch.set(firestoreSdk.doc(db, "payrollCancellations", cancellation.id), {
      ...cancellation.data,
      createdAt: firestoreSdk.serverTimestamp()
    });
    batch.set(firestoreSdk.doc(db, "auditLogs", auditLog.id), {
      ...auditLog.data,
      createdAt: firestoreSdk.serverTimestamp()
    });
    await batch.commit();
  }

  async function recordPayslipView(payslipId, teacherId, month, revision) {
    const receiptId = `${payslipId}_v${revision}_${auth.currentUser.uid}`;
    const reference = firestoreSdk.doc(db, "payslipReceipts", receiptId);
    if ((await firestoreSdk.getDoc(reference)).exists()) return;
    await firestoreSdk.setDoc(reference, {
      payslipId,
      teacherId,
      teacherUid: auth.currentUser.uid,
      month,
      revision,
      viewedAt: firestoreSdk.serverTimestamp()
    });
  }

  async function authorizeGmailSend() {
    if (gmailAccessToken && Date.now() < gmailAccessTokenExpiresAt) return gmailAccessToken;
    if (!auth.currentUser) throw new Error("관리자 Google 계정으로 다시 로그인해 주세요.");

    const provider = new authSdk.GoogleAuthProvider();
    provider.addScope(GMAIL_SEND_SCOPE);
    provider.setCustomParameters({ login_hint: auth.currentUser.email || "" });
    const result = await authSdk.reauthenticateWithPopup(auth.currentUser, provider);
    const credential = authSdk.GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) throw new Error("Gmail 발송 권한을 확인하지 못했습니다.");
    gmailAccessToken = credential.accessToken;
    gmailAccessTokenExpiresAt = Date.now() + 50 * 60 * 1000;
    return gmailAccessToken;
  }

  async function sendGmailMessage(raw) {
    const accessToken = await authorizeGmailSend();
    const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ raw })
    });
    if (!response.ok) {
      if (response.status === 401) {
        gmailAccessToken = null;
        gmailAccessTokenExpiresAt = 0;
      }
      if (response.status === 403) throw new Error("Gmail API 활성화와 gmail.send 권한 승인을 확인해 주세요.");
      const details = await response.json().catch(() => null);
      throw new Error(details?.error?.message || "Gmail에서 메일을 발송하지 못했습니다.");
    }
    return response.json();
  }

  async function recordPayslipDelivery(delivery, preferredId = null) {
    const id = preferredId || crypto.randomUUID();
    const reference = firestoreSdk.doc(db, "payslipDeliveries", id);
    if (preferredId) {
      const existing = await firestoreSdk.getDoc(reference);
      if (existing.exists()) return { id, ...existing.data() };
    }
    const sentAt = new Date().toISOString();
    await firestoreSdk.setDoc(reference, {
      ...delivery,
      sentBy: auth.currentUser.uid,
      sentAt: firestoreSdk.serverTimestamp()
    });
    return { id, ...delivery, sentBy: auth.currentUser.uid, sentAt };
  }

  async function askHelpAssistant(prompt, modelName) {
    if (!auth.currentUser) throw new Error("관리자 Google 계정으로 다시 로그인해 주세요.");
    if (!helpModel || helpModelName !== modelName) {
      const aiSdk = await import(sdk("ai"));
      const ai = aiSdk.getAI(app, { backend: new aiSdk.GoogleAIBackend() });
      helpModel = aiSdk.getGenerativeModel(ai, {
        model: modelName,
        systemInstruction: HELP_SYSTEM_INSTRUCTION,
        generationConfig: { temperature: 0.2, maxOutputTokens: 700 }
      });
      helpModelName = modelName;
    }
    const result = await helpModel.generateContent(prompt);
    const answer = result.response.text().trim();
    if (!answer) throw new Error("Gemini가 답변을 만들지 못했습니다.");
    return answer;
  }

  async function signOut() {
    gmailAccessToken = null;
    gmailAccessTokenExpiresAt = 0;
    await authSdk.signOut(auth);
  }

  async function getIdToken() {
    if (!auth.currentUser) throw new Error("Google 계정으로 다시 로그인해 주세요.");
    return auth.currentUser.getIdToken();
  }

  async function getAppCheckToken() {
    if (!auth.currentUser) throw new Error("Google 계정으로 다시 로그인해 주세요.");
    if (!appCheck) throw new Error("App Check 보안 인증 설정을 확인해 주세요.");
    const result = await appCheckSdk.getToken(appCheck);
    return result.token;
  }

  return {
    signIn,
    restoreSession,
    signOut,
    loadWorkspace,
    saveDocument,
    approveTeacherAccess,
    linkAdminTeacher,
    rejectTeacherAccess,
    updateTeacher,
    deleteTeacher,
    saveTeacherProfile,
    saveTeacherMonthlyInput,
    saveExpenseReceipt,
    reviewExpenseReceipt,
    deleteExpenseReceipt,
    markAdminNotificationRead,
    saveAdminMonthlyPayroll,
    publishPayrollRun,
    cancelPayrollRun,
    recordPayslipView,
    authorizeGmailSend,
    sendGmailMessage,
    recordPayslipDelivery,
    askHelpAssistant,
    getIdToken,
    getAppCheckToken
  };
}
