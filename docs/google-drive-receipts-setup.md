# Google Drive 영수증 보관 설정

이 기능은 Firebase Storage 대신 학원 관리자의 유료 Google Drive를 사용합니다. 영수증 파일은 공개 GitHub 저장소와 Firestore에 저장하지 않습니다. Firestore에는 금액, 상태, 해시와 Google Drive 파일 ID 같은 관리용 정보만 저장합니다.

## 처리 흐름

1. 선생님이 `영수증 제출`에서 교통비 또는 주차비 파일을 제출합니다.
2. 브라우저가 이미지를 축소하고 Cloudflare Worker로 전송합니다.
3. Worker가 Firebase 로그인과 선생님 본인 여부를 확인한 뒤 관리자 Google Drive의 비공개 폴더에 저장합니다.
4. 관리자가 `영수증 관리`에서 파일과 금액을 확인하고 회계 처리 방식을 선택해 승인 또는 반려합니다.
5. 승인된 금액은 해당 월 교통비 또는 주차비 지급 항목에 자동 합산됩니다.
6. 승인 후 선생님은 상태와 금액만 볼 수 있고 파일은 관리자만 열람합니다.

보관 기간은 아직 확정되지 않았으므로 자동 삭제 기능은 꺼져 있습니다. 세무사와 법정 증빙 보존기간을 확인한 뒤 별도 정책을 정합니다.

## 1. Firestore 규칙 게시

Repository의 최신 `firestore.rules`를 Firebase Console의 Firestore Database > 규칙에 붙여넣고 게시합니다. 게시 전에는 영수증 제출 화면이 있어도 메타데이터 저장이 거부됩니다.

## 2. Google Drive·Gmail API와 OAuth Client

1. Firebase와 같은 Google Cloud 프로젝트 `academy-payroll-console`을 엽니다.
2. API 및 서비스 > 라이브러리에서 `Google Drive API`를 사용 설정합니다.
3. 같은 라이브러리에서 `Gmail API`도 사용 설정합니다.
4. Google Auth Platform에서 앱 홈페이지, 개인정보처리방침과 서비스 이용약관 주소를 확인합니다.
5. 데이터 액세스 범위에 `https://www.googleapis.com/auth/drive.file`과 `https://www.googleapis.com/auth/gmail.send`를 추가합니다.
6. 클라이언트 > 클라이언트 만들기 > 웹 애플리케이션을 선택합니다.
7. 승인된 리디렉션 URI에 `https://payroll-api.robertson.kr/oauth/google/callback`을 정확히 추가합니다.
8. 발급된 Client ID와 Client secret은 GitHub에 적지 않고 다음 Worker Secret 단계에서만 사용합니다.

OAuth 앱이 테스트 상태이면 Drive 갱신 토큰이 짧은 기간 뒤 만료될 수 있습니다. 실제 운영 전에 Google Auth Platform의 게시 상태와 검증 요구 사항을 확인합니다. 테스트 중에는 관리자 Google 계정을 테스트 사용자로 등록합니다.

## 3. Cloudflare Worker와 KV

1. Cloudflare Dashboard > Workers & Pages에서 Worker `academy-payroll-receipts`를 만듭니다.
2. Repository의 `cloudflare/receipt-worker/src/index.js`를 Worker 코드로 배포합니다.
3. KV namespace `academy-payroll-receipts-kv`를 만들고 Worker에 binding 이름 `RECEIPT_KV`로 연결합니다.
4. Worker Variables에 아래 공개 설정을 추가합니다.

| 변수 | 값 |
|---|---|
| `FIREBASE_PROJECT_ID` | `academy-payroll-console` |
| `APP_ORIGIN` | `https://payroll.robertson.kr` |
| `API_ORIGIN` | `https://payroll-api.robertson.kr` |
| `DRIVE_ROOT_FOLDER_NAME` | `Academy Payroll Receipts` |

5. Worker Secrets에 아래 값을 추가합니다.

| Secret | 값 |
|---|---|
| `GOOGLE_CLIENT_ID` | Google OAuth Web Client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth Client secret |
| `TOKEN_ENCRYPTION_KEY` | 비밀번호 관리자에서 만든 길고 무작위인 값 |

6. Worker Custom Domain에 `payroll-api.robertson.kr`을 연결합니다. Cloudflare가 이 호스트의 DNS를 관리하게 하고 별도의 GitHub Pages CNAME으로 만들지 않습니다.
7. `https://payroll-api.robertson.kr/health`에서 `{"ok":true,"version":"20260828-drive-owner-r35"}`가 표시되는지 확인합니다.

## 4. 관리자 Drive 연결

1. `https://payroll.robertson.kr`에 관리자 계정으로 로그인합니다.
2. `영수증 관리` > `Google Drive 연결`을 누릅니다.
3. 100GB를 사용 중인 관리자 Google 계정을 선택하고 Drive 파일 생성 권한을 승인합니다.
4. 포털로 돌아와 `Google Drive 영수증 보관 연결을 완료했습니다.` 메시지를 확인합니다.
5. Drive에 `Academy Payroll Receipts` 폴더가 생기는 것은 첫 영수증 제출 때입니다.
6. Drive 연결은 학원 전체에서 하나만 사용합니다. 최초 연결 관리자만 같은 Drive 계정을 다시 연결할 수 있고, 다른 관리자의 `Google Drive 연결됨` 버튼은 비활성화됩니다. 다른 관리자도 영수증 검토와 파일 열람은 그대로 할 수 있습니다.

Drive 소유 관리자를 바꿔야 할 때는 운영을 멈춘 뒤 Workers KV의 `drive_connection` 항목만 삭제하고 새 관리자가 다시 연결합니다. 이 작업은 기존 Drive 파일을 삭제하지 않지만, 새 연결 계정에 기존 파일 접근 권한이 없으면 과거 영수증을 열 수 없으므로 계정 변경 전에 파일 이전과 접근 권한을 확인합니다.

## 5. 관리자 Gmail 발송 계정 연결

1. 최신 Worker 코드를 배포한 뒤 급여 대시보드의 `발송 계정 연결`을 누릅니다.
2. 실제 발신에 사용할 관리자 Gmail 계정을 선택하고 메일 발송 권한을 승인합니다. Google Cloud 프로젝트 또는 Drive 연결 계정과 달라도 됩니다.
3. 포털로 돌아와 `급여 안내 Gmail 발송 계정을 연결했습니다.` 메시지를 확인합니다.
4. 버튼에 연결한 발송 이메일이 표시되는지 확인합니다.
5. Gmail 발송 계정은 Drive와 달리 어느 관리자든 새 계정으로 다시 연결할 수 있으며, 마지막으로 연결한 계정이 공용 발송자가 됩니다.
6. 테스트 급여를 확정해 선생님에게 금액이나 PDF 없이 포털 확인 링크만 발송되는지 확인합니다.
7. 일부 실패 시 `미발송 안내 발송`을 눌러 성공한 선생님에게 중복 발송되지 않고 실패 건만 처리되는지 확인합니다.

## 6. 운영 전 QA

1. 가상 선생님 계정으로 작은 테스트 이미지와 PDF를 각각 제출합니다.
2. 관리자 알림을 눌러 해당 영수증 검토 화면이 열리는지 확인합니다.
3. 교통비 하나는 승인하고 주차비 하나는 반려합니다.
4. 승인한 교통비만 월 급여 입력, 급여명세서와 월별 급여내역서에 합산되는지 확인합니다.
5. 승인 후 선생님 화면에서 파일 열기 버튼이 사라지는지 확인합니다.
6. 다른 선생님의 파일 ID나 URL로 접근해도 거부되는지 확인합니다.
7. 급여 확정 후 같은 월의 제출·승인·삭제가 차단되는지 확인합니다.
8. 테스트가 끝나면 가상 자료를 삭제하고 실제 운영을 시작합니다.
9. 두 관리자 계정으로 차례로 로그인해 최초 연결 관리자에게만 Drive 재연결 버튼이 활성화되고 다른 관리자에게는 비활성화되는지 확인합니다.

## 보안 원칙

- Google OAuth Client secret, 암호화 키와 갱신 토큰은 GitHub 또는 `src/config.js`에 넣지 않습니다.
- Drive 폴더와 파일을 링크 공개 또는 전체 공개로 공유하지 않습니다.
- Worker는 Firebase ID token을 검증하고 Firestore 역할 문서를 다시 확인합니다.
- 파일은 5MB 이하 JPG, PNG, WebP, PDF만 허용하며 Drive에는 무작위 이름으로 저장합니다.
- 활성 계정별 업로드는 하루 40개·100MB로 제한해 Drive 용량 남용을 완화합니다.
- Firestore의 SHA-256 값은 중복 제출 경고용이며 영수증 원본을 복원할 수 없습니다.
