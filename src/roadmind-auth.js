/* RoadMind authentication UI */
(() => {
  let currentUser = null;
  let registerState = null;
  let resetEmail = '';
  let resetToken = '';

  const style = document.createElement('style');
  style.textContent = `
    .rm-auth-overlay{position:fixed;inset:0;z-index:9999;background:linear-gradient(135deg,var(--bg),var(--bg-soft));display:flex;align-items:center;justify-content:center;padding:22px;}
    .rm-auth-overlay.hidden{display:none;}
    .rm-auth-card{width:min(460px,100%);background:var(--surface);border:1px solid var(--border);border-radius:28px;box-shadow:var(--shadow-2);padding:28px;}
    .rm-auth-brand{display:flex;align-items:center;gap:12px;margin-bottom:24px;}
    .rm-auth-logo{width:46px;height:46px;border-radius:14px;background:linear-gradient(135deg,var(--blue),var(--cyan));display:flex;align-items:center;justify-content:center;color:#fff;font-size:22px;}
    .rm-auth-title{font:700 26px var(--font-display);margin:0;}
    .rm-auth-sub{color:var(--text-muted);font-size:13.5px;margin-top:3px;}
    .rm-auth-form{display:grid;gap:14px;}
    .rm-field{display:grid;gap:6px;}
    .rm-field label{font-size:12.5px;font-weight:800;color:var(--text-muted);}
    .rm-field input{width:100%;padding:13px 14px;border-radius:12px;border:1px solid var(--border);background:var(--surface-2);color:var(--text);font:600 14px var(--font-body);outline:none;}
    .rm-field input:focus{border-color:var(--blue);box-shadow:0 0 0 3px color-mix(in srgb,var(--blue) 14%,transparent);}
    .rm-auth-actions{display:flex;gap:10px;flex-wrap:wrap;align-items:center;justify-content:space-between;margin-top:4px;}
    .rm-auth-link{border:0;background:none;color:var(--blue);font-weight:800;font-size:13px;padding:0;cursor:pointer;}
    .rm-auth-error{display:none;padding:10px 12px;border-radius:10px;background:color-mix(in srgb,var(--red) 13%,transparent);color:var(--red);font-size:13px;font-weight:700;}
    .rm-auth-error.show{display:block;}
    .rm-code-input{text-align:center;font-size:28px!important;letter-spacing:10px;font-family:var(--font-display)!important;font-weight:700!important;}
    .rm-auth-note{font-size:12px;color:var(--text-faint);line-height:1.45;}
    .rm-auth-success{padding:10px 12px;border-radius:10px;background:color-mix(in srgb,var(--lime) 14%,transparent);color:var(--lime-ink);font-size:13px;font-weight:700;}
    .rm-profile-grid{display:grid;grid-template-columns:auto 1fr;gap:18px;align-items:center;}
    @media(max-width:520px){.rm-auth-card{padding:22px}.rm-profile-grid{grid-template-columns:1fr;text-align:center}.rm-profile-grid .avatar{margin:auto}.rm-auth-actions{align-items:stretch;flex-direction:column}.rm-auth-actions .btn{width:100%;}}
  `;
  document.head.appendChild(style);

  const overlay = document.createElement('div');
  overlay.className = 'rm-auth-overlay';
  overlay.id = 'rmAuthOverlay';
  document.body.appendChild(overlay);

  function esc(value){
    return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  async function api(path, options = {}){
    const response = await fetch(path, {
      credentials: 'same-origin',
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    });
    let data = {};
    try { data = await response.json(); } catch (_) {}
    if(!response.ok){
      const error = new Error(data.error || 'Възникна грешка.');
      error.status = response.status;
      throw error;
    }
    return data;
  }

  function setError(message){
    const box = overlay.querySelector('.rm-auth-error');
    if(!box) return;
    if(!message){ box.textContent = ''; box.classList.remove('show'); return; }
    box.textContent = message;
    box.classList.add('show');
  }

  function setBusy(button, busy, label){
    if(!button) return;
    if(busy){
      button.dataset.oldText = button.textContent;
      button.textContent = label || 'Моля, изчакай...';
      button.disabled = true;
      button.style.opacity = '.7';
    }else{
      button.textContent = button.dataset.oldText || button.textContent;
      button.disabled = false;
      button.style.opacity = '';
    }
  }

  function shell(title, subtitle, body){
    overlay.innerHTML = `
      <div class="rm-auth-card">
        <div class="rm-auth-brand">
          <div class="rm-auth-logo">🚗</div>
          <div>
            <h1 class="rm-auth-title">${esc(title)}</h1>
            <div class="rm-auth-sub">${esc(subtitle)}</div>
          </div>
        </div>
        <div class="rm-auth-error"></div>
        ${body}
      </div>
    `;
  }

  function showLogin(message = ''){
    shell('Вход в RoadMind', 'Продължи подготовката си за категория B.', `
      ${message ? `<div class="rm-auth-success" style="margin-bottom:14px;">${esc(message)}</div>` : ''}
      <form class="rm-auth-form" id="rmLoginForm">
        <div class="rm-field"><label>Имейл</label><input id="rmLoginEmail" type="email" autocomplete="email" required></div>
        <div class="rm-field"><label>Парола</label><input id="rmLoginPassword" type="password" autocomplete="current-password" required></div>
        <button class="btn btn-primary" type="submit">Вход</button>
        <div class="rm-auth-actions">
          <button class="rm-auth-link" type="button" id="rmForgotLink">Забравена парола?</button>
          <button class="rm-auth-link" type="button" id="rmRegisterLink">Нямаш профил? Регистрация</button>
        </div>
      </form>
    `);

    overlay.querySelector('#rmRegisterLink').onclick = showRegister;
    overlay.querySelector('#rmForgotLink').onclick = showForgotEmail;
    overlay.querySelector('#rmLoginForm').onsubmit = async e => {
      e.preventDefault();
      setError('');
      const button = e.submitter;
      setBusy(button, true, 'Влизане...');
      try{
        const result = await api('/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({
            email: overlay.querySelector('#rmLoginEmail').value,
            password: overlay.querySelector('#rmLoginPassword').value
          })
        });
        completeAuth(result.user);
      }catch(error){ setError(error.message); }
      finally{ setBusy(button, false); }
    };
  }

  function showRegister(){
    shell('Създай профил', 'Ще потвърдим имейла ти с 6-цифрен код.', `
      <form class="rm-auth-form" id="rmRegisterForm">
        <div class="rm-field"><label>Име</label><input id="rmFirstName" autocomplete="given-name" required maxlength="40"></div>
        <div class="rm-field"><label>Фамилия</label><input id="rmLastName" autocomplete="family-name" required maxlength="40"></div>
        <div class="rm-field"><label>Имейл</label><input id="rmRegisterEmail" type="email" autocomplete="email" required></div>
        <div class="rm-field"><label>Парола</label><input id="rmRegisterPassword" type="password" autocomplete="new-password" minlength="8" required></div>
        <div class="rm-auth-note">Паролата трябва да е поне 8 символа. След регистрацията ще изпратим код на посочения имейл.</div>
        <button class="btn btn-primary" type="submit">Регистрация</button>
        <button class="rm-auth-link" type="button" id="rmBackLogin">← Назад към вход</button>
      </form>
    `);
    overlay.querySelector('#rmBackLogin').onclick = () => showLogin();
    overlay.querySelector('#rmRegisterForm').onsubmit = async e => {
      e.preventDefault();
      setError('');
      const button = e.submitter;
      registerState = {
        firstName: overlay.querySelector('#rmFirstName').value.trim(),
        lastName: overlay.querySelector('#rmLastName').value.trim(),
        email: overlay.querySelector('#rmRegisterEmail').value.trim(),
        password: overlay.querySelector('#rmRegisterPassword').value
      };
      setBusy(button, true, 'Изпращаме код...');
      try{
        await api('/api/auth/register/start', { method:'POST', body:JSON.stringify(registerState) });
        showRegisterCode();
      }catch(error){ setError(error.message); }
      finally{ setBusy(button, false); }
    };
  }

  function showRegisterCode(){
    const email = registerState?.email || '';
    shell('Потвърди имейла', `Изпратихме 6-цифрен код на ${email}.`, `
      <form class="rm-auth-form" id="rmRegisterCodeForm">
        <div class="rm-field"><label>Код за потвърждение</label><input id="rmRegisterCode" class="rm-code-input" inputmode="numeric" maxlength="6" pattern="[0-9]{6}" required></div>
        <button class="btn btn-primary" type="submit">Потвърди</button>
        <div class="rm-auth-actions">
          <button class="rm-auth-link" type="button" id="rmResendRegister">Изпрати кода отново</button>
          <button class="rm-auth-link" type="button" id="rmCancelRegister">Отказ</button>
        </div>
      </form>
    `);
    overlay.querySelector('#rmCancelRegister').onclick = () => showLogin();
    overlay.querySelector('#rmResendRegister').onclick = async () => {
      setError('');
      try{
        await api('/api/auth/register/start', { method:'POST', body:JSON.stringify(registerState) });
        setError('Нов код е изпратен.');
      }catch(error){ setError(error.message); }
    };
    overlay.querySelector('#rmRegisterCodeForm').onsubmit = async e => {
      e.preventDefault();
      setError('');
      const button = e.submitter;
      setBusy(button, true, 'Проверка...');
      try{
        await api('/api/auth/register/verify', {
          method:'POST',
          body:JSON.stringify({ email, code:overlay.querySelector('#rmRegisterCode').value.trim() })
        });
        const login = await api('/api/auth/login', {
          method:'POST',
          body:JSON.stringify({ email, password:registerState.password })
        });
        registerState = null;
        completeAuth(login.user);
      }catch(error){ setError(error.message); }
      finally{ setBusy(button, false); }
    };
  }

  function showForgotEmail(){
    shell('Забравена парола', 'Ще изпратим 6-цифрен код на регистрирания ти имейл.', `
      <form class="rm-auth-form" id="rmForgotForm">
        <div class="rm-field"><label>Имейл</label><input id="rmForgotEmail" type="email" autocomplete="email" required></div>
        <button class="btn btn-primary" type="submit">Изпрати код</button>
        <button class="rm-auth-link" type="button" id="rmForgotBack">← Назад към вход</button>
      </form>
    `);
    overlay.querySelector('#rmForgotBack').onclick = () => showLogin();
    overlay.querySelector('#rmForgotForm').onsubmit = async e => {
      e.preventDefault();
      const button = e.submitter;
      resetEmail = overlay.querySelector('#rmForgotEmail').value.trim();
      setBusy(button, true, 'Изпращаме код...');
      try{
        await api('/api/auth/password/start', { method:'POST', body:JSON.stringify({ email:resetEmail }) });
        showForgotCode();
      }catch(error){ setError(error.message); }
      finally{ setBusy(button, false); }
    };
  }

  function showForgotCode(){
    shell('Въведи кода', `Ако ${resetEmail} е регистриран, изпратихме 6-цифрен код.`, `
      <form class="rm-auth-form" id="rmForgotCodeForm">
        <div class="rm-field"><label>Код</label><input id="rmForgotCode" class="rm-code-input" inputmode="numeric" maxlength="6" pattern="[0-9]{6}" required></div>
        <button class="btn btn-primary" type="submit">Продължи</button>
        <div class="rm-auth-actions">
          <button class="rm-auth-link" type="button" id="rmResendReset">Изпрати отново</button>
          <button class="rm-auth-link" type="button" id="rmResetBack">Назад</button>
        </div>
      </form>
    `);
    overlay.querySelector('#rmResetBack').onclick = showForgotEmail;
    overlay.querySelector('#rmResendReset').onclick = async () => {
      try{ await api('/api/auth/password/start', { method:'POST', body:JSON.stringify({ email:resetEmail }) }); }
      catch(error){ setError(error.message); }
    };
    overlay.querySelector('#rmForgotCodeForm').onsubmit = async e => {
      e.preventDefault();
      const button = e.submitter;
      setBusy(button, true, 'Проверка...');
      try{
        const data = await api('/api/auth/password/verify', {
          method:'POST',
          body:JSON.stringify({ email:resetEmail, code:overlay.querySelector('#rmForgotCode').value.trim() })
        });
        resetToken = data.resetToken;
        showResetPassword();
      }catch(error){ setError(error.message); }
      finally{ setBusy(button, false); }
    };
  }

  function showResetPassword(){
    shell('Нова парола', 'Кодът е потвърден. Запиши новата си парола.', `
      <form class="rm-auth-form" id="rmResetPasswordForm">
        <div class="rm-field"><label>Нова парола</label><input id="rmNewPassword" type="password" minlength="8" autocomplete="new-password" required></div>
        <div class="rm-field"><label>Повтори паролата</label><input id="rmNewPassword2" type="password" minlength="8" autocomplete="new-password" required></div>
        <button class="btn btn-primary" type="submit">Запиши новата парола</button>
      </form>
    `);
    overlay.querySelector('#rmResetPasswordForm').onsubmit = async e => {
      e.preventDefault();
      const p1 = overlay.querySelector('#rmNewPassword').value;
      const p2 = overlay.querySelector('#rmNewPassword2').value;
      if(p1 !== p2){ setError('Паролите не съвпадат.'); return; }
      const button = e.submitter;
      setBusy(button, true, 'Записване...');
      try{
        await api('/api/auth/password/reset', {
          method:'POST',
          body:JSON.stringify({ email:resetEmail, resetToken, newPassword:p1 })
        });
        resetEmail = '';
        resetToken = '';
        showLogin('Паролата е сменена успешно. Влез с новата парола.');
      }catch(error){ setError(error.message); }
      finally{ setBusy(button, false); }
    };
  }

  function applyUser(user){
    currentUser = user;
    window.roadMindCurrentUser = user;

    const greeting = document.querySelector('#view-dashboard .hero-greet');
    if(greeting) greeting.textContent = `Здравей, ${user.firstName || user.displayName || 'водач'} 👋`;

    const profile = document.getElementById('view-profile');
    if(profile){
      const initials = `${(user.firstName || '')[0] || ''}${(user.lastName || '')[0] || ''}`.toUpperCase() || 'RM';
      profile.innerHTML = `
        <div class="section-head" style="margin-top:6px;"><h2 style="font-size:24px;">Профил</h2></div>
        <div class="card" style="padding:26px;">
          <div class="rm-profile-grid">
            <div class="avatar">${esc(initials)}</div>
            <div>
              <h2 style="margin:0 0 5px;">${esc(user.firstName || '')} ${esc(user.lastName || '')}</h2>
              <div class="muted">${esc(user.email || '')}</div>
              <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;">
                <span class="pill pill-blue">Категория B</span>
                <span class="pill pill-green">✓ Потвърден имейл</span>
              </div>
            </div>
          </div>
          <div class="road-rule" style="margin:24px 0;"></div>
          <button class="btn btn-ghost" id="rmLogoutButton">Изход от профила</button>
        </div>
      `;
      profile.querySelector('#rmLogoutButton').onclick = logout;
    }
  }

  function completeAuth(user){
    applyUser(user);
    overlay.classList.add('hidden');
    document.dispatchEvent(new CustomEvent('roadmind:auth-ready', { detail:user }));
    if(typeof window.refreshRoadMindDashboard === 'function') window.refreshRoadMindDashboard();
  }

  async function logout(){
    try{ await api('/api/auth/logout', { method:'POST', body:'{}' }); }catch(_){}
    currentUser = null;
    window.roadMindCurrentUser = null;
    sessionStorage.clear();
    showLogin('Излезе успешно от профила.');
    overlay.classList.remove('hidden');
  }

  async function bootstrap(){
    try{
      const data = await api('/api/auth/me', { method:'GET', headers:{} });
      completeAuth(data.user);
    }catch(_){
      showLogin();
      overlay.classList.remove('hidden');
    }
  }

  window.roadMindLogout = logout;
  bootstrap();
})();
