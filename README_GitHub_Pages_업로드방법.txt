보험청구 안내 데스크 홈페이지 - GitHub Pages 업로드용

수정 완료 내용
1. 실제 문의폼 전송 대상을 insung9908@naver.com 기준으로 변경했습니다.
2. 기존 Formspree endpoint 연결을 제거했습니다.
3. GitHub Pages에서 바로 동작할 수 있도록 정적 HTML/CSS/JS 구조로 정리했습니다.
4. GitHub Pages의 하위 경로 배포에서도 깨지지 않도록 contact.html, thanks.html, 404.html의 이동 주소를 상대경로로 수정했습니다.
5. .nojekyll 파일을 추가해 GitHub Pages에서 정적 파일이 그대로 배포되도록 했습니다.

중요: 폼메일 최초 1회 인증
- 이 파일은 FormSubmit 방식으로 폼메일을 전송합니다.
- 처음 테스트 제출을 하면 insung9908@naver.com 메일함으로 FormSubmit 인증 메일이 옵니다.
- 네이버 메일에서 인증 버튼을 눌러야 이후 문의가 정상 수신됩니다.
- 스팸메일함도 반드시 확인하세요.

GitHub Pages 업로드 방법
1. GitHub에 로그인합니다.
2. 새 저장소를 만듭니다. 예: insurance-claim-desk
3. 저장소 화면에서 Add file → Upload files를 누릅니다.
4. 이 ZIP 파일을 먼저 압축 해제합니다.
5. 압축을 푼 폴더 안의 파일 전체를 GitHub 업로드 화면에 드래그합니다.
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
6. Commit changes를 누릅니다.
7. 저장소 Settings → Pages로 이동합니다.
8. Build and deployment에서 Source를 Deploy from a branch로 선택합니다.
9. Branch는 main, 폴더는 /root로 선택하고 Save를 누릅니다.
10. 잠시 뒤 표시되는 GitHub Pages 주소로 접속합니다.

업로드 후 반드시 확인할 것
1. 홈페이지 첫 화면이 정상 표시되는지 확인합니다.
2. 메뉴 클릭 시 각 섹션으로 이동하는지 확인합니다.
3. 도입문의 폼에 테스트 내용을 넣고 제출합니다.
4. insung9908@naver.com 네이버 메일함에서 FormSubmit 인증 메일을 확인하고 인증합니다.
5. 인증 후 다시 한 번 테스트 제출하여 실제 문의 메일이 도착하는지 확인합니다.

주의사항
- GitHub Pages는 PHP, Node.js 같은 서버 프로그램을 실행하지 않습니다.
- 따라서 문의폼은 반드시 FormSubmit, Formspree 같은 외부 폼메일 서비스를 이용해야 합니다.
- 현재 파일은 별도 서버 없이 GitHub Pages에서 작동하도록 FormSubmit에 맞춰져 있습니다.
- sitemap.xml 안의 주소는 예시입니다. 실제 GitHub Pages 주소가 확정되면 나중에 바꾸는 것이 좋습니다.

수정된 폼메일 설정
- 수신 기준 이메일: insung9908@naver.com
- 폼 action: https://formsubmit.co/ajax/insung9908@naver.com
- 이메일 제목: 보험청구 안내 데스크 홈페이지 문의


[v2 수정 사항]
- FormSubmit 전송 방식을 ajax/fetch 방식에서 표준 HTML POST 방식으로 변경했습니다.
- 네트워크 오류 또는 CORS 오류로 문의가 막히는 문제를 줄였습니다.
- 문의 완료 후 https://seoulcoin-ceo.github.io/helpdesk/thanks.html 로 이동하도록 설정했습니다.
- GitHub에는 index.html, script.js, thanks.html이 반드시 새 버전으로 덮어쓰기 되어야 합니다.
