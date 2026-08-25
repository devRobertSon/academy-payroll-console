# AI 도움말 설정

관리자 화면의 AI 도움말은 두 단계로 동작합니다.

- Firebase AI Logic 설정 전: 브라우저 안에서 내장 사용 설명서를 검색해 답변
- Firebase AI Logic 설정 후: 관련 설명서 발췌와 질문만 Gemini에 보내 자연스러운 답변 생성

실제 급여 데이터와 현재 화면의 선생님 정보는 자동으로 AI에 전달하지 않습니다.

## 권장 구성

- AI 제공자: Gemini Developer API
- 연결 방식: Firebase AI Logic JavaScript SDK
- 인증: 기존 Firebase Authentication Google 로그인
- 앱 보호: Firebase App Check 적용 강제
- 모델: `gemini-3.5-flash-lite`
- 요금제: 초기 시험은 Spark 무료 등급

## Firebase Console 설정

1. Firebase Console에서 `AI 서비스 > AI Logic`으로 이동합니다.
2. `시작하기`를 눌러 안내 절차를 시작합니다.
3. 제공자는 `Gemini Developer API`를 선택합니다.
4. 무료 등급으로 시작하고 결제 계정을 연결하지 않습니다.
5. 현재 등록된 웹 앱 `academy-payroll-web`을 선택합니다.
6. App Check가 Firebase AI Logic API에 적용 강제로 표시되는지 확인합니다.
7. `AI Logic > 설정`에서 인증된 사용자 모드를 적용 강제로 설정합니다.
8. AI Monitoring은 프롬프트와 응답 저장을 피하기 위해 사용 중지 상태로 둡니다.
9. GitHub Pages에서 관리자 테스트 계정으로 정상 응답을 확인합니다.

콘솔 안내에서 웹용 reCAPTCHA Enterprise 전환을 요구하면 기존 설정을 임의로 삭제하지 말고 안내 절차에 따라 새 공급자를 등록한 뒤 GitHub Pages 로그인을 다시 시험합니다.

## 앱 기능 활성화

Firebase Console 설정과 App Check 확인이 끝난 뒤 `src/config.js`에서 다음 값만 바꿉니다.

```js
assistant: {
  provider: "gemini",
  enabled: true,
  model: "gemini-3.5-flash-lite"
}
```

API 키나 비밀값을 추가하지 않습니다. Firebase AI Logic 프록시와 App Check를 사용하므로 Gemini 비밀키를 GitHub Pages 코드에 넣지 않습니다.

## 개인정보 보호 범위

AI 도움말에 보내도 되는 내용:

- 메뉴 위치와 버튼 사용법
- 선생님 등록 절차
- 보험별 가입·신고 기준액, 근로소득 월급, 사업소득 시급·수업 시수와 추가 지급 입력 방법
- 명세서 확정·취소·다운로드·이메일 절차
- 일반적인 오류 해결 방법

AI 도움말에 보내면 안 되는 내용:

- 실제 이름과 Google 이메일
- 전화번호, 주민등록번호와 계좌번호
- 개인별 급여액, 공제액과 계약 내용
- Firebase UID, OAuth 토큰과 인증 정보
- 급여명세서·계약서 파일 또는 화면 캡처

입력 검사에서 이메일, 전화번호, 주민등록번호, 계좌번호 또는 긴 숫자 정보가 감지되면 Gemini 호출을 하지 않고 개인정보를 삭제하라는 안내만 표시합니다.

## QA 절차

1. 관리자 화면의 모든 탭에서 `AI 도움말`이 열리는지 확인합니다.
2. `명세서를 이메일로 보내려면?` 질문에 개인 명세서 화면 경로가 나오는지 확인합니다.
3. 테스트용 이메일이나 전화번호를 포함한 질문이 외부 전송 전에 차단되는지 확인합니다.
4. 선생님 계정에는 관리자 사용 설명서와 AI 도움말 버튼이 표시되지 않는지 확인합니다.
5. Gemini 장애 또는 할당량 초과 시 내장 설명서 답변으로 전환되는지 확인합니다.
6. 모바일 화면에서 패널, 입력창과 닫기 버튼이 겹치지 않는지 확인합니다.
7. 브라우저 개발자 도구와 공개 저장소에 Gemini API 키가 없는지 확인합니다.

## 무료 등급 주의

Gemini Developer API 무료 등급에서는 입력 내용이 Google 제품 개선에 사용될 수 있습니다. 이 앱의 무료 AI 도움말은 사용 설명서 질문 전용으로 운영하고 실제 개인정보와 급여 자료를 입력하지 않습니다. 향후 개인 급여 데이터를 AI가 분석하도록 확장하려면 유료 등급, 개인정보 처리 조건과 회계·노무 책임 범위를 먼저 검토합니다.

## 공식 문서

- [Firebase AI Logic](https://firebase.google.com/docs/ai-logic)
- [웹 앱 시작하기](https://firebase.google.com/docs/ai-logic/get-started?platform=web)
- [인증된 사용자 모드](https://firebase.google.com/docs/ai-logic/auth-mode)
- [지원되는 모델](https://firebase.google.com/docs/ai-logic/models?hl=ko)
- [프로덕션 체크리스트](https://firebase.google.com/docs/ai-logic/production-checklist)
- [요금 안내](https://firebase.google.com/docs/ai-logic/pricing)

