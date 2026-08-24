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
      const [teachers, rateRules, entries, payrollRuns, policies, payrollOverrides, payslipReceipts] = await Promise.all([
        loadCollection("teachers"),
        loadCollection("rateRules"),
        loadCollection("workEntries"),
        loadCollection("payrollRuns"),
        loadCollection("payrollPolicies"),
        loadCollection("payrollOverrides"),
        loadCollection("payslipReceipts")
      ]);
      return { teachers, rateRules, entries, payrollRuns, policies, payrollOverrides, payslipReceipts };
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

  return {
    signIn,
    restoreSession,
    signOut: () => authSdk.signOut(auth),
    loadWorkspace,
    saveDocument,
    publishPayrollRun,
    recordPayslipView
  };
}
