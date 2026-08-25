import { GMAIL_SEND_SCOPE } from "./gmail.js";

const FIREBASE_VERSION = "12.17.1";
const sdk = (module) => `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-${module}.js`;

const HELP_SYSTEM_INSTRUCTION = `당신은 Academy Payroll Console의 사용법 전용 도우미입니다.
제공된 사용 설명서 발췌만 근거로 한국어로 간결하게 답하세요.
급여액을 계산하거나 세무·노무 결론을 내리지 말고, 데이터를 수정·확정·발송했다고 말하지 마세요.
개인정보를 요청하지 마세요. 질문에 개인정보가 보이면 삭제하고 다시 질문하도록 안내하세요.
설명서에 없는 내용은 추측하지 말고 관리자 또는 회계사 확인이 필요하다고 답하세요.`;

export async function createFirebaseStore(config) {
  const [appSdk, authSdk, firestoreSdk, appCheckSdk] = await Promise.all([
    import(sdk("app")),
    import(sdk("auth")),
    import(sdk("firestore")),
    import(sdk("app-check"))
  ]);

  const app = appSdk.initializeApp(config);
  if (config.appCheckSiteKey) {
    appCheckSdk.initializeAppCheck(app, {
      provider: new appCheckSdk.ReCaptchaV3Provider(config.appCheckSiteKey),
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
      await createAccessRequest(firebaseUser);
      await authSdk.signOut(auth);
      throw new Error("계정 승인 요청을 보냈습니다. 관리자가 연결한 뒤 다시 로그인해 주세요.");
    }
    if (userSnap.data().status !== "active") {
      await authSdk.signOut(auth);
      throw new Error("비활성화된 계정입니다. 관리자에게 문의해 주세요.");
    }
    return {
      uid: firebaseUser.uid,
      email: firebaseUser.email,
      name: userSnap.data().displayName || firebaseUser.displayName || firebaseUser.email,
      ...userSnap.data()
    };
  }

  async function createAccessRequest(firebaseUser) {
    const reference = firestoreSdk.doc(db, "accessRequests", firebaseUser.uid);
    if ((await firestoreSdk.getDoc(reference)).exists()) return;
    await firestoreSdk.setDoc(reference, {
      uid: firebaseUser.uid,
      email: firebaseUser.email || "",
      displayName: firebaseUser.displayName || firebaseUser.email || "승인 대기 사용자",
      status: "pending",
      requestedAt: firestoreSdk.serverTimestamp()
    });
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

  async function loadOptionalCollection(path) {
    try {
      return await loadCollection(path);
    } catch (error) {
      console.warn(`${path} 컬렉션을 아직 사용할 수 없습니다. 최신 Firestore 규칙을 게시해 주세요.`, error);
      return [];
    }
  }

  async function loadWorkspace(user) {
    if (user.role === "admin") {
      const [teachers, rateRules, entries, payrollRuns, taxPolicies, insurancePolicies, legacyPolicies, payrollOverrides, payslips, payslipVersions, payslipReceipts, payslipDeliveries, payrollCancellations, accessRequests] = await Promise.all([
        loadCollection("teachers"),
        loadCollection("rateRules"),
        loadCollection("workEntries"),
        loadCollection("payrollRuns"),
        loadCollection("taxPolicies"),
        loadCollection("insurancePolicies"),
        loadCollection("payrollPolicies"),
        loadCollection("payrollOverrides"),
        loadCollection("payslips"),
        loadOptionalCollection("payslipVersions"),
        loadCollection("payslipReceipts"),
        loadCollection("payslipDeliveries"),
        loadOptionalCollection("payrollCancellations"),
        loadOptionalCollection("accessRequests")
      ]);
      return {
        teachers,
        rateRules,
        entries,
        payrollRuns,
        taxPolicies,
        insurancePolicies: insurancePolicies.length ? insurancePolicies : legacyPolicies,
        payrollOverrides,
        payslips,
        payslipVersions,
        payslipReceipts,
        payslipDeliveries,
        payrollCancellations,
        accessRequests
      };
    }

    const payslips = await loadCollection("payslips", [
      firestoreSdk.where("teacherUid", "==", user.uid),
      firestoreSdk.where("status", "==", "published")
    ]);
    const teacherSnap = user.teacherId
      ? await firestoreSdk.getDoc(firestoreSdk.doc(db, "teachers", user.teacherId))
      : null;
    return {
      payslips,
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

  async function approveTeacherAccess(request, teacher) {
    const batch = firestoreSdk.writeBatch(db);
    const reviewedAt = firestoreSdk.serverTimestamp();
    batch.set(firestoreSdk.doc(db, "users", request.uid), {
      displayName: teacher.name,
      email: request.email,
      role: "teacher",
      status: "active",
      teacherId: teacher.id,
      updatedAt: reviewedAt,
      updatedBy: auth.currentUser.uid
    });
    batch.update(firestoreSdk.doc(db, "teachers", teacher.id), {
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
    await batch.commit();
  }

  async function updateTeacher(teacher) {
    const batch = firestoreSdk.writeBatch(db);
    const updatedAt = firestoreSdk.serverTimestamp();
    const { accountingReference: _legacyAccountingReference, ...teacherData } = teacher;
    batch.set(firestoreSdk.doc(db, "teachers", teacher.id), {
      ...teacherData,
      accountingReference: firestoreSdk.deleteField(),
      updatedAt,
      updatedBy: auth.currentUser.uid
    }, { merge: true });
    if (teacher.authUid) {
      batch.set(firestoreSdk.doc(db, "users", teacher.authUid), {
        displayName: teacher.name,
        email: teacher.email,
        role: "teacher",
        status: teacher.status,
        teacherId: teacher.id,
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
    archives.forEach((archive) => {
      batch.set(firestoreSdk.doc(db, "payslipVersions", archive.id), { ...archive.data, ...common });
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
    batch.update(firestoreSdk.doc(db, "payrollRuns", run.month), {
      ...run,
      cancelledAt: firestoreSdk.serverTimestamp(),
      ...common
    });
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

  async function recordPayslipDelivery(delivery) {
    const id = crypto.randomUUID();
    const sentAt = new Date().toISOString();
    await firestoreSdk.setDoc(firestoreSdk.doc(db, "payslipDeliveries", id), {
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

  return {
    signIn,
    restoreSession,
    signOut,
    loadWorkspace,
    saveDocument,
    approveTeacherAccess,
    updateTeacher,
    publishPayrollRun,
    cancelPayrollRun,
    recordPayslipView,
    authorizeGmailSend,
    sendGmailMessage,
    recordPayslipDelivery,
    askHelpAssistant
  };
}

