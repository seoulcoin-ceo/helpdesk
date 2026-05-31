보험청구안내데스크 GitHub Pages v4 - Formspree 캐시 문제 해결본

적용 endpoint: https://formspree.io/f/xykvdnvd
수신 기준 이메일: insung9908@naver.com

이번 v4 수정 이유:
- 기존 사이트가 예전 script.js 파일을 브라우저/GitHub Pages 캐시에 보관해 예전 오류 문구가 계속 뜰 수 있습니다.
- 그래서 자바스크립트 파일명을 app-formspree-v4.js 로 변경했습니다.
- index.html에서도 app-formspree-v4.js?v=4 로 호출하도록 변경했습니다.
- 예전 폼 서비스 관련 전송 코드는 없습니다.

업로드 방법:
1. ZIP 압축을 풉니다.
2. 압축 푼 폴더 안의 파일 전체를 GitHub 저장소 helpdesk에 업로드합니다.
3. Commit changes를 누릅니다.
4. Actions에서 pages build and deployment 초록 체크를 확인합니다.
5. https://seoulcoin-ceo.github.io/helpdesk/?v=4 로 접속합니다.

정상 여부 확인:
- 사이트에서 Ctrl+U를 누르고 xykvdnvd 를 검색하면 나와야 합니다.
- 예전 폼 서비스 주소가 보이면 아직 이전 파일이 열리고 있는 것입니다.
