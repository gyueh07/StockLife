# StockLife v3.1 Name Login

GitHub Pages 배포용 완성본입니다.

## 포함 기능
- Firebase 로그인 / 회원가입 / 로그아웃
- 이름 + 비밀번호 로그인 방식
- Firestore 자동 저장
- 총 자산 랭킹 TOP 20
- 홈 / 시장 / 종목 상세 / 지갑 / 랭킹 / 프로필
- 시장 검색 / 정렬 / 상승·하락·보유 필터
- 관심 종목 및 시장 상단 고정
- 5분 / 1시간 / 1일 / 1주 / 전체 차트
- 차트 십자선
- 매수/매도 MAX, 수량 직접 입력
- 부족 금액/부족 수량 경고 및 버튼 비활성화
- 거래 확인창
- 평균단가, 평가손익, 수익률
- 최근 거래 내역 20개
- Min/Max 보정 + 종목별 변동성 가격 알고리즘
- 숫자 애니메이션, 로딩, 토스트, 모바일 최적화

## GitHub Pages
루트에 index.html, css 폴더, js 폴더를 업로드하세요.


## v3.1 변경점
- 로그인/회원가입을 이메일이 아니라 이름으로 변경했습니다.
- Firebase Auth는 내부적으로 이메일 형식이 필요해서, 입력한 이름을 숨겨진 내부 이메일로 변환합니다.
- 예: `철수` → 내부 계정 이메일 형식으로 자동 변환
- 사용자는 이메일을 볼 필요가 없습니다.

## 중요
Firebase Authentication에서 Email/Password 로그인이 켜져 있어야 합니다.
GitHub Pages 주소가 Firebase Authentication > Settings > Authorized domains에 등록되어 있어야 합니다.
