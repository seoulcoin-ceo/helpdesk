보험청구 안내 데스크 홈페이지 - GitHub Pages 업로드용 v3 Formspree 수정본

수정 완료 내용
1. 실제 문의폼 action을 Formspree endpoint로 변경했습니다.
2. Form endpoint: https://formspree.io/f/xykvdnvd
3. 수신 기준 이메일 안내 문구는 insung9908@naver.com 기준으로 유지했습니다.
4. 기존 FormSubmit 관련 안내 문구를 제거했습니다.
5. GitHub Pages에서 바로 동작할 수 있도록 정적 HTML/CSS/JS 구조를 유지했습니다.
6. .nojekyll 파일을 유지했습니다.

중요: Formspree 확인 사항
- Formspree 대시보드에서 endpoint가 https://formspree.io/f/xykvdnvd 인지 확인하세요.
- 해당 Formspree 폼의 수신 이메일이 insung9908@naver.com 으로 되어 있어야 합니다.
- 제출 후 기본적으로 Formspree의 Thank You 화면으로 이동할 수 있습니다.
- 자체 thanks.html로 이동시키고 싶으면 Formspree 대시보드의 Redirect / Thank You redirect 설정에 아래 주소를 넣으세요.
  https://seoulcoin-ceo.github.io/helpdesk/thanks.html

GitHub Pages 덮어쓰기 업로드 방법
1. GitHub 저장소 seoulcoin-ceo/helpdesk 화면으로 이동합니다.
2. Code → Add file → Upload files를 누릅니다.
3. 이 ZIP 파일을 PC에서 먼저 압축 해제합니다.
4. 압축 푼 폴더 안의 파일 전체를 선택해서 업로드 화면에 드래그합니다.
   - index.html
   - style.css
   - script.js
   - privacy.html
   - contact.html
   - thanks.html
   - 404.html
   - robots.txt
   - sitemap.xml
   - .nojekyll
   - assets 폴더
5. Commit changes를 누릅니다.
6. 1~3분 기다린 뒤 https://seoulcoin-ceo.github.io/helpdesk/ 로 접속합니다.
7. 캐시가 남아 있으면 Ctrl + F5로 강력 새로고침합니다.

수정된 폼 설정
- 폼 서비스: Formspree
- Form endpoint: https://formspree.io/f/xykvdnvd
- form method: POST
- 수신 기준 이메일: insung9908@naver.com
- 이메일 제목 필드: 보험청구 안내 데스크 홈페이지 문의
