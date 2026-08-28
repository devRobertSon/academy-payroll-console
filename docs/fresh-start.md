# 테스트 데이터 완전 초기화

이 앱은 이전 Firestore 형식을 변환하지 않습니다. 아직 실제 선생님과 급여 자료가 없을 때 아래 순서로 테스트 데이터를 모두 지우고 현재 구조로 시작합니다.

## 1. 관리자 UID 확인

Firebase Console의 `Authentication > 사용자`에서 계속 사용할 관리자 Google 계정의 UID와 이메일을 별도로 적어 둡니다. Authentication 사용자는 삭제하지 않아도 됩니다.

## 2. Firestore 문서 전체 삭제

`Firestore Database > 데이터`에서 아래 컬렉션의 문서를 모두 삭제합니다. 문서가 하나도 남지 않으면 컬렉션도 화면에서 사라집니다.

```text
users
accessRequests
teachers
teacherMonthlyInputs
expenseReceipts
adminNotifications
taxPolicies
insurancePolicies
payrollOverrides
payrollRuns
payslips
payslipVersions
payrollCancellations
payslipReceipts
payslipDeliveries
payrollLedgers
auditLogs
```

예전 테스트에서 아래 컬렉션을 만든 적이 있다면 함께 전부 삭제합니다. 현재 코드와 규칙에는 이 이름이 존재하지 않습니다.

```text
payrollPolicies
rateRules
workEntries
```

## 3. 관리자 문서 하나만 새로 생성

`users` 컬렉션에 1단계에서 확인한 UID를 문서 ID로 사용해 아래 필드만 만듭니다.

```json
{
  "displayName": "관리자 이름",
  "email": "관리자 Google 이메일",
  "role": "admin",
  "status": "active"
}
```

## 4. 현재 규칙 게시

저장소 루트의 `firestore.rules` 전체를 Firebase Console의 `Firestore Database > 규칙`에 붙여 넣고 게시합니다. 이 규칙은 현재 선생님 필드만 허용하며 삭제된 이전 필드가 포함된 문서를 거부합니다.

`storage.rules`도 현재 파일로 게시합니다. 영수증 원본은 Firebase Storage가 아니라 비공개 Google Drive에 저장하므로 Storage는 기본 거부 상태를 유지합니다.

## 5. Cloudflare 테스트 상태 정리

Workers KV의 `academy-payroll-receipts-kv`에서 테스트 발송·업로드 기록만 삭제합니다.

```text
mail_delivery: 로 시작하는 키
upload_quota: 로 시작하는 키
oauth_state: 로 시작하는 키
gmail_connection: 로 시작하는 키
```

현재 공용 Drive 연결을 유지하려면 `drive_connection`은 삭제하지 않습니다. 이전 공용 Gmail 키 `gmail_connection`은 최신 Worker에서 사용하지 않으므로 삭제하고, 각 관리자로 로그인해 본인의 Gmail 발송 계정을 다시 연결합니다. 최신 연결은 `gmail_connection:{관리자 UID}` 형식으로 관리자마다 따로 저장됩니다. Worker 변수와 비밀값은 그대로 유지합니다.

## 6. 새 구조 확인

1. 관리자 Google 계정으로 로그인합니다.
2. 선생님 수가 0명이고 급여·알림·영수증 내역이 모두 비어 있는지 확인합니다.
3. 가상 선생님 한 명을 등록해 한 개 시급과 여러 시급 저장을 각각 확인합니다.
4. 테스트를 마치면 가상 선생님도 삭제하고 실제 운영 등록을 시작합니다.

초기화 뒤에는 데이터 마이그레이션 작업이 없습니다. 문제가 생기면 이전 필드를 추가해 우회하지 말고 현재 화면과 `firestore.rules`의 필드 구성을 함께 수정합니다.
