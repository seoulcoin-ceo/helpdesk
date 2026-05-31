const toggle = document.querySelector('.nav-toggle');
const nav = document.querySelector('.site-nav');

if (toggle && nav) {
  toggle.addEventListener('click', () => {
    const isOpen = nav.classList.toggle('open');
    toggle.setAttribute('aria-expanded', String(isOpen));
  });

  nav.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', () => {
      nav.classList.remove('open');
      toggle.setAttribute('aria-expanded', 'false');
    });
  });
}

// GitHub Pages에서는 서버 코드가 실행되지 않으므로 FormSubmit 표준 POST 방식으로 전송합니다.
// fetch/ajax 방식은 일부 브라우저, 보안 확장 프로그램, CORS 정책에서 실패할 수 있어 사용하지 않습니다.
(function () {
  const form = document.getElementById('contactForm');
  if (!form) return;

  form.addEventListener('submit', () => {
    const button = form.querySelector('button[type="submit"]');
    const status = document.getElementById('formStatus');

    if (button) {
      button.textContent = '전송 중입니다...';
    }
    if (status) {
      status.textContent = '문의 내용을 전송하고 있습니다. 잠시만 기다려 주세요.';
    }
    // preventDefault를 호출하지 않습니다. 브라우저가 FormSubmit으로 직접 제출합니다.
  });
})();
