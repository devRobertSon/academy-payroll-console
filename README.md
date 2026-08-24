# academy-payroll-console

학원 선생님의 월별 수업 내역을 소득 구분별로 계산하고, 급여명세서와 기장용 급여내역서를 만드는 GitHub Pages + Firebase 웹 앱입니다.

이 저장소는 공개 저장소를 전제로 설계했습니다. 실제 이름, 이메일, 계좌, 급여, 계약 정보는 저장소에 넣지 않고 Firebase Authentication과 Cloud Firestore에만 보관합니다. 현재 포함된 이름과 이메일은 `.invalid` 도메인을 사용한 가상 데이터입니다.

## 구현된 기능

- 관리자/선생님 역할별 화면
- Google 로그인 및 Firestore 사용자 권한 확인
- 선생님·과목·시급·계약 조건 관리
- 같은 선생님의 과목별 시급과 소득 구분 혼합 처리
- 수업별 4대보험 적용 여부와 소득 구분 스냅샷
- 수업 내역 직접 입력 및 UTF-8 CSV 업로드
- 근로소득, 사업소득, 기타소득, 미공제 금액 분리 계산
- 공제액 자동 계산과 관리자 수동 보정
- 월별 급여 확정, 명세서 공개, 확정본 잠금
- 급여 확정 후 포털 로그인 안내문·링크 복사
- 선생님 본인의 발행된 과거 급여명세서 열람
- 선생님의 명세서 최초 열람 기록
- 브라우저 인쇄/PDF 저장 및 기장용 CSV 출력
- 기본 거부 방식 Firestore/Storage 보안 규칙
- 급여 확정 시 명세서·월 마감·감사 로그 원자적 저장
- GitHub Pages `main / (root)` 정적 배포

## 무료 요금제 범위

선생님 약 20명 규모에서 Google 로그인, Firestore 저장, 본인 명세서 조회, 열람 기록, 관리자 급여 계산은 Firebase Spark 요금제로 시작할 수 있습니다. Firestore의 현재 무료 제공량은 저장 1 GiB, 일 50,000회 읽기, 일 20,000회 쓰기, 월 10 GiB 외부 전송입니다. 이 앱의 정상적인 월 1회 급여 작업은 그보다 훨씬 작습니다. 자세한 수치는 [Cloud Firestore 요금 안내](https://firebase.google.com/docs/firestore/pricing)에서 확인하세요.

Spark 버전은 이메일을 자동 발송하지 않습니다. 급여 확정 후 관리자가 `안내문 복사`를 눌러 로그인 링크를 원하는 메일이나 메신저로 보내면, 선생님은 등록된 Google 계정으로 로그인해 명세서를 확인합니다. 기장 회계사는 앱에 로그인하지 않으며, 관리자가 PDF 또는 CSV를 내려받아 합의된 안전한 채널로 직접 전달합니다. 자동 이메일, 서버 PDF, 재발송 큐, 비밀키 보관이 필요해지면 Blaze 요금제와 Cloud Functions를 추가하는 방식이 적합합니다.

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

`payrollPolicies/{버전}` 문서에는 적용 월과 요율을 저장합니다. 저장소의 데모 요율을 실제 신고에 그대로 사용하지 마세요. 적용 월마다 기장 회계사의 확인을 받은 값을 새 버전으로 등록하고, 확정 명세서에는 `policyVersion`을 스냅샷으로 남깁니다.

## GitHub Pages 배포

저장소의 Settings > Pages > Build and deployment에서 Source를 `Deploy from a branch`로 선택합니다. Branch는 `main`, 폴더는 `/(root)`를 선택하고 저장합니다. 이후 `main` 브랜치에 푸시된 정적 파일이 자동으로 게시됩니다. 자세한 절차는 [GitHub Pages 게시 소스 설정](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)을 참고하세요.

예상 주소는 `https://devrobertson.github.io/academy-payroll-console/`입니다.

## 운영 전 필수 확인

- 실제 개인정보로 테스트하지 말고 별도 가상 계정을 사용합니다.
- 보안 규칙 테스트와 App Check 지표를 확인한 뒤 운영 데이터를 입력합니다.
- 사회보험 적용 단위, 기준소득월액/보수월액, 소득 구분, 간이세액은 기장 회계사가 최종 확인합니다.
- 확정 후 오류는 기존 문서를 덮어쓰지 말고 취소·재발행 이력을 남기는 기능으로 처리합니다.
- CSV와 PDF도 개인정보이므로 공개 저장소, 개인 메신저, 공용 PC에 남기지 않습니다.

설계 상세는 [`docs/architecture.md`](./docs/architecture.md), 컬렉션 구조는 [`docs/firestore-schema.md`](./docs/firestore-schema.md), 운영 점검은 [`docs/security-checklist.md`](./docs/security-checklist.md), 변경 QA는 [`docs/qa.md`](./docs/qa.md)를 참고하세요.

## 법적 유의사항

이 프로젝트의 계산 엔진은 업무 도구의 기반이며 세무·노무 자문이나 신고 프로그램을 대체하지 않습니다. 4대보험과 세액은 계약 관계, 월 보수, 상·하한, 비과세 항목, 소득 종류에 따라 달라질 수 있으므로 실제 발행 전 세무사 또는 노무사의 확인이 필요합니다.

