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

(function () {
  const form = document.getElementById('contactForm');
  const success = document.getElementById('formSuccess');
  const status = document.getElementById('formStatus');
  const writeAnother = document.getElementById('writeAnother');

  if (!form) return;

  if (writeAnother) {
    writeAnother.addEventListener('click', () => {
      if (success) success.hidden = true;
      form.hidden = false;
      form.reset();
      if (status) status.textContent = '';
      form.scrollIntoView({ behavior: 'smooth', block: 'start' });
      const firstInput = form.querySelector('input:not(.hidden), select, textarea');
      if (firstInput) firstInput.focus();
    });
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    const button = form.querySelector('button[type="submit"]');
    const originalText = button ? button.textContent : '';

    if (button) {
      button.disabled = true;
      button.textContent = '전송 중입니다...';
    }
    if (status) status.textContent = '';

    try {
      const response = await fetch(form.action, {
        method: 'POST',
        body: new FormData(form),
        headers: { 'Accept': 'application/json' }
      });

      if (response.ok) {
        form.hidden = true;
        if (success) success.hidden = false;
        if (success) success.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else {
        const message = '문의 전송 중 오류가 발생했습니다. 처음 연결하는 경우 insung9908@naver.com 메일함에서 FormSubmit 인증 메일을 먼저 확인해 주세요. 계속 실패하면 010-8416-8623으로 연락해 주세요.';
        if (status) status.textContent = message;
        alert(message);
      }
    } catch (error) {
      const message = '네트워크 오류로 문의를 전송하지 못했습니다. 인터넷 연결을 확인하거나 insung9908@naver.com 메일함의 FormSubmit 인증 여부를 확인해 주세요.';
      if (status) status.textContent = message;
      alert(message);
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = originalText;
      }
    }
  });
})();
