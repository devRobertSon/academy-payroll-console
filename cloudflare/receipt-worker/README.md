# Receipt Drive and Mail Worker

교통비·주차비 영수증 파일을 학원 관리자 Google Drive에 비공개로 저장하는 Cloudflare Worker입니다.

- Firebase ID token 서명과 `users/{uid}` 역할을 확인합니다.
- Google OAuth 범위는 `drive.file`만 사용합니다.
- 갱신 토큰은 `RECEIPT_KV`에 AES-GCM 암호화해 저장합니다.
- 파일은 `Academy Payroll Receipts / YYYY-MM / teacherId` 폴더에 무작위 이름으로 저장합니다.
- 승인된 파일은 선생님에게 제공하지 않고 관리자만 열람합니다.
- Drive와 별도로 연결한 관리자 Gmail 계정으로 급여 확정 후 포털 확인 링크를 발송합니다.
- Worker가 현재 확정 차수와 등록 이메일을 Firestore에서 재검증하고 KV 중복 방지 키를 사용합니다.

배포와 Secret 설정 순서는 `docs/google-drive-receipts-setup.md`를 따릅니다.
