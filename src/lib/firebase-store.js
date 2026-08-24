import { GMAIL_SEND_SCOPE } from "./gmail.js";

const FIREBASE_VERSION = "11.8.1";
const sdk = (module) => `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-${module}.js`;

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
  await authSdk.setPersistence(auth, authSdk.browserLocalPersistence);

  async function sessionFromUser(firebaseUser) {
    if (!firebaseUser) return null;
    const userSnap = await firestoreSdk.getDoc(firestoreSdk.doc(db, "users", firebaseUser.uid));
    if (!userSnap.exists() || userSnap.data().status !== "active") {
      await authSdk.signOut(auth);
      throw new Error("등록되었거나 활성화된 계정이 아닙니다. 관리자에게 문의해 주세요.");
    }
    return {
      uid: firebaseUser.uid,
      email: firebaseUser.email,
      name: userSnap.data().displayName || firebaseUser.displayName || firebaseUser.email,
      ...userSnap.data()
    };
  }

  async function signIn() {
    const provider = new authSdk.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    if (window.matchMedia("(max-width: 760px)").matches) {
      await authSdk.signInWithRedirect(auth, provider);
      return null;
    }
    const credential = await authSdk.signInWithPopup(auth, provider);
    return sessionFromUser(credential.user);
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
      const [teachers, rateRules, entries, payrollRuns, taxPolicies, insurancePolicies, legacyPolicies, payrollOverrides, payslips, payslipReceipts, payslipDeliveries] = await Promise.all([
        loadCollection("teachers"),
        loadCollection("rateRules"),
        loadCollection("workEntries"),
        loadCollection("payrollRuns"),
        loadCollection("taxPolicies"),
        loadCollection("insurancePolicies"),
        loadCollection("payrollPolicies"),
        loadCollection("payrollOverrides"),
        loadCollection("payslips"),
        loadCollection("payslipReceipts"),
        loadCollection("payslipDeliveries")
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
        payslipReceipts,
        payslipDeliveries
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

  async function publishPayrollRun(run, payslips, auditLog) {
    const batch = firestoreSdk.writeBatch(db);
    const common = {
      updatedAt: firestoreSdk.serverTimestamp(),
      updatedBy: auth.currentUser.uid
    };
    payslips.forEach((payslip) => {
      batch.set(firestoreSdk.doc(db, "payslips", payslip.id), { ...payslip.data, ...common });
    });
    batch.set(firestoreSdk.doc(db, "payrollRuns", run.month), { ...run, ...common });
    batch.set(firestoreSdk.doc(db, "auditLogs", auditLog.id), auditLog.data);
    await batch.commit();
  }

  async function recordPayslipView(payslipId, teacherId, month) {
    const receiptId = `${payslipId}_${auth.currentUser.uid}`;
    const reference = firestoreSdk.doc(db, "payslipReceipts", receiptId);
    if ((await firestoreSdk.getDoc(reference)).exists()) return;
    await firestoreSdk.setDoc(reference, {
      payslipId,
      teacherId,
      teacherUid: auth.currentUser.uid,
      month,
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
    publishPayrollRun,
    recordPayslipView,
    authorizeGmailSend,
    sendGmailMessage,
    recordPayslipDelivery
  };
}
