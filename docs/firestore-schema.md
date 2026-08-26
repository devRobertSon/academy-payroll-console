# Firestore 컬렉션

## 접근 권한 요약

| 컬렉션 | 관리자 | 선생님 |
|---|---|---|
| `users` | 전체 관리 | 본인 문서 조회 |
| `accessRequests` | 승인 요청 조회·처리 | 미등록 본인 요청 생성·조회 |
| `teachers` | 관리 | 연결된 본인 조회, 허용된 기본 정보 수정 |
| `teacherMonthlyInputs` | 전체 조회·수정 | 본인의 미확정 월 수업시간 조회·수정 |
| `adminNotifications` | 전체 조회, 읽음 처리 | 본인 수업시간 제출 알림 생성·갱신 |
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
  "phone": "연락처",
  "birthDateCode": "주민등록번호 앞 생년월일 6자리, 최초 등록 때 생략 가능",
  "genderCode": "주민등록번호 뒷자리 첫 숫자 1자리, 최초 등록 때 생략 가능",
  "status": "active",
  "incomeComposition": "employee | business | mixed",
  "insuranceEnrolled": true,
  "insuranceSettings": {
    "nationalPension": { "enrolled": true, "defaultBaseAmount": 3000000, "effectiveFrom": "2026-01-01", "effectiveTo": null },
    "healthInsurance": { "enrolled": true, "defaultBaseAmount": 3200000, "effectiveFrom": "2026-01-01", "effectiveTo": null },
    "employmentInsurance": { "enrolled": true, "defaultBaseAmount": 3100000, "effectiveFrom": "2026-01-01", "effectiveTo": null }
  },
  "defaultEmployeePay": 3000000,
  "businessRates": [
    { "id": "essay", "subjectName": "논술 특강", "hourlyRate": 70000 }
  ],
  "transportPolicy": {
    "regionLabel": "서울 시내",
    "unitAmount": 1500,
    "treatment": "pending | business | employee | exempt | other"
  },
  "subjects": ["고등 수학", "논술"],
  "paymentDay": 10,
  "contractSummary": "근로소득 | 사업소득 | 근로소득 + 사업소득",
  "taxProfile": {
    "dependentCount": 4,
    "children8To20": 2,
    "withholdingRatio": 1
  }
}
```

계좌, 전체 주민등록번호, 주소는 현재 앱에 저장하지 않습니다. 회계 확인에는 `birthDateCode` 6자리와 `genderCode` 1자리만 사용합니다. 이 두 필드도 개인정보이므로 관리자와 본인 외에는 읽을 수 없도록 Firestore 규칙을 유지하고, CSV는 안전한 채널로 전달합니다. Firestore 규칙은 신규 선생님 문서에서 두 필드의 형식을 검사하며 `residentRegistrationNumber`, `residentNumber`, `rrn`, `socialSecurityNumber` 같은 전체 번호 필드의 저장을 거부합니다.

`incomeComposition`은 계약 요약에서 고른 소득 구성을 저장합니다. `employee`는 근로소득 설정만, `business`는 사업소득 설정만, `mixed`는 두 설정을 모두 급여 계산에 사용합니다. `contractSummary`는 기존 화면과 데이터 호환을 위한 표준 한글 표시값이며 자유 입력으로 받지 않습니다. `insuranceSettings`는 국민연금·건강보험(장기요양 포함)·고용보험을 각각 가입 여부, 기본 신고 기준액과 적용 기간으로 관리합니다. `insuranceEnrolled`는 과거 데이터 호환용 요약값입니다. `defaultEmployeePay`는 근로소득 기본 월급이고 `businessRates`는 과목별 사업소득 시급입니다. 기존 `incomeComposition`이 없는 문서는 월급·보험·사업소득 시급 유무로 근로소득·사업소득·혼합형을 자동 판별하며, 기존 `employmentType`, `baseMonthlyPay`, 단일 `insuranceEnrolled` 문서도 새 필드가 저장되기 전까지 자동 호환해 읽습니다.

선생님 본인은 `name`, `phone`, `birthDateCode`, `genderCode`, `subjects`만 수정할 수 있습니다. `email`, `authUid`, `status`, 보험 가입·신고 기준액, 월급, 시급, 교통비 기준, 계약·지급일과 원천징수 정보는 관리자만 수정할 수 있습니다.

### `teacherMonthlyInputs/{yyyy-mm_teacherId}`

```json
{
  "month": "2026-08",
  "teacherId": "teacherId",
  "teacherUid": "Firebase Authentication UID",
  "employeeWorkHours": 40,
  "businessHours": {
    "essay": 10,
    "english": 24
  },
  "submittedAt": "server timestamp",
  "updatedAt": "server timestamp",
  "updatedBy": "teacher or admin UID"
}
```

이 문서에는 급여액, 시급, 소득 구분이나 보험 정보가 없습니다. `businessHours`의 키는 관리자가 `teachers.businessRates`에 등록한 시급 항목 ID이고 값만 선생님이 입력합니다. 계산 시 등록된 ID의 시수만 사용하며 알 수 없는 키는 무시합니다. 선생님은 본인 UID·teacherId의 문서만 읽고 쓸 수 있고, `payrollRuns/{month}`가 `published`이면 쓰기가 거부됩니다.

### `adminNotifications/{work-hours_yyyy-mm_teacherId}`

```json
{
  "type": "teacher_monthly_input_submitted",
  "teacherId": "teacherId",
  "teacherUid": "Firebase Authentication UID",
  "month": "2026-08",
  "status": "unread | read",
  "submittedAt": "server timestamp",
  "readAt": null,
  "readBy": null
}
```

선생님이 수업시간을 저장하면 같은 batch에서 관리자 알림을 생성합니다. 같은 선생님·같은 월은 문서 하나를 다시 `unread`로 갱신하므로 중복 알림이 쌓이지 않습니다. 선생님은 본인 제출 알림만 만들 수 있고 알림을 읽을 수는 없습니다. 관리자는 전체 알림을 읽고 `status`, `readAt`, `readBy`만 변경할 수 있습니다. 급여액, 시급, 연락처는 알림에 저장하지 않습니다.

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

선생님별 이번 달 근로소득 월급, 사업소득 과목·시급 스냅샷, 변경 메모, 근로소득 비과세액·학자금 지원액과 관리자가 확인한 수동 공제액을 저장합니다. 새 입력 흐름의 수업 시수는 `teacherMonthlyInputs`에서 가져오며 기존 문서의 수업 시수는 호환용으로 계속 읽습니다. 수동값이 `null`이면 해당 정책으로 자동 계산합니다.

```json
{
  "month": "2026-08",
  "teacherId": "teacherId",
  "employeeGrossPay": 3000000,
  "employeeWorkHours": 40,
  "businessWorkLines": [
    {
      "id": "essay-august",
      "rateId": "essay",
      "subjectName": "논술 특강",
      "hourlyRate": 70000,
      "hours": 10
    }
  ],
  "transportTrips": 20,
  "transportUnitAmount": 1500,
  "transportTreatment": "business",
  "transportInsuranceCovered": false,
  "parkingAmount": 10000,
  "parkingTreatment": "exempt",
  "parkingInsuranceCovered": false,
  "additionalEarnings": [
    { "id": "materials", "label": "교재 준비비", "amount": 20000, "treatment": "business", "insuranceCovered": false }
  ],
  "nationalPensionBase": 3000000,
  "healthInsuranceBase": 3200000,
  "employmentInsuranceBase": 3100000,
  "grossPayNote": "입사월 일할 계산",
  "employeeNonTaxableAmount": 200000,
  "employeeStudentLoanSupportAmount": 0,
  "employeeIncomeTax": null,
  "employeeLocalTax": null,
  "nationalPension": null,
  "healthAndLongTermCare": null,
  "employmentInsurance": null,
  "custom": 0
}
```

`businessWorkLines`의 각 금액은 `hourlyRate × hours`로 계산하며 확정 명세서에는 당시 과목·시급·시수가 함께 보존됩니다. 교통비·주차료·기타 지급의 `treatment`가 `pending`이면 미리보기에는 포함되지만 급여 확정은 차단됩니다. 세무사 확인 후 `business`, `employee`, `exempt`, `other` 중 하나를 선택합니다. 보험별 기준액은 서로 다르게 입력할 수 있습니다. 기존 문서의 `grossPay`, `businessGrossPay`, 건강보험·장기요양 개별 수동값은 계속 호환해 읽습니다.

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
