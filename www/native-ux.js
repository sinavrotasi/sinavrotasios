// ================= SınavRotası — Native (Capacitor) UX katmanı =================
// Bu dosya web'de (tarayıcıda) TAMAMEN ZARARSIZDIR: window.Capacitor yoksa veya
// ilgili plugin henüz projeye eklenmemişse her fonksiyon sessizce hiçbir şey yapmaz.
// Capacitor iskeleti kurulduğunda (bkz. Yol Haritası 1.Öncelik #7) ve aşağıdaki
// paketler npm ile kurulup `npx cap sync` çalıştırıldığında ek bir kod değişikliği
// GEREKMEDEN devreye girer:
//   @capacitor/core, @capacitor/app, @capacitor/haptics,
//   @capacitor/status-bar, @capacitor/splash-screen, @capacitor/keyboard,
//   @capacitor/local-notifications
// Bu proje bundler kullanmadığı için (bkz. Yol Haritası P1 #3) bu paketlerin
// kendi "dist/plugin.js" (UMD/IIFE) çıktısı, capacitor.config.json'daki webDir
// altına vendor/ olarak kopyalanıp <script> etiketiyle eklenmeli — her biri kendini
// otomatik olarak window.Capacitor.Plugins altına kaydeder (registerPlugin).
//
// index.html / login.html / signup.html tarafından app.js / login.js / signup.js'den
// ÖNCE yüklenir.

(function () {
  const Capacitor = window.Capacitor;
  const isNative = !!(Capacitor && typeof Capacitor.isNativePlatform === 'function' && Capacitor.isNativePlatform());
  const platform = isNative && typeof Capacitor.getPlatform === 'function' ? Capacitor.getPlatform() : 'web';
  const Plugins = (Capacitor && Capacitor.Plugins) || {};

  // Bir plugin metodunu güvenle çağırır: plugin ya da metod yoksa (henüz kurulmamış
  // native build, web ortamı, vs.) sessizce null döner — hiçbir yerde çökme olmaz.
  function safeCall(pluginName, method, args) {
    try {
      const target = Plugins[pluginName];
      if (!target || typeof target[method] !== 'function') return null;
      return target[method](args);
    } catch (err) {
      console.warn(`[NativeUX] ${pluginName}.${method} başarısız:`, err);
      return null;
    }
  }

  // ---- HAPTİK GERİ BİLDİRİM ----
  // app.js'teki mevcut haptic(duration) çağrılarıyla birebir uyumlu:
  //  - tek sayı (ör. 14, 18)  → hafif/orta native "impact" (genel dokunma tepkisi)
  //  - dizi (ör. [12,40,12], şu an sadece yanlış cevapta kullanılıyor) → belirgin
  //    native "hata" bildirimi (iOS'ta Taptic Engine'in gerçek buzz-buzz paterni)
  // navigator.vibrate() iOS'ta hiç çalışmıyor ve Android'de tarayıcıya göre
  // tutarsız; native Haptics eklentisi ikisinde de düzgün çalışır.
  function haptic(duration) {
    if (!Plugins.Haptics) return;
    if (Array.isArray(duration)) {
      if (!safeCall('Haptics', 'notification', { type: 'ERROR' })) {
        safeCall('Haptics', 'impact', { style: 'HEAVY' });
      }
      return;
    }
    const style = Number(duration) >= 30 ? 'MEDIUM' : 'LIGHT';
    safeCall('Haptics', 'impact', { style });
  }

  // ---- DURUM ÇUBUĞU (Status Bar) ----
  // style: 'DARK' (koyu arkaplan → açık/beyaz ikonlar, ör. ana uygulama header'ı)
  //      | 'LIGHT' (açık arkaplan → koyu ikonlar, ör. giriş/kayıt ekranları)
  // Uygulama zaten env(safe-area-inset-top) ile kendi güvenli alan boşluğunu
  // ayarladığı için (style.css) durum çubuğu her zaman "overlay" (saydam,
  // içerik arkasında) modda tutulur — tasarımla birebir uyumlu.
  function initStatusBar(style) {
    // Capacitor 8+ / Android 15+ için yeni SystemBars API'si (@capacitor/core
    // içine dahil) önce denenir; yoksa eski @capacitor/status-bar eklentisine
    // düşülür. Hangisi kuruluysa o kullanılır, ikisi de yoksa sessizce atlanır.
    if (Plugins.SystemBars) {
      safeCall('SystemBars', 'setStyle', { style });
      return;
    }
    if (!Plugins.StatusBar) return;
    safeCall('StatusBar', 'setOverlaysWebView', { overlay: true });
    safeCall('StatusBar', 'setStyle', { style });
  }

  // ---- AÇILIŞ EKRANI (Splash Screen) ----
  let splashHidden = false;
  function hideSplash() {
    if (splashHidden) return;
    splashHidden = true;
    safeCall('SplashScreen', 'hide');
  }
  // Güvenlik ağı: bir hata/ağ sorunu yüzünden uygulama hideSplash()'ı hiç
  // çağıramazsa kullanıcı native açılış ekranında sonsuza kadar takılı kalmasın.
  setTimeout(hideSplash, 6000);

  // ---- KLAVYE ----
  function initKeyboard() {
    if (!Plugins.Keyboard) return;
    // setResizeMode yalnızca iOS'ta etkilidir; Android tarafında resize modu
    // capacitor.config.json > plugins.Keyboard.resize ile ayarlanmalı (önerilen: "none",
    // çünkü uygulama .phone kabını sabit ekrana göre, overflow:hidden ile
    // kuruyor — webview'in kendisinin küçülmesi mevcut layout'u bozar).
    safeCall('Keyboard', 'setResizeMode', { mode: 'none' });
    try {
      Plugins.Keyboard.addListener('keyboardWillShow', info => {
        document.body.classList.add('keyboard-open');
        document.documentElement.style.setProperty('--keyboard-height', `${(info && info.keyboardHeight) || 0}px`);
        const active = document.activeElement;
        const isSheetInput = active?.closest?.('.bottom-sheet, .topic-sheet, .quiz-nav-overlay');
        const isAuthPage = document.body.classList.contains('auth-page');
        const isManagedProfileForm = active?.closest?.('.profile-edit-page, .goal-settings-page');
        // Auth ve profil form ekranları kendi kaydırma davranışlarını yönetir.
        // Burada ikinci bir smooth scroll çalıştırmak özellikle iOS'ta focus
        // değişiminde kutuların zıplamasına / çift kaydırmaya neden olur.
        if (active && !isSheetInput && !isAuthPage && !isManagedProfileForm && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) {
          setTimeout(() => active.scrollIntoView({ block: 'center', behavior: 'smooth' }), 80);
        }
      });
      Plugins.Keyboard.addListener('keyboardWillHide', () => {
        document.body.classList.remove('keyboard-open');
        document.documentElement.style.setProperty('--keyboard-height', '0px');
        if (keyboardScrollUnlockTimer) {
          clearTimeout(keyboardScrollUnlockTimer);
          keyboardScrollUnlockTimer = null;
        }
        setKeyboardScrollDisabled(false);
      });
    } catch (err) {
      console.warn('[NativeUX] Keyboard listener kurulamadı:', err);
    }
  }

  function hideKeyboard() {
    // Web'de etkisiz; Android/iOS'ta görünür klavyeyi kapatır. Arama sheet'i
    // kapanırken input odağı da app.js tarafından kaldırılır.
    safeCall('Keyboard', 'hide');
  }

  // iOS'ta WKWebView, input focus değişiminde sayfayı otomatik kaydırabilir.
  // Capacitor Keyboard.setScroll ile bunu kısa süreliğine durdurup focus
  // animasyonu bittikten sonra tekrar açıyoruz; kullanıcı manuel kaydırmayı
  // normal şekilde kullanmaya devam eder.
  let keyboardScrollUnlockTimer = null;

  function setKeyboardScrollDisabled(isDisabled) {
    if (!Plugins.Keyboard) return;
    safeCall('Keyboard', 'setScroll', { isDisabled: Boolean(isDisabled) });
  }

  function freezeKeyboardScroll(durationMs) {
    const ms = Number.isFinite(Number(durationMs)) ? Number(durationMs) : 500;
    if (keyboardScrollUnlockTimer) clearTimeout(keyboardScrollUnlockTimer);
    setKeyboardScrollDisabled(true);
    keyboardScrollUnlockTimer = setTimeout(() => {
      keyboardScrollUnlockTimer = null;
      setKeyboardScrollDisabled(false);
    }, Math.max(120, ms));
  }

  // ---- UYGULAMA YAŞAM DÖNGÜSÜ + ANDROID GERİ TUŞU ----
  // Diğer dosyalarla (app.js) sıkı bağ kurmamak için burada sadece iki genel
  // DOM event'i yayınlanır: 'nativeux:pause' / 'nativeux:resume' ve
  // 'nativeux:backbutton'. app.js kendi ekran/sheet durumuna göre bu event'leri
  // dinler; 'nativeux:backbutton' için event.preventDefault() çağırırsa (yani
  // geri tuşunu uygulama içi bir kapanış/dönüş için kullandıysa) burada hiçbir
  // ek işlem yapılmaz. Hiçbir taraf tüketmezse (örn. ana ekrandayken) çift
  // basışla çıkış davranışı burada uygulanır — böylece kullanıcı yanlışlıkla
  // tek basışta uygulamadan atılmaz.
  let lastBackPressAt = 0;
  function defaultBackHandler() {
    const now = Date.now();
    if (now - lastBackPressAt < 2000) {
      safeCall('App', 'exitApp');
      return;
    }
    lastBackPressAt = now;
    if (typeof window.showToast === 'function') {
      window.showToast('Çıkmak için tekrar geri tuşuna bas');
    }
  }

  function initAppLifecycle() {
    if (!Plugins.App) return;
    try {
      Plugins.App.addListener('appStateChange', info => {
        document.dispatchEvent(new CustomEvent(info && info.isActive ? 'nativeux:resume' : 'nativeux:pause'));
      });
      Plugins.App.addListener('backButton', () => {
        const event = new CustomEvent('nativeux:backbutton', { cancelable: true });
        document.dispatchEvent(event);
        if (!event.defaultPrevented) defaultBackHandler();
      });
      // Uygulama sinavrotasi://auth-callback... gibi bir deep link ile açıldığında
      // (OAuth dönüşü, e-posta doğrulama, şifre sıfırlama) tetiklenir. Soğuk
      // başlangıçta da (uygulama kapalıyken link'e tıklanırsa) Capacitor bu event'i
      // ilk yüklemede fırlatır. auth-common.js bu event'i dinleyip token'ları işler.
      Plugins.App.addListener('appUrlOpen', data => {
        const url = data && data.url;
        if (!url) return;
        document.dispatchEvent(new CustomEvent('nativeux:url', { detail: { url } }));
      });
    } catch (err) {
      console.warn('[NativeUX] App listener kurulamadı:', err);
    }
  }

  // ---- YEREL BİLDİRİMLER (Local Notifications) ----
  // @capacitor/local-notifications projeye eklenip vendor/ altına kopyalanana
  // kadar (Plugins.LocalNotifications yok) scheduleStudyReminders sessizce
  // no-op'tur — app.js her koşulda güvenle çağırabilir, hiçbir yerde çökme
  // olmaz. Diğer plugin sarmalayıcılarından farklı olarak burada safeCall
  // kullanılmıyor: izin isteme akışı gerçek async/await ve kendi try/catch'i
  // gerektiriyor (safeCall senkron hatalar için tasarlandı, reddedilen
  // promise'leri yakalamaz).
  //
  // İçerik (progress.notificationPrefs, sınav tarihi, bekleyen kart sayısı)
  // bilerek burada TUTULMUYOR — dosyanın başındaki "app.js ile sıkı bağ
  // kurmama" prensibi gereği, her çağrıda parametre olarak alınır.
  const NOTIF_IDS = { dailyReminder: 1001, streakWarning: 1002, srsDue: 1003 };
  const EXAM_COUNTDOWN_DAYS = [30, 14, 7, 3, 1]; // id 2001-2005
  let permissionDeniedOnce = false;

  async function ensureNotificationPermission() {
    if (!Plugins.LocalNotifications) return false;
    try {
      const current = await Plugins.LocalNotifications.checkPermissions();
      if (current && current.display === 'granted') return true;
      if (permissionDeniedOnce) return false; // kullanıcı reddettiyse her senkronizasyonda tekrar sormuyoruz
      const requested = await Plugins.LocalNotifications.requestPermissions();
      const granted = !!(requested && requested.display === 'granted');
      if (!granted) permissionDeniedOnce = true;
      return granted;
    } catch (err) {
      console.warn('[NativeUX] Bildirim izni alınamadı:', err);
      return false;
    }
  }

  function parseTimeParts(hhmm) {
    const parts = String(hhmm || '20:00').split(':').map(Number);
    const hour = Number.isFinite(parts[0]) ? parts[0] : 20;
    const minute = Number.isFinite(parts[1]) ? parts[1] : 0;
    return { hour, minute };
  }

  // Bugünün ya da (saat geçtiyse) yarının verilen saatteki karşılığı —
  // tek seferlik ("at") bildirimler için kullanılır (ör. tekrar hatırlatıcısı).
  function nextOccurrenceAt(hour, minute) {
    const now = new Date();
    const next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute, 0, 0);
    if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
    return next;
  }

  // prefs: progress.notificationPrefs (dailyReminder/streakWarning/srsDue/
  //        examCountdown/reminderTime)
  // context: { examDate: 'YYYY-MM-DD' | null, dueFlashcards: number }
  async function scheduleStudyReminders(prefs, context) {
    if (!Plugins.LocalNotifications || !prefs) return;
    const granted = await ensureNotificationPermission();
    if (!granted) return;
    const ctx = context || {};

    try {
      // Önce ilgili tüm id'leri iptal edip sıfırdan kuruyoruz — bir tercih
      // kapatıldığında veya saat değiştirildiğinde eski planlama kalmasın.
      const allIds = Object.values(NOTIF_IDS).concat(EXAM_COUNTDOWN_DAYS.map((_, i) => 2001 + i));
      await Plugins.LocalNotifications.cancel({ notifications: allIds.map(id => ({ id })) });

      const notifications = [];

      if (prefs.dailyReminder) {
        const { hour, minute } = parseTimeParts(prefs.reminderTime);
        notifications.push({
          id: NOTIF_IDS.dailyReminder,
          title: 'SınavRotası',
          body: 'Bugünkü rotanı tamamlamayı unutma.',
          schedule: { on: { hour, minute }, repeats: true }
        });
      }

      if (prefs.streakWarning) {
        // Sabit saat (21:00) — gün henüz bitmeden son bir hatırlatma.
        notifications.push({
          id: NOTIF_IDS.streakWarning,
          title: 'SınavRotası',
          body: 'Serini bozma! Bugün henüz çalışmadıysan son şansın.',
          schedule: { on: { hour: 21, minute: 0 }, repeats: true }
        });
      }

      if (prefs.srsDue && Number(ctx.dueFlashcards) > 0) {
        // Sunucu push'u yok; tek seferlik planlanır ve app.js her due-count
        // yenilendiğinde (bkz. refreshDueFlashcardCount) syncLocalNotificationSchedule
        // ile burayı tekrar çağırıp güncel sayıyla yeniden kurar.
        notifications.push({
          id: NOTIF_IDS.srsDue,
          title: 'SınavRotası',
          body: `Bugün ${ctx.dueFlashcards} kart tekrar seni bekliyor.`,
          schedule: { at: nextOccurrenceAt(10, 0), repeats: false }
        });
      }

      if (prefs.examCountdown && ctx.examDate) {
        const examDate = new Date(`${ctx.examDate}T09:00:00`);
        EXAM_COUNTDOWN_DAYS.forEach((daysBefore, i) => {
          const fireDate = new Date(examDate);
          fireDate.setDate(fireDate.getDate() - daysBefore);
          if (fireDate.getTime() <= Date.now()) return; // geçmişte kalan kilometre taşını atla
          notifications.push({
            id: 2001 + i,
            title: 'SınavRotası',
            body: `Sınava ${daysBefore} gün kaldı!`,
            schedule: { at: fireDate }
          });
        });
      }

      if (notifications.length) {
        await Plugins.LocalNotifications.schedule({ notifications });
      }
    } catch (err) {
      console.warn('[NativeUX] Bildirimler planlanamadı:', err);
    }
  }

  function init(options) {
    const opts = options || {};
    initStatusBar(opts.statusBarStyle || 'DARK');
    initKeyboard();
    initAppLifecycle();
  }

  window.NativeUX = {
    isNative,
    platform,
    init,
    haptic,
    hideSplash,
    hideKeyboard,
    setKeyboardScrollDisabled,
    freezeKeyboardScroll,
    scheduleStudyReminders
  };
})();
