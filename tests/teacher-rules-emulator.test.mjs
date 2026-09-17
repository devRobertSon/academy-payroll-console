import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { teacherAccountUpdate } from "../src/lib/teacher-account.js";

const host = process.env.FIRESTORE_EMULATOR_HOST;

test("teacher edits pass Firestore rules without changing account permissions", {
  skip: !host && "Requires a local Firestore emulator; never connects to production"
}, async (t) => {
  assert.match(host, /^127\.0\.0\.1:\d+$/, "Only a loopback emulator is allowed");
  const project = "demo-teacher-rules-qa";
  const base = `http://${host}`;
  const root = `projects/${project}/databases/(default)/documents`;
  const prefix = `rules-${randomUUID()}`;
  const editor = `${prefix}-editor`;
  const subject = `${prefix}-subject`;
  const teacherId = `${prefix}-teacher`;

  function token(uid) {
    const now = Math.floor(Date.now() / 1000);
    const encode = (data) => Buffer.from(JSON.stringify(data)).toString("base64url");
    return `${encode({ alg: "none", typ: "JWT" })}.${encode({
      sub: uid, user_id: uid, iss: `https://securetoken.google.com/${project}`,
      aud: project, iat: now, exp: now + 3600, auth_time: now,
      firebase: { sign_in_provider: "custom", identities: {} }
    })}.`;
  }

  function value(input) {
    if (input === null) return { nullValue: null };
    if (typeof input === "string") return { stringValue: input };
    if (typeof input === "boolean") return { booleanValue: input };
    if (typeof input === "number") return Number.isInteger(input)
      ? { integerValue: String(input) } : { doubleValue: input };
    if (Array.isArray(input)) return { arrayValue: { values: input.map(value) } };
    return { mapValue: { fields: fields(input) } };
  }

  function fields(data) {
    return Object.fromEntries(Object.entries(data).map(([key, item]) => [key, value(item)]));
  }

  function write(path, data, merge = false) {
    return { update: { name: `${root}/${path}`, fields: fields(data) },
      ...(merge ? { updateMask: { fieldPaths: Object.keys(data) } } : {}) };
  }

  async function request(path, body, actor = "owner", method = "POST") {
    const response = await fetch(`${base}${path}`, {
      method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${actor}` },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15000)
    });
    return { ok: response.ok, status: response.status, data: await response.json() };
  }

  async function commit(writes, uid) {
    return request(`/v1/${root}:commit`, { writes }, uid ? token(uid) : "owner");
  }

  function allowed(result) { assert.equal(result.ok, true, JSON.stringify(result.data)); }
  function denied(result) {
    assert.equal(result.status, 403, JSON.stringify(result.data));
    assert.equal(result.data.error.status, "PERMISSION_DENIED");
  }

  const rules = await readFile(new URL("../firestore.rules", import.meta.url), "utf8");
  allowed(await request(`/emulator/v1/projects/${project}:securityRules`, {
    rules: { files: [{ content: rules }] }
  }, "owner", "PUT"));

  function fixture(rates = []) {
    const insurance = { enrolled: true, defaultBaseAmount: null, effectiveFrom: "2026-09-01", effectiveTo: null };
    return {
      id: teacherId, name: "Sample Teacher", email: "teacher@example.invalid", phone: "",
      birthDateCode: "900101", genderCode: "1", status: "active", authUid: subject,
      profileCompleted: true, incomeComposition: rates.length ? "mixed" : "employee",
      defaultEmployeePay: 1999995, businessRates: rates,
      insuranceSettings: { nationalPension: { ...insurance }, healthInsurance: { ...insurance }, employmentInsurance: { ...insurance } },
      transportPolicy: { regionLabel: "Example", unitAmount: 20000, treatment: "business" },
      paymentDay: 5, taxProfile: { dependentCount: 1, children8To20: 0, withholdingRatio: 1 }
    };
  }

  async function seed(teacher = fixture(), role = "teacher", editorStatus = "active") {
    const account = { role, status: "active", teacherId, displayName: "Sample Teacher", email: teacher.email };
    allowed(await commit([
      write(`users/${editor}`, { role: "admin", status: editorStatus }),
      write(`users/${subject}`, account),
      write(`teachers/${teacherId}`, teacher)
    ]));
    return account;
  }

  function salaryEdit(teacher) {
    return {
      ...teacher, defaultEmployeePay: 2000000,
      insuranceSettings: Object.fromEntries(Object.entries(teacher.insuranceSettings)
        .map(([key, item]) => [key, { ...item, defaultBaseAmount: 2000000 }])),
      transportPolicy: { ...teacher.transportPolicy, paymentDay: 5 },
      otherPaymentPolicy: { amount: 0, treatment: "pending", insuranceCovered: false },
      updatedBy: editor
    };
  }

  function adminWrites(teacher, account) {
    return [
      write(`teachers/${teacherId}`, teacher, true),
      write(`users/${subject}`, teacherAccountUpdate(account, teacher, subject), true),
      write(`auditLogs/${randomUUID()}`, { action: "TEACHER_UPDATED", teacherId, status: teacher.status, actorUid: editor })
    ];
  }

  const scenarios = [
    ["employee", []],
    ["hourly", [{ id: "hourly", hourlyRate: 30000 }]],
    ["tuition share", [{ id: "share", tuitionShareRate: 37.25 }]],
    ["ten existing hourly rates", Array.from({ length: 10 }, (_, i) => ({ id: `rate-${i}`, hourlyRate: 30000 + i }))],
    ["nine hourly rates and a share", [...Array.from({ length: 9 }, (_, i) => ({ id: `rate-${i}`, hourlyRate: 30000 })), { id: "share", tuitionShareRate: 40 }]]
  ];
  for (const role of ["teacher", "admin"]) {
    for (const [name, rates] of scenarios) {
      await t.test(`salary edit: ${role}, ${name}`, async () => {
        const teacher = fixture(rates);
        const account = await seed(teacher, role);
        allowed(await commit(adminWrites(salaryEdit(teacher), account), editor));
        const saved = await request(`/v1/${root}/teachers/${teacherId}`, null, token(editor), "GET");
        allowed(saved);
        assert.equal(saved.data.fields.defaultEmployeePay.integerValue, "2000000");
        const savedAccount = await request(`/v1/${root}/users/${subject}`, null, token(editor), "GET");
        assert.equal(savedAccount.data.fields.role.stringValue, role);
        assert.equal(savedAccount.data.fields.status.stringValue, "active");
      });
    }
  }

  const invalidChanges = [
    ["negative salary", { defaultEmployeePay: -1 }],
    ["salary over limit", { defaultEmployeePay: 100000001 }],
    ["string salary", { defaultEmployeePay: "2000000" }],
    ["wrong document id", { id: "another-teacher" }],
    ["unknown field", { unexpected: true }],
    ["forbidden identity field", { residentRegistrationNumber: "synthetic" }],
    ["invalid name", { name: "123" }],
    ["invalid phone", { phone: "02" }],
    ["invalid identity", { birthDateCode: "bad", genderCode: "9" }],
    ["invalid insurance", { insuranceSettings: {} }],
    ["negative transport", { transportPolicy: { regionLabel: "Example", unitAmount: -1, treatment: "pending" } }],
    ["invalid transport payday", { transportPolicy: { regionLabel: "Example", unitAmount: 0, treatment: "pending", paymentDay: 32 } }],
    ["negative other payment", { otherPaymentPolicy: { amount: -1, treatment: "pending", insuranceCovered: false } }],
    ["fractional other payment", { otherPaymentPolicy: { amount: 1.5, treatment: "pending", insuranceCovered: false } }],
    ["invalid tax profile", { taxProfile: { dependentCount: 0, children8To20: 0, withholdingRatio: 1 } }],
    ["invalid hourly rate", { incomeComposition: "mixed", businessRates: [{ id: "rate", hourlyRate: -1 }] }],
    ["invalid percentage", { incomeComposition: "mixed", businessRates: [{ id: "rate", tuitionShareRate: 101 }] }],
    ["duplicate percentages", { incomeComposition: "mixed", businessRates: [{ id: "a", tuitionShareRate: 30 }, { id: "b", tuitionShareRate: 40 }] }],
    ["inconsistent composition", { incomeComposition: "business" }]
  ];
  for (const [name, changes] of invalidChanges) {
    await t.test(`rejects ${name}`, async () => {
      const teacher = fixture();
      const account = await seed(teacher);
      const writes = adminWrites(salaryEdit(teacher), account);
      writes[0] = write(`teachers/${teacherId}`, { ...salaryEdit(teacher), ...changes }, true);
      denied(await commit(writes, editor));
      const saved = await request(`/v1/${root}/teachers/${teacherId}`, null, "owner", "GET");
      assert.equal(saved.data.fields.defaultEmployeePay.integerValue, "1999995", "Rejected batches leave salary unchanged");
    });
  }

  for (const [name, changes] of [
    ["identity", { birthDateCode: "910101", genderCode: "2" }],
    ["tax profile", { taxProfile: { dependentCount: 2, children8To20: 1, withholdingRatio: 0.8 } }],
    ["single hourly rate", { incomeComposition: "mixed", businessRates: [{ id: "rate", hourlyRate: 40000 }] }],
    ["single share rate", { incomeComposition: "mixed", businessRates: [{ id: "rate", tuitionShareRate: 37.25 }] }]
  ]) {
    await t.test(`allows valid changed ${name}`, async () => {
      const teacher = fixture();
      const account = await seed(teacher);
      allowed(await commit(adminWrites({ ...teacher, ...changes }, account), editor));
    });
  }

  await t.test("new employee records still receive full validation", async () => {
    await seed();
    const teacher = { ...salaryEdit(fixture()), id: `${teacherId}-new`, authUid: null };
    allowed(await commit([write(`teachers/${teacher.id}`, teacher)], editor));
    for (const [name, change] of invalidChanges) {
      if (name === "wrong document id") continue;
      const invalid = { ...teacher, ...change, id: `${teacherId}-invalid-${randomUUID()}` };
      denied(await commit([write(`teachers/${invalid.id}`, invalid)], editor));
    }
  });

  for (const field of ["insuranceSettings", "businessRates", "transportPolicy", "taxProfile"]) {
    await t.test(`rejects removing required ${field}`, async () => {
      const teacher = fixture();
      await seed(teacher);
      delete teacher[field];
      denied(await commit([write(`teachers/${teacherId}`, teacher)], editor));
    });
  }

  await t.test("inactive administrator cannot edit salaries", async () => {
    const teacher = fixture();
    const account = await seed(teacher, "teacher", "inactive");
    denied(await commit(adminWrites(salaryEdit(teacher), account), editor));
  });
  await t.test("teacher cannot edit own or another salary", async () => {
    await seed();
    denied(await commit([write(`teachers/${teacherId}`, { defaultEmployeePay: 2000000 }, true)], subject));
    denied(await commit([write(`teachers/${teacherId}`, { defaultEmployeePay: 2000000 }, true)], `${prefix}-unknown`));
  });
  await t.test("administrator role and status remain protected", async () => {
    await seed(fixture(), "admin");
    denied(await commit([write(`users/${subject}`, { role: "teacher" }, true)], editor));
    denied(await commit([write(`users/${subject}`, { status: "inactive" }, true)], editor));
  });
});
