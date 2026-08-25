# Firestore 컬렉션

## 접근 권한 요약

| 컬렉션 | 관리자 | 선생님 |
|---|---|---|
| `users` | 전체 관리 | 본인 문서 조회 |
| `accessRequests` | 승인 요청 조회·처리 | 미등록 본인 요청 생성·조회 |
| `teachers` | 관리 | 연결된 본인 조회 |
| `rateRules` | 관리 | 차단 |
| `workEntries` | 관리 | 차단 |
| `taxPolicies` | 조회·새 버전 생성 | 차단 |
| `insurancePolicies` | 조회·새 버전 생성 | 차단 |
| `payrollPolicies` | 이전 버전 호환 | 차단 |
| `payrollOverrides` | 관리 | 차단 |
| `payrollRuns` | 관리 | 차단 |
| `payslips` | 관리 | 본인 확정본만 |
| `payslipVersions` | 불변 버전 조회·생성 | 차단 |
| `payrollCancellations` | 불변 취소 기록 조회·생성 | 차단 |
| `payslipReceipts` | 조회 | 본인 열람 기록 생성/조회 |
| `payslipDeliveries` | 조회·생성 | 접근 불가 |
| `payrollLedgers` | 생성/조회 | 차단 |
| `auditLogs` | 생성/조회 | 차단 |

## 핵심 문서

### `users/{uid}`

```json
{
  "displayName": "표시 이름",
  "email": "로그인 Google 이메일",
  "role": "admin | teacher",
  "teacherId": "teacher 역할일 때 필수",
  "status": "active | inactive"
}
```

### `teachers/{teacherId}`

```json
{
  "authUid": "Firebase Authentication UID",
  "name": "성명",
  "email": "이메일",
  "status": "active",
  "employmentType": "insured | freelancer",
  "baseMonthlyPay": 3000000,
  "subjects": ["고등 수학", "논술"],
  "paymentDay": 10,
  "contractSummary": "화면 표시용 요약",
  "taxProfile": {
    "dependentCount": 4,
    "children8To20": 2,
    "withholdingRatio": 1
  }
}
```

계좌, 주민등록번호, 주소 같은 고위험 정보는 현재 앱에 저장하지 않습니다. 추후 꼭 필요하다면 별도 암호화·마스킹·열람 감사 설계를 먼저 해야 합니다.

`insured`는 4대보험 가입자로 근로소득과 보험 적용, `freelancer`는 사업소득과 보험 미적용으로 계산합니다. `baseMonthlyPay`는 수업 여부와 관계없이 매월 기본으로 불러오는 선생님별 지급액입니다.

### `accessRequests/{uid}`

```json
{
  "uid": "Firebase Authentication UID",
  "email": "Google 로그인 토큰의 이메일",
  "displayName": "Google 표시 이름",
  "status": "pending | approved",
  "requestedAt": "server timestamp",
  "teacherId": "승인 후 연결된 teachers 문서 ID",
  "reviewedAt": "server timestamp",
  "reviewedBy": "관리자 UID"
}
```

미등록 사용자는 본인 UID로 `pending` 요청만 만들 수 있습니다. 이메일은 로그인 토큰과 같아야 하며, 관리자는 같은 이메일의 활성·미연결 선생님과만 연결합니다.

### `rateRules/{ruleId}`

레거시 수업별 계산 기록입니다. 기존 데이터 보존을 위해 유지하지만 새 월 급여 계산에서는 사용하지 않습니다.

```json
{
  "teacherId": "teacherId",
  "subjectId": "subjectId",
  "classId": "선택",
  "subjectName": "고등 수학",
  "hourlyRate": 55000,
  "treatment": "employee | business | other | exempt",
  "insuranceCovered": true,
  "otherIncomeCategory": "temporaryLecture | null",
  "effectiveFrom": "2026-08-01",
  "effectiveTo": null
}
```

### `workEntries/{entryId}`

레거시 수업 내역 기록입니다. 기존 데이터 보존을 위해 유지하지만 새 월 급여 계산에서는 사용하지 않습니다.

```json
{
  "month": "2026-08",
  "workedOn": "2026-08-05",
  "teacherId": "teacherId",
  "subjectId": "subjectId",
  "subjectName": "고등 수학",
  "hours": 2,
  "hourlyRate": 55000,
  "treatment": "employee",
  "insuranceCovered": true,
  "otherIncomeCategory": null,
  "otherPaymentGroup": null,
  "source": "manual | csv"
}
```

### `taxPolicies/{version}`

국세청 원천징수 요율, 시행일, 근로소득 간이세액표, 자녀 공제액, 월 1천만원 초과 산식과 공식 근거 URL을 저장합니다. 기존 문서는 업데이트·삭제할 수 없으며 법정 기준 변경 시 새 버전을 만듭니다.

```json
{
  "version": "NTS-2027-01-01",
  "name": "국세청 원천징수 기준",
  "effectiveFrom": "2027-01-01",
  "effectiveTo": null,
  "verifiedAt": "2027-01-05",
  "status": "published",
  "employment": {
    "tableRevision": "2027-01-01",
    "tableRows": [],
    "taxAtTenMillion": [],
    "childCredits": {},
    "highIncomeBrackets": []
  },
  "business": {},
  "other": {},
  "sources": []
}
```

### `insurancePolicies/{version}`

국민연금·건강보험·장기요양보험·고용보험의 별도 기준을 시행일별로 저장합니다. 국세청 세금 정책과 혼합하지 않습니다.

### `payrollOverrides/{yyyy-mm_teacherId}`

선생님별 이번 달 지급액, 변경 메모, 근로소득 비과세액·학자금 지원액과 관리자가 확인한 수동 공제액을 저장합니다. 수동값이 `null`이면 해당 정책으로 자동 계산합니다.

```json
{
  "month": "2026-08",
  "teacherId": "teacherId",
  "grossPay": 3200000,
  "grossPayNote": "입사월 일할 계산",
  "employeeNonTaxableAmount": 200000,
  "employeeStudentLoanSupportAmount": 0,
  "employeeIncomeTax": null,
  "employeeLocalTax": null,
  "nationalPension": null,
  "healthInsurance": null,
  "longTermCare": null,
  "employmentInsurance": null,
  "custom": 0
}
```

### `payrollRuns/{yyyy-mm}`

```json
{
  "month": "2026-08",
  "status": "draft | ready | published | cancelled",
  "revision": 2,
  "releaseId": "2026-08_v2",
  "publishedAt": "ISO timestamp",
  "updatedBy": "admin uid"
}
```

`published` 상태에서는 취소 전환 외의 수정이 금지됩니다. 취소 후 재발행할 때만 `revision`이 1 증가합니다.

### `payslips/{yyyy-mm}_{teacherId}`

```json
{
  "month": "2026-08",
  "teacherId": "teacherId",
  "teacherUid": "Firebase Authentication UID",
  "teacherName": "발행 시점 이름",
  "status": "published",
  "revision": 2,
  "releaseId": "2026-08_v2",
  "policyVersion": "NTS-2024-02-29 / INSURANCE-2026-01",
  "taxPolicyVersion": "NTS-2024-02-29",
  "insurancePolicyVersion": "INSURANCE-2026-01",
  "calculation": {
    "earningLines": [],
    "grossByTreatment": {},
    "deductions": {},
    "gross": 0,
    "totalDeductions": 0,
    "net": 0
  }
}
```

선생님 조회 쿼리는 `teacherUid == request.auth.uid`와 `status == published` 조건을 모두 포함해야 합니다.

### `payslipVersions/{yyyy-mm_teacherId_vN}`

각 발행 차수의 급여명세서 스냅샷입니다. `payslips`는 선생님에게 보이는 현재본이고 `payslipVersions`는 관리자 감사용 불변 원본입니다. 생성 후 수정·삭제할 수 없습니다.

### `payrollCancellations/{yyyy-mm_vN}`

```json
{
  "month": "2026-08",
  "revision": 1,
  "releaseId": "2026-08_v1",
  "reason": "수업 시간 누락으로 계산 수정 필요",
  "payslipIds": ["2026-08_teacherId"],
  "actorUid": "관리자 UID",
  "createdAt": "server timestamp"
}
```

취소 기록은 수정·삭제하지 않습니다. 사유에는 주민등록번호, 급여 세부 내용 등 개인정보를 적지 않습니다.

### `payslipReceipts/{payslipId}_{teacherUid}`

```json
{
  "payslipId": "2026-08_teacherId",
  "teacherId": "teacherId",
  "teacherUid": "Firebase Authentication UID",
  "month": "2026-08",
  "revision": 2,
  "viewedAt": "server timestamp"
}
```

선생님이 발행된 본인 명세서를 처음 열 때만 생성됩니다. 급여 확정본의 불변성을 지키기 위해 `payslips` 문서에 열람 시간을 쓰지 않으며, 열람 기록도 업데이트·삭제하지 않습니다.

### `payslipDeliveries/{deliveryId}`

```json
{
  "payslipId": "2026-08_teacherId",
  "teacherId": "teacherId",
  "month": "2026-08",
  "revision": 2,
  "recipientEmail": "등록된 선생님 이메일",
  "channel": "gmail_attachment",
  "gmailMessageId": "Gmail API 메시지 ID",
  "sentBy": "관리자 UID",
  "sentAt": "server timestamp"
}
```

관리자만 생성·조회할 수 있으며 수정과 삭제는 허용하지 않습니다. 급여명세서 본문, PDF, Gmail OAuth 토큰은 저장하지 않습니다. 규칙은 연결된 `payslips` 문서가 `published` 상태이고 선생님과 급여월이 일치하는지 다시 확인합니다.
