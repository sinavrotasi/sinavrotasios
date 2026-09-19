// ================= SınavRotası — Uygulama erişim koruması =================
// index.html'de app.js'den ÖNCE yüklenir. Oturum yoksa login.html'e yönlendirir;
// oturum varsa app.js'in beklediği 'sinavrotasi:authenticated' event'ini tetikler.
//
// 2026-09-15 revizyonu:
//  * Y-01: Çevrimdışı açılışta oturum artık kapatılmıyor. getUser() yalnızca
//    sunucu oturumun GEÇERSİZ olduğunu açıkça söylerse (400/401/403/404)
//    yerel oturum temizlenir. Ağ hatalarında kayıtlı oturumla devam edilir.
//  * Y-01: INITIAL_SESSION olayı artık doğrulamadan önce uygulamayı başlatmıyor;
//    başlatma tek noktadan (bootstrap) yapılıyor.
//  * O-08: Kadro okunamazsa son bilinen kadro (yerel önbellek) kullanılıyor;
//    o da yoksa window.currentUserRoleError = true ile app.js'e bildiriliyor
//    (kadro kapısı yanlışlıkla açılmıyor).
//  * R-02: Deep link ile soğuk açılışta, auth callback'i işlenirken login'e
//    erken yönlendirme yapılmıyor.
//  * Y-01 (cihaz testi sonrası): Cihaz çevrimdışıysa (navigator.onLine=false)
//    ağ denemeleri hiç beklenmeden kayıtlı oturum ve son bilinen kadroyla
//    anında başlanıyor. Önceden supabase-js'in token yenileme (~30 sn) ve
//    istek yeniden deneme (~7 sn) beklemeleri yüzünden açılış çok gecikiyordu.
//    Bağlantı geri gelince profil bilgileri arka planda yenileniyor.

const PROFILE_CACHE_PREFIX = 'sr_profile_cache_v1:';
const AUTH_STORAGE_KEY = `sb-${new URL(SUPABASE_URL).hostname.split('.')[0]}-auth-token`;

let appStarted = false;
let redirectingToLogin = false;
let bootstrapFinished = false;

function goToLogin() {
  if (redirectingToLogin) return;
  redirectingToLogin = true;
  window.location.href = 'login.html';
}

function readCachedRole(userId) {
  try {
    const raw = localStorage.getItem(PROFILE_CACHE_PREFIX + userId);
    const parsed = raw ? JSON.parse(raw) : null;
    return typeof parsed?.role === 'string' ? parsed.role : null;
  } catch (_) {
    return null;
  }
}

function writeCachedRole(userId, role) {
  try {
    if (role) localStorage.setItem(PROFILE_CACHE_PREFIX + userId, JSON.stringify({ role }));
  } catch (_) { /* depolama yoksa önemsiz */ }
}

// Sunucu oturumun geçersiz olduğunu açıkça bildirdi mi?
// (Ağ hataları, zaman aşımları ve 5xx yanıtları "geçersiz" sayılmaz.)
function isInvalidSessionError(error) {
  if (!error) return false;
  if (error.name === 'AuthSessionMissingError') return true;
  const status = Number(error.status);
  return error.name === 'AuthApiError' && [400, 401, 403, 404].includes(status);
}

// Access token'ın süresi dolmuşken çevrimdışı açılışta getSession() yenileme
// yapamayıp null dönebilir. Bu durumda kayıtlı oturumu doğrudan okuyup
// kullanıcıyı çevrimdışı modda tutarız; ağ gelince supabase-js token'ı yeniler.
function readStoredSession() {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    const session = parsed?.currentSession || parsed;
    return session?.user?.id && session?.refresh_token ? session : null;
  } catch (_) {
    return null;
  }
}

async function waitForAuthCallback() {
  const isNative = !!(window.NativeUX && window.NativeUX.isNative);
  const hasWebCallback = /[?&#](code|access_token)=/.test(window.location.href);
  if (!isNative && !hasWebCallback) return null;
  const deadline = Date.now() + (isNative ? 1200 : 3000);
  while (Date.now() < deadline) {
    if (window.srAuthCallbackPending) {
      try { await window.srAuthCallbackPending; } catch (_) { /* hata auth-common'da gösterildi */ }
      break;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const { data } = await supabaseClient.auth.getSession();
  return data?.session || null;
}

function isDeviceOffline() {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

// Çevrimdışı başlatılan oturumda bağlantı geri gelince rol ve premium
// bilgisini sessizce yeniler; app.js 'sinavrotasi:profile-refreshed' olayını
// dinleyip ekranı günceller.
async function refreshProfileAfterReconnect(user) {
  try {
    const [{ data, error }, { data: premiumData, error: premiumError }] = await Promise.all([
      supabaseClient.from('profiles').select('role').eq('id', user.id).maybeSingle(),
      supabaseClient.rpc('is_premium')
    ]);
    if (!error) {
      window.currentUserRole = data?.role || null;
      window.currentUserRoleError = false;
      writeCachedRole(user.id, window.currentUserRole);
    }
    if (!premiumError) window.currentUserIsPremium = Boolean(premiumData);
    window.currentUserOffline = false;
    document.dispatchEvent(new CustomEvent('sinavrotasi:profile-refreshed', { detail: { user } }));
  } catch (error) {
    console.warn('Bağlantı sonrası profil yenilenemedi:', error);
  }
}

function startApp(session, { offline = false } = {}) {
  if (appStarted) return;
  appStarted = true;
  const user = session.user;
  const fullName = user.user_metadata?.full_name || (user.email ? user.email.split('@')[0] : 'Aday');
  const firstName = fullName.split(' ')[0];
  const firstNameEl = document.getElementById('userFirstName');
  if (firstNameEl) firstNameEl.textContent = firstName;
  window.currentUser = user;
  window.currentUserOffline = offline;

  const finish = (role, roleError, isPremium) => {
    window.currentUserRole = role;
    window.currentUserRoleError = roleError;
    // null = bilinmiyor (app.js bunu "premium değil" ile karıştırmaz).
    window.currentUserIsPremium = isPremium;
    window.currentUserAuthReady = true;
    document.dispatchEvent(new CustomEvent('sinavrotasi:authenticated', { detail: { user } }));
  };

  if (offline && isDeviceOffline()) {
    // Ağ yok: istekleri hiç denemeden son bilinen kadroyla hemen başla.
    const cached = readCachedRole(user.id);
    window.addEventListener('online', () => refreshProfileAfterReconnect(user), { once: true });
    finish(cached, !cached, null);
    return;
  }

  Promise.all([
    supabaseClient.from('profiles').select('role').eq('id', user.id).maybeSingle(),
    supabaseClient.rpc('is_premium')
  ]).then(([{ data, error }, { data: premiumData, error: premiumError }]) => {
    let role = data?.role || null;
    let roleError = false;
    if (error) {
      console.warn('Profil rolü okunamadı, önbellek kullanılıyor:', error.message || error);
      role = readCachedRole(user.id);
      roleError = !role;
    } else {
      writeCachedRole(user.id, role);
    }
    if (premiumError) console.warn('Premium durumu okunamadı:', premiumError.message || premiumError);
    finish(role, roleError, premiumError ? null : Boolean(premiumData));
  }).catch(error => {
    console.warn('Profil bilgileri alınamadı:', error);
    const cached = readCachedRole(user.id);
    finish(cached, !cached, null);
  });
}

window.signOut = async function signOut() {
  try {
    await supabaseClient.auth.signOut();
  } finally {
    goToLogin();
  }
};

supabaseClient.auth.onAuthStateChange((event, session) => {
  if (event === 'SIGNED_OUT') {
    // Ağ hatasında oturum depoda kalır; yalnızca gerçekten silindiyse çık.
    if (appStarted && !readStoredSession()) goToLogin();
    return;
  }
  // Soğuk açılışta deep link ile oluşan oturum (bootstrap zaten bekliyor
  // olabilir; startApp tekrar çağrılmaya karşı korumalı).
  if (event === 'SIGNED_IN' && session && !appStarted && bootstrapFinished) {
    startApp(session);
  }
});

(async function bootstrap() {
  // Cihaz çevrimdışı ve kayıtlı oturum var: supabase-js'in ağ denemelerini
  // (token yenileme, kullanıcı doğrulama) beklemeden hemen başla.
  if (isDeviceOffline()) {
    const stored = readStoredSession();
    if (stored) {
      bootstrapFinished = true;
      startApp(stored, { offline: true });
      return;
    }
  }

  let session = null;
  let sessionError = null;
  try {
    const result = await supabaseClient.auth.getSession();
    session = result.data?.session || null;
    sessionError = result.error || null;
  } catch (error) {
    sessionError = error;
  }

  if (!session && sessionError && !isInvalidSessionError(sessionError)) {
    // Çevrimdışı + süresi dolmuş access token: kayıtlı oturumla devam et.
    const stored = readStoredSession();
    if (stored) {
      bootstrapFinished = true;
      startApp(stored, { offline: true });
      return;
    }
  }

  if (!session) {
    session = await waitForAuthCallback();
  }
  if (!session) {
    // Supabase, geçersiz oturumu depodan siler; ağ hatasında ise siler ama
    // getSession() null dönebilir. Depoda hâlâ yenileme anahtarlı bir oturum
    // varsa kullanıcı çıkış yapmamıştır: çevrimdışı modda devam et.
    const stored = readStoredSession();
    if (stored && (sessionError || navigator.onLine === false)) {
      bootstrapFinished = true;
      startApp(stored, { offline: true });
      return;
    }
  }
  bootstrapFinished = true;
  if (!session) {
    goToLogin();
    return;
  }

  // Oturum var; kullanıcı sunucuda hâlâ geçerli mi? Yalnızca açık bir
  // "geçersiz" yanıtında çıkış yapılır.
  let offline = false;
  try {
    const { data: userData, error } = await supabaseClient.auth.getUser();
    if (error) {
      if (isInvalidSessionError(error)) {
        await supabaseClient.auth.signOut({ scope: 'local' });
        goToLogin();
        return;
      }
      offline = true;
      console.warn('Kullanıcı doğrulanamadı (ağ), çevrimdışı devam ediliyor:', error.message || error);
    } else if (!userData?.user) {
      await supabaseClient.auth.signOut({ scope: 'local' });
      goToLogin();
      return;
    }
  } catch (error) {
    offline = true;
    console.warn('Kullanıcı doğrulaması başarısız, çevrimdışı devam ediliyor:', error);
  }
  startApp(session, { offline });
})();

// NOT: SUPABASE_URL, SUPABASE_ANON_KEY ve supabaseClient burada TEKRAR tanımlanmıyor —
// bunlar supabaseClient.js dosyasında tanımlı ve bu dosyadan ÖNCE yükleniyor.
