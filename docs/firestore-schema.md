# Firestore 컬렉션

## 접근 권한 요약

| 컬렉션 | 관리자 | 선생님 |
|---|---|---|
| `users` | 전체 관리 | 본인 문서 조회 |
| `teachers` | 관리 | 연결된 본인 조회 |
| `rateRules` | 관리 | 차단 |
| `workEntries` | 관리 | 차단 |
| `payrollPolicies` | 관리 | 차단 |
| `payrollOverrides` | 관리 | 차단 |
| `payrollRuns` | 관리 | 차단 |
| `payslips` | 관리 | 본인 확정본만 |
| `payslipReceipts` | 조회 | 본인 열람 기록 생성/조회 |
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
  "subjects": ["고등 수학", "논술"],
  "paymentDay": 10,
  "contractSummary": "화면 표시용 요약"
}
```

계좌, 주민등록번호, 주소 같은 고위험 정보는 현재 앱에 저장하지 않습니다. 추후 꼭 필요하다면 별도 암호화·마스킹·열람 감사 설계를 먼저 해야 합니다.

### `rateRules/{ruleId}`

```json
{
  "teacherId": "teacherId",
  "subjectId": "subjectId",
  "classId": "선택",
  "subjectName": "고등 수학",
  "hourlyRate": 55000,
  "treatment": "employee | business | other | exempt",
  "insuranceCovered": true,
  "effectiveFrom": "2026-08-01",
  "effectiveTo": null
}
```

### `workEntries/{entryId}`

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
  "source": "manual | csv"
}
```

### `payrollPolicies/{version}`

월별 계산 요율, 기준액 상·하한, 반올림 규칙과 버전을 저장합니다. 법정 값의 변경 이력을 유지하기 위해 기존 문서를 덮어쓰지 않고 새 버전을 만듭니다.

### `payrollRuns/{yyyy-mm}`

```json
{
  "month": "2026-08",
  "status": "draft | ready | published",
  "publishedAt": "ISO timestamp",
  "updatedBy": "admin uid"
}
```

`published`가 되면 Security Rules가 업데이트와 삭제를 거부합니다.

### `payslips/{yyyy-mm}_{teacherId}`

```json
{
  "month": "2026-08",
  "teacherId": "teacherId",
  "teacherUid": "Firebase Authentication UID",
  "teacherName": "발행 시점 이름",
  "status": "published",
  "policyVersion": "2026-08-v1",
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

### `payslipReceipts/{payslipId}_{teacherUid}`

```json
{
  "payslipId": "2026-08_teacherId",
  "teacherId": "teacherId",
  "teacherUid": "Firebase Authentication UID",
  "month": "2026-08",
  "viewedAt": "server timestamp"
}
```

선생님이 발행된 본인 명세서를 처음 열 때만 생성됩니다. 급여 확정본의 불변성을 지키기 위해 `payslips` 문서에 열람 시간을 쓰지 않으며, 열람 기록도 업데이트·삭제하지 않습니다.
