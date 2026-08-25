# academy-payroll-console

학원 선생님별 근로소득 월급, 과목별 사업소득 시급·수업 시수, 보험별 신고 기준액과 추가 지급 항목을 기준으로 급여명세서와 기장용 급여내역서를 만드는 GitHub Pages + Firebase 웹 앱입니다.

이 저장소는 공개 저장소를 전제로 설계했습니다. 실제 이름, 이메일, 계좌, 급여, 계약 정보는 저장소에 넣지 않고 Firebase Authentication과 Cloud Firestore에만 보관합니다. 현재 포함된 이름과 이메일은 `.invalid` 도메인을 사용한 가상 데이터입니다.

## 구현된 기능

- 관리자/선생님 역할별 화면
- Google 로그인 및 Firestore 사용자 권한 확인
- 미등록 Google 계정의 승인 요청과 관리자 UID 연결
- 선생님별 연락처와 생년월일 6자리·성별번호 1자리 관리(전체 주민등록번호 미수집)
- 국민연금·건강보험·고용보험별 가입 여부, 신고 기준액과 적용 기간 관리
- 기본 근로소득 월급과 과목별 사업소득 시급 관리
- 선생님 정보 수정·비활성화와 계정 접근 동시 제어
- 월별 근로소득 월급과 과목별 사업소득 수업 시수 입력
- 수업이 없는 보험 가입자의 월급 계산
- 사업소득의 과목별 시급 × 수업 시수 및 3.3% 원천징수 자동 계산
- 교통 횟수·교통비·주차료·기타 지급 입력과 지급 항목별 과세 처리
- 과세 처리 미확인 지급 항목의 급여 확정 차단
- 한 선생님의 근로소득과 사업소득 동시 계산 및 근로소득 부분에만 보험 적용
- 국세청 근로소득 간이세액표 전체 구간과 1천만원 초과 산식
- 공제대상가족·8~20세 자녀 공제·80/100/120% 원천징수 선택
- 사업소득 3%와 지방소득세, 일시적 강의 기타소득 필요경비·과세최저한
- 시행일별 세금 기준 버전 추가와 간이세액표 CSV 교체
- 2026년 공식 사회보험 근로자 부담률·상하한과 시행일별 새 버전 등록
- 공제액 자동 계산과 관리자 수동 보정
- 월별 급여 확정, 명세서 공개, 확정본 잠금
- 확정 취소 사유와 불변 버전을 보존하는 차수별 재발행
- 급여 확정 후 포털 로그인 안내문·링크 복사
- 선생님 본인의 발행된 과거 급여명세서 열람
- 선생님의 명세서 최초 열람 기록
- 교사·관리자 급여명세서 PDF 다운로드 및 신고액·강사료 세액공제·보험별 기준액을 포함한 기장용 CSV 출력
- 관리자의 수신자 확인 후 Gmail PDF 첨부 발송과 불변 발송 이력
- 기본 거부 방식 Firestore/Storage 보안 규칙
- 급여 확정 시 명세서·월 마감·감사 로그 원자적 저장
- 검색 가능한 관리자 사용 설명서와 개인정보 차단형 AI 도움말
- GitHub Pages `main / (root)` 정적 배포

## 무료 요금제 범위

선생님 약 20명 규모에서 Google 로그인, Firestore 저장, 본인 명세서 조회, 열람 기록, 관리자 급여 계산은 Firebase Spark 요금제로 시작할 수 있습니다. Firestore의 현재 무료 제공량은 저장 1 GiB, 일 50,000회 읽기, 일 20,000회 쓰기, 월 10 GiB 외부 전송입니다. 이 앱의 정상적인 월 1회 급여 작업은 그보다 훨씬 작습니다. 자세한 수치는 [Cloud Firestore 요금 안내](https://firebase.google.com/docs/firestore/pricing)에서 확인하세요.

Spark 버전에서도 관리자가 화면에서 직접 실행하는 Gmail 첨부 발송은 사용할 수 있습니다. PDF는 관리자 브라우저에서 만들고, Firebase Google 로그인에 `gmail.send` 권한을 추가 승인받아 관리자 Gmail 계정으로 보냅니다. OAuth 토큰과 PDF는 Firestore에 저장하지 않고 발송 성공 메타데이터만 기록합니다. 예약·일괄 자동 발송, 서버 PDF, 실패 재시도 큐가 필요해지면 Blaze 요금제와 Cloud Functions를 추가하는 방식이 적합합니다.

## Gmail 첨부 발송 설정

1. Firebase 프로젝트와 연결된 Google Cloud 프로젝트에서 Gmail API를 활성화합니다.
2. Google Auth Platform의 OAuth 동의 화면에 `https://www.googleapis.com/auth/gmail.send` 범위를 추가합니다.
3. 앱이 테스트 상태라면 실제 발송에 사용할 관리자 Google 계정을 테스트 사용자로 등록합니다.
4. Firebase Authentication의 승인된 도메인에 GitHub Pages 도메인을 등록합니다.
5. 관리자가 확정 명세서의 `이메일 발송`을 처음 누르면 Gmail 전송 권한을 승인합니다.

`gmail.send`는 메일 전송만 허용하며 받은편지함 읽기 권한은 요청하지 않습니다. 이 범위는 Google의 민감한 OAuth 범위이므로 외부 사용자를 대상으로 앱을 정식 게시할 때는 OAuth 검증 요구 사항을 확인해야 합니다. Gmail API를 사용하지 않을 때는 `PDF 저장 후 메일 앱 열기`로 내려받은 파일을 직접 첨부할 수 있습니다.

## 로컬 데모 실행

별도 패키지 설치가 필요하지 않습니다. Node.js 18 이상에서 실행합니다.

```bash
npm start
```

브라우저에서 `http://127.0.0.1:4173`을 열고 `관리자 데모` 또는 `선생님 데모`를 선택합니다.

```bash
npm run qa
```

모든 수정은 커밋 전에 전체 QA를 통과해야 합니다. 최초 복제 후 `git config core.hooksPath .githooks`를 한 번 실행하면 pre-commit 훅이 QA를 자동 실행합니다. 상세 검사 범위는 [`docs/qa.md`](./docs/qa.md)를 참고하세요.

## Firebase 연결

1. [Firebase Console](https://console.firebase.google.com/)에서 프로젝트와 웹 앱을 만듭니다.
2. Authentication에서 Google 로그인 제공업체를 활성화합니다. Firebase 공식 절차는 [Google 로그인 안내](https://firebase.google.com/docs/auth/web/google-signin)를 따릅니다.
3. Authentication의 승인된 도메인에 `devrobertson.github.io`를 추가합니다.
4. Cloud Firestore를 프로덕션 모드로 만듭니다. 테스트 모드로 개인정보를 올리지 마세요.
5. App Check에서 웹 앱과 reCAPTCHA v3를 등록합니다. 처음에는 지표를 확인한 뒤 Firestore 적용을 강제합니다.
6. Firebase 웹 앱 설정값을 [`src/config.js`](./src/config.js)에 입력하고 `demoMode`를 `false`로 바꿉니다. Firebase 웹 설정과 App Check 사이트 키는 공개 식별자이며 서버 비밀키가 아닙니다.
7. `portalUrl`에 실제 GitHub Pages 주소를 입력합니다. 비워두면 현재 접속 주소를 자동으로 사용합니다.
8. `firestore.rules`, `firestore.indexes.json`, `storage.rules`를 Firebase CLI 또는 Console에서 배포합니다. 규칙 배포 방법은 [Firestore Security Rules 안내](https://firebase.google.com/docs/firestore/security/get-started)를 참고하세요.

```bash
firebase use YOUR_PROJECT_ID
firebase deploy --only firestore:rules,firestore:indexes,storage
```

### 첫 관리자 등록

앱에서 관리자 Google 계정으로 한 번 로그인을 시도합니다. 아직 사용자 문서가 없으므로 앱은 접근을 거부하지만 Authentication 사용자 목록에는 계정과 UID가 생성됩니다. Firestore Console에서 `users/{관리자 UID}` 문서를 아래처럼 만듭니다.

```json
{
  "displayName": "운영 관리자",
  "email": "admin@example.com",
  "role": "admin",
  "status": "active"
}
```

선생님은 `users/{선생님 UID}`에 `role: "teacher"`, `teacherId: "teachers 문서 ID"`, `status: "active"`를 설정합니다. `teachers/{teacherId}`의 `authUid`에도 같은 UID를 저장해야 명세서를 확정할 수 있습니다.

### 계산 정책 등록

앱에는 2026년 8월 25일 확인 기준의 국세청 원천징수 규칙과 2024년 2월 29일 개정 근로소득 간이세액표가 내장되어 있습니다. 관리자는 `계산 · 보안 설정`에서 현재 표를 CSV로 내려받고, 법령이 바뀌면 새 공식 표·요율·시행일을 `taxPolicies/{버전}`에 새 버전으로 등록할 수 있습니다. 등록된 세금 기준은 수정·삭제하지 않으며 확정 명세서에 `taxPolicyVersion`을 남깁니다.

사회보험은 국세청 소관 세금과 분리한 `insurancePolicies/{버전}`으로 관리합니다. 앱에는 2026년 공식 근로자 부담률과 국민연금·건강보험 상하한이 시행일별로 내장되어 있으며, 관리자는 `계산 · 보안 설정`에서 새 버전을 추가할 수 있습니다. 자동 계산은 예상값이므로 실제 확정 전 공단 고지액, 입·퇴사월, 두루누리 지원, 휴직·정산 내역을 확인하고 필요한 경우 선생님별 수동 공제액을 사용합니다. 상세 계산 근거와 변경 절차는 [`docs/tax-policy.md`](./docs/tax-policy.md)를 참고하세요.

## GitHub Pages 배포

저장소의 Settings > Pages > Build and deployment에서 Source를 `Deploy from a branch`로 선택합니다. Branch는 `main`, 폴더는 `/(root)`를 선택하고 저장합니다. 이후 `main` 브랜치에 푸시된 정적 파일이 자동으로 게시됩니다. 자세한 절차는 [GitHub Pages 게시 소스 설정](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)을 참고하세요.

예상 주소는 `https://devrobertson.github.io/academy-payroll-console/`입니다.

## 운영 전 필수 확인

- 실제 개인정보로 테스트하지 말고 별도 가상 계정을 사용합니다.
- 보안 규칙 테스트와 App Check 지표를 확인한 뒤 운영 데이터를 입력합니다.
- 사회보험 적용 단위, 기준소득월액/보수월액과 소득 구분의 계약 실질은 기장 회계사·노무사가 최종 확인합니다.
- 확정 후 오류는 기존 문서를 덮어쓰지 말고 취소·재발행 이력을 남기는 기능으로 처리합니다.
- CSV와 PDF도 개인정보이므로 공개 저장소, 개인 메신저, 공용 PC에 남기지 않습니다.

설계 상세는 [`docs/architecture.md`](./docs/architecture.md), 컬렉션 구조는 [`docs/firestore-schema.md`](./docs/firestore-schema.md), 운영 점검은 [`docs/security-checklist.md`](./docs/security-checklist.md), 변경 QA는 [`docs/qa.md`](./docs/qa.md)를 참고하세요.

실제 운영을 시작하는 전체 순서는 [`docs/remaining-operations.md`](./docs/remaining-operations.md), 화면 사용법은 [`docs/user-guide.md`](./docs/user-guide.md), Gemini 연결은 [`docs/ai-assistant-setup.md`](./docs/ai-assistant-setup.md)를 따르세요.

## 법적 유의사항

이 프로젝트의 계산 엔진은 업무 도구의 기반이며 세무·노무 자문이나 신고 프로그램을 대체하지 않습니다. 4대보험과 세액은 계약 관계, 월 보수, 상·하한, 비과세 항목, 소득 종류에 따라 달라질 수 있으므로 실제 발행 전 세무사 또는 노무사의 확인이 필요합니다.

