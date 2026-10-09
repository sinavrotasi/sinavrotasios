// Boş alana dokununca metin alanının odağını ve klavyesini kapat.
// Capture, alt öğelerin olay işleyicilerinden bağımsız çalışır; tıklamayı engellemez.
(() => {
  function dismissAuthFieldOnOutsidePress(event) {
    if (event.isPrimary === false || (event.button !== undefined && event.button !== 0)) return;
    if (event.touches && event.touches.length !== 1) return;
    const active = document.activeElement;
    if (!active?.matches('.auth-form input:not([type="checkbox"]):not([type="radio"]), .auth-form textarea')) return;
    const target = event.target instanceof Element ? event.target : event.target?.parentElement;
    if (!target || target.closest('.field, input, textarea, select, label, button, a, [contenteditable], [data-toggle-for]')) return;
    active.blur();
  }
  if ('PointerEvent' in window) {
    document.addEventListener('pointerdown', dismissAuthFieldOnOutsidePress, { capture:true, passive:true });
  } else {
    document.addEventListener('touchstart', dismissAuthFieldOnOutsidePress, { capture:true, passive:true });
    document.addEventListener('mousedown', dismissAuthFieldOnOutsidePress, { capture:true, passive:true });
  }
})();

// ================= SınavRotası — Giriş sayfası =================

// Bu sayfanın arkaplanı açık renkli olduğu için durum çubuğu koyu ikonlarla
// başlatılır (bkz. native-ux.js). Sayfa statik olduğundan içerik zaten hazır —
// açılış ekranı hemen kapatılabilir.
window.NativeUX?.init({ statusBarStyle: 'LIGHT' });
window.NativeUX?.hideSplash();

document.getElementById('loginForm').addEventListener('submit', async event => {
  event.preventDefault();
  const loginError = document.getElementById('loginError');
  loginError.textContent = '';
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  const submitButton = document.getElementById('loginSubmit');

  setFormBusy(submitButton, true, 'Giriş Yap');
  const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
  setFormBusy(submitButton, false, 'Giriş Yap');

  if (error) {
    loginError.textContent = friendlyAuthError(error.message);
    return;
  }
  window.location.href = 'index.html';
});

document.getElementById('forgotPasswordLink')?.addEventListener('click', async () => {
  const loginError = document.getElementById('loginError');
  const email = document.getElementById('loginEmail').value.trim();
  if (!email) {
    loginError.textContent = 'Sıfırlama bağlantısı gönderebilmemiz için önce e-postanı yaz.';
    return;
  }
  loginError.textContent = '';
  const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
    redirectTo: nativeAuthRedirectUrl('login.html')
  });
  loginError.textContent = error ? friendlyAuthError(error.message) : '';
  if (!error) alert(`${email} adresine bir şifre sıfırlama bağlantısı gönderdik.`);
});
