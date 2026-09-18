import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { runInNewContext } from "node:vm";
import { teacherAccountUpdate } from "../src/lib/teacher-account.js";

const host = process.env.FIRESTORE_EMULATOR_HOST;

test("teacher form keeps rate IDs and writes the optional share last", async () => {
  const app = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
  const start = app.indexOf("function readBusinessPaySettings(");
  const end = app.indexOf("\nfunction ", start + 1);
  assert.ok(start > 0 && end > start);
  const hourly = Array.from({ length: 9 }, (_, i) => ({ id: `hourly-${i}`, hourlyRate: 30000 + i }));
  const read = runInNewContext(`${app.slice(start, end)}\nreadBusinessPaySettings`, {
    calculateTuitionShare: () => 0, readBusinessRates: () => hourly
  });
  const form = {
    elements: { "edit-business-rate-mode": { value: "combined" }, "edit-tuition-share-rate": { value: "37.25" } },
    querySelector: () => ({ dataset: { shareRateId: "existing-share" }, querySelector: () => ({ checked: true }) })
  };
  const result = JSON.parse(JSON.stringify(read(form, "edit", "#rates")));
  assert.deepEqual(result.businessRates, [...hourly, { id: "existing-share", tuitionShareRate: 37.25 }]);
});

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
    if (input instanceof Date) return { timestampValue: input.toISOString() };
    if (typeof input === "string") return { stringValue: input };
    if (typeof input === "boolean") return { booleanValue: input };
    if (typeof input === "number") return Number.isInteger(input)
      ? { integerValue: String(input) } : { doubleValue: Number.isFinite(input) ? input : String(input) };
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

  function adminWrites(teacher, account, actor = editor) {
    return [
      write(`teachers/${teacherId}`, { ...teacher, updatedBy: actor }, true),
      write(`users/${subject}`, teacherAccountUpdate(account, teacher, subject), true),
      write(`auditLogs/${randomUUID()}`, { action: "TEACHER_UPDATED", teacherId, status: teacher.status, actorUid: actor })
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

  for (const actor of [editor, subject]) {
    for (const count of [1, 2, 3, 5, 10]) {
      await t.test(`hourly edit: ${actor === subject ? "own" : "another"} administrator, ${count} rates`, async () => {
        const teacher = fixture(Array.from({ length: count }, (_, i) => ({ id: `rate-${i}`, hourlyRate: 30000 })));
        const account = await seed(teacher, "admin");
        const updated = { ...salaryEdit(teacher), businessRates: teacher.businessRates.map((rate) => ({ ...rate, hourlyRate: 40000 })) };
        allowed(await commit(adminWrites(updated, account, actor), actor));
        const savedAccount = await request(`/v1/${root}/users/${subject}`, null, token(actor), "GET");
        assert.equal(savedAccount.data.fields.role.stringValue, "admin");
        assert.equal(savedAccount.data.fields.status.stringValue, "active");
      });
    }
  }

  function completeEdit(teacher, rates) {
    return {
      ...salaryEdit(teacher), name: "Updated Teacher", email: "updated@example.invalid", phone: "01000000001",
      birthDateCode: "910102", genderCode: "2", status: "inactive", profileCompleted: true,
      incomeComposition: rates.length ? "mixed" : "employee", businessRates: rates,
      insuranceSettings: {
        nationalPension: { enrolled: true, defaultBaseAmount: 2300000, effectiveFrom: "2026-10-01", effectiveTo: "2027-02-28" },
        healthInsurance: { enrolled: true, defaultBaseAmount: 2400000, effectiveFrom: "2026-11-01", effectiveTo: "2027-03-31" },
        employmentInsurance: { enrolled: false, defaultBaseAmount: 2500000, effectiveFrom: "2026-12-01", effectiveTo: "2027-04-30" }
      },
      transportPolicy: { regionLabel: "Updated region", unitAmount: 30000, treatment: "exempt", paymentDay: 31 },
      otherPaymentPolicy: { amount: 50000, treatment: "business", insuranceCovered: true },
      paymentDay: 31, taxProfile: { dependentCount: 3, children8To20: 1, withholdingRatio: 0.8 }
    };
  }

  for (const [label, rates] of scenarios) {
    for (const actor of [editor, subject]) {
      await t.test(`all fields at once: ${actor === subject ? "own" : "another"} administrator, ${label}`, async () => {
        const teacher = fixture();
        const account = await seed(teacher, "admin");
        allowed(await commit(adminWrites(completeEdit(teacher, rates), account, actor), actor));
        const savedAccount = await request(`/v1/${root}/users/${subject}`, null, token(actor), "GET");
        assert.equal(savedAccount.data.fields.role.stringValue, "admin");
        assert.equal(savedAccount.data.fields.status.stringValue, "active");
      });
    }
    await t.test(`new record with all fields: ${label}`, async () => {
      await seed();
      const teacher = { ...completeEdit(fixture(), rates), id: `${teacherId}-new-${randomUUID()}`, authUid: null };
      allowed(await commit([write(`teachers/${teacher.id}`, teacher)], editor));
    });
  }

  for (const [field, value] of Object.entries(completeEdit(fixture(), [{ id: "new-hourly", hourlyRate: 45000 }]))) {
    if (["id", "authUid", "updatedBy", "businessRates", "incomeComposition"].includes(field)) continue;
    await t.test(`individual field: ${field}`, async () => {
      const teacher = fixture();
      const account = await seed(teacher, "admin");
      allowed(await commit(adminWrites({ ...teacher, [field]: value }, account, subject), subject));
    });
  }

  const malformedRates = [
    null, "30000", {}, [null], [30000], [{}],
    [{ id: "a", hourlyRate: 0 }], [{ id: "a", hourlyRate: "30000" }],
    [{ id: "a", hourlyRate: true }], [{ id: "a", hourlyRate: null }],
    [{ id: "a", hourlyRate: 10000001 }], [{ id: "", hourlyRate: 30000 }],
    [{ id: "a".repeat(101), hourlyRate: 30000 }], [{ id: 1, hourlyRate: 30000 }],
    [{ id: "a", hourlyRate: 30000, extra: true }],
    [{ id: "a", hourlyRate: 30000, tuitionShareRate: 40 }],
    [{ id: "a", tuitionShareRate: 0 }], [{ id: "a", tuitionShareRate: "40" }],
    [{ id: "a", tuitionShareRate: 40.001 }], [{ id: "a", unknown: 30000 }],
    Array.from({ length: 11 }, (_, i) => ({ id: `hourly-${i}`, hourlyRate: 30000 }))
  ];
  for (const [index, businessRates] of malformedRates.entries()) {
    await t.test(`rejects malformed rates ${index}`, async () => {
      const teacher = fixture();
      const account = await seed(teacher, "admin");
      denied(await commit(adminWrites({ ...teacher, incomeComposition: "mixed", businessRates }, account, subject), subject));
    });
  }

  for (const invalid of [null, true, "2000000", [], {}, new Date("2026-09-01"), NaN, Infinity, -Infinity]) {
    await t.test(`rejects nonnumeric amounts ${JSON.stringify(invalid)}`, async () => {
      const teacher = fixture();
      const account = await seed(teacher, "admin");
      for (const changes of [
        { defaultEmployeePay: invalid },
        { transportPolicy: { ...teacher.transportPolicy, unitAmount: invalid } },
        ...(invalid === null ? [] : [{ insuranceSettings: { ...teacher.insuranceSettings,
          healthInsurance: { ...teacher.insuranceSettings.healthInsurance, defaultBaseAmount: invalid } } }])
      ]) denied(await commit(adminWrites({ ...teacher, ...changes }, account, subject), subject));
    });
  }

  for (const [label, rates] of scenarios) {
    await t.test(`business-only new record without identity: ${label}`, async () => {
      await seed();
      const teacher = { ...completeEdit(fixture(), rates), id: `${teacherId}-business-${randomUUID()}`, authUid: null,
        incomeComposition: "business", defaultEmployeePay: 0, profileCompleted: rates.length > 0,
        insuranceSettings: Object.fromEntries(["nationalPension", "healthInsurance", "employmentInsurance"]
          .map(key => [key, { enrolled: false, defaultBaseAmount: null, effectiveFrom: null, effectiveTo: null }])) };
      delete teacher.birthDateCode;
      delete teacher.genderCode;
      allowed(await commit([write(`teachers/${teacher.id}`, teacher)], editor));
    });
  }

  for (const insurance of ["nationalPension", "healthInsurance", "employmentInsurance"]) {
    for (const key of ["enrolled", "defaultBaseAmount", "effectiveFrom", "effectiveTo"]) {
      await t.test(`rejects missing insurance member ${insurance}.${key}`, async () => {
        const teacher = fixture();
        await seed(teacher, "admin");
        delete teacher.insuranceSettings[insurance][key];
        denied(await commit([write(`teachers/${teacherId}`, teacher)], subject));
      });
    }
    for (const changes of [{ extra: true }, { enrolled: "true" }, { defaultBaseAmount: -1 },
      { defaultBaseAmount: 100000001 }, { effectiveFrom: 1 }, { effectiveTo: false }]) {
      await t.test(`rejects invalid insurance member ${insurance} ${JSON.stringify(changes)}`, async () => {
        const teacher = fixture();
        await seed(teacher, "admin");
        Object.assign(teacher.insuranceSettings[insurance], changes);
        denied(await commit([write(`teachers/${teacherId}`, teacher)], subject));
      });
    }
  }

  for (const field of ["insuranceSettings", "transportPolicy", "otherPaymentPolicy", "taxProfile"]) {
    const full = completeEdit(fixture(), []);
    for (const nestedKey of Object.keys(full[field])) {
      if (field === "transportPolicy" && nestedKey === "paymentDay") continue;
      await t.test(`rejects missing ${field}.${nestedKey}`, async () => {
        const account = await seed(full, "admin");
        const changed = { ...full[field] };
        delete changed[nestedKey];
        const update = write(`teachers/${teacherId}`, { ...full, [field]: changed });
        denied(await commit([update], subject));
      });
    }
  }

  for (const [label, rates] of scenarios) {
    await t.test(`teacher self-service: ${label}`, async () => {
      const teacher = fixture(rates);
      await seed(teacher);
      const updated = { ...teacher, name: "Self Updated", phone: "01000000002", birthDateCode: "920101", genderCode: "1",
        businessRates: rates.map(rate => "hourlyRate" in rate ? { ...rate, hourlyRate: 45000 } : { ...rate, tuitionShareRate: 38.25 }),
        updatedBy: subject };
      const profileWrite = write(`teachers/${teacherId}`, updated);
      profileWrite.updateTransforms = [{ fieldPath: "updatedAt", setToServerValue: "REQUEST_TIME" }];
      const accountWrite = write(`users/${subject}`, { displayName: updated.name, updatedBy: subject }, true);
      accountWrite.updateTransforms = [{ fieldPath: "updatedAt", setToServerValue: "REQUEST_TIME" }];
      allowed(await commit([profileWrite, accountWrite], subject));
    });
  }

  await t.test("legacy share order remains editable without rewriting existing rates", async () => {
    const teacher = fixture([{ id: "share", tuitionShareRate: 40 }, { id: "hourly", hourlyRate: 30000 }]);
    const account = await seed(teacher, "admin");
    allowed(await commit(adminWrites(salaryEdit(teacher), account, subject), subject));
  });

  await t.test("new share entries cannot precede hourly entries or occur twice", async () => {
    const teacher = fixture();
    const account = await seed(teacher, "admin");
    for (const businessRates of [
      [{ id: "share", tuitionShareRate: 40 }, { id: "hourly", hourlyRate: 30000 }],
      [{ id: "one", tuitionShareRate: 30 }, { id: "two", tuitionShareRate: 40 }]
    ]) denied(await commit(adminWrites({ ...teacher, incomeComposition: "mixed", businessRates }, account, subject), subject));
  });

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
  await t.test("teacher cannot change administrator-only fields or promote the account", async () => {
    const teacher = fixture();
    await seed(teacher);
    const changed = completeEdit(teacher, []);
    for (const key of ["email", "defaultEmployeePay", "status", "transportPolicy", "otherPaymentPolicy", "paymentDay", "taxProfile"]) {
      const entry = write(`teachers/${teacherId}`, { [key]: changed[key], updatedBy: subject }, true);
      entry.updateTransforms = [{ fieldPath: "updatedAt", setToServerValue: "REQUEST_TIME" }];
      denied(await commit([entry], subject));
    }
    denied(await commit([write(`teachers/${teacherId}`, { authUid: editor }, true)], subject));
    denied(await commit([write(`users/${subject}`, { role: "admin" }, true)], subject));
    for (const key of ["defaultBaseAmount", "effectiveFrom", "effectiveTo"]) {
      const insuranceSettings = structuredClone(teacher.insuranceSettings);
      insuranceSettings.healthInsurance[key] = changed.insuranceSettings.healthInsurance[key];
      const entry = write(`teachers/${teacherId}`, { insuranceSettings, updatedBy: subject }, true);
      entry.updateTransforms = [{ fieldPath: "updatedAt", setToServerValue: "REQUEST_TIME" }];
      denied(await commit([entry], subject));
    }
  });
  await t.test("administrator role and status remain protected", async () => {
    await seed(fixture(), "admin");
    denied(await commit([write(`users/${subject}`, { role: "teacher" }, true)], editor));
    denied(await commit([write(`users/${subject}`, { status: "inactive" }, true)], editor));
  });

  await t.test("individual validators reject wrong types without exhausting the rule budget", async () => {
    // Only the loopback emulator receives these probe matches; production rules are unchanged.
    const prefix = rules.slice(0, rules.indexOf("    function monthIsEditable("));
    const probeRules = `${prefix}
      match /probeHourly/{id} { allow write: if validHourlyRate(request.resource.data); }
      match /probeShare/{id} { allow write: if validLastBusinessRate(request.resource.data); }
      match /probeInsurance/{id} { allow write: if hasValidInsuranceSettings(request.resource.data); }
      match /probeTransport/{id} { allow write: if hasValidTransportPolicy(request.resource.data); }
      match /probeSalary/{id} { allow write: if request.resource.data.defaultEmployeePay >= 0 && request.resource.data.defaultEmployeePay <= 100000000; }
    } }`;
    allowed(await request(`/emulator/v1/projects/${project}:securityRules`, { rules: { files: [{ content: probeRules }] } }, "owner", "PUT"));
    try {
      const insurance = fixture().insuranceSettings;
      for (const invalid of [null, true, "2000000", [], {}, new Date("2026-09-01"), NaN, Infinity, -Infinity]) {
        const probes = [
          ["probeHourly", { id: "hourly", hourlyRate: invalid }],
          ["probeShare", { id: "share", tuitionShareRate: invalid }],
          ["probeSalary", { defaultEmployeePay: invalid }],
          ["probeTransport", { transportPolicy: { ...fixture().transportPolicy, unitAmount: invalid } }],
          ...(invalid === null ? [] : [["probeInsurance", { insuranceSettings: { ...insurance,
            healthInsurance: { ...insurance.healthInsurance, defaultBaseAmount: invalid } } }]])
        ];
        for (const [collection, data] of probes) {
          const result = await commit([write(`${collection}/${randomUUID()}`, data)], editor);
          denied(result);
          assert.doesNotMatch(result.data.error.message, /maximum of 1000 expressions/);
        }
      }
      for (const [collection, data] of [
        ["probeHourly", { id: "hourly", hourlyRate: 10000000 }],
        ["probeShare", { id: "share", tuitionShareRate: 37.25 }],
        ["probeSalary", { defaultEmployeePay: 0 }],
        ["probeInsurance", { insuranceSettings: insurance }],
        ["probeTransport", { transportPolicy: fixture().transportPolicy }]
      ]) allowed(await commit([write(`${collection}/${randomUUID()}`, data)], editor));
    } finally {
      allowed(await request(`/emulator/v1/projects/${project}:securityRules`, { rules: { files: [{ content: rules }] } }, "owner", "PUT"));
    }
  });
});
