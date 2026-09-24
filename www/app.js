const STORAGE_KEY = 'sinavrotasi-study-progress-v2';
const EXAM_KINDS = ['mock', 'kadro-exam', 'mini-exam', 'mixed-exam'];
// NOT (2026-09-05): "Gerçek Sınav Formatı" (kadro-exam) da tıpkı Rastgele
// Test gibi gerçek bir sınav ortamını taklit etmeli — cevap verirken anında
// doğru/yanlış rengi göstermemeli, sadece sınav bitince toplu açılmalı.
// Eskiden bu davranış (deferReveal) sadece 'random' için vardı; 'kadro-exam'
// anında renk gösteriyordu, bu da "Gerçek Sınav Formatı" adıyla çelişiyordu.
const DEFERRED_REVEAL_KINDS = ['random', 'kadro-exam', 'mini-exam', 'mixed-exam', 'section'];
const DEFAULT_DAILY_GOAL = 20;
const DAILY_GOAL_MIN = 1;
const DAILY_GOAL_MAX = 500;
const QUESTION_TIME_LIMIT = 60;
const PROGRESS_DEVICE_ID_STORAGE_KEY = 'sinavrotasi-progress-device-id-v1';

// ---- Zamanlama sabitleri (önceden dosya içinde dağınık "magic number" olarak vardı) ----
const TOAST_DURATION_MS = 2400;          // Toast bildiriminin ekranda kalma süresi
const CLOUD_SYNC_DEBOUNCE_MS = 1500;     // Progress değişikliğinden sonra Supabase'e yazana kadar bekleme (debounce)
const SEARCH_FOCUS_DELAY_MS = 300;       // Arama input'una modal açıldıktan sonra odaklanma gecikmesi

const ROLES = [
  { key: 'memur', label: 'Memur' },
  { key: 'sef', label: 'Şef' },
  { key: 'sayman', label: 'Sayman' },
  { key: 'sube-mudur', label: 'Şube Müdürü' }
];

// Profildeki "Rozetlerim" için — tamamen var olan istatistiklerden (seri,
// çözülen soru, tamamlanan deneme) hesaplanıyor, yeni bir veri alanı gerekmez.
const BADGE_DEFS = [
  // O-04 (2026-09-15): Seri rozetleri en uzun seriye bakar; bir gün
  // çalışılmadığında kazanılmış rozet kaybolmaz.
  { id: 'streak-3', image: 'images/rozet-seri-3.png', label: '3 Gün Seri', unit: 'gün', target: 3, value: s => s.longestStreak },
  { id: 'streak-7', image: 'images/rozet-seri-7.png', label: '7 Gün Seri', unit: 'gün', target: 7, value: s => s.longestStreak },
  { id: 'streak-30', image: 'images/rozet-seri-30.png', label: '30 Gün Seri', unit: 'gün', target: 30, value: s => s.longestStreak },
  // D-06 (2026-09-15): Bu rozetler toplam çözüm sayısını (tekrarlar dahil)
  // ölçer; etiket buna göre netleştirildi.
  { id: 'solved-100', image: 'images/rozet-soru-100.png', label: '100 Soru Çözümü', unit: 'çözüm', target: 100, value: s => s.solvedQuestions },
  { id: 'solved-500', image: 'images/rozet-soru-500.png', label: '500 Soru Çözümü', unit: 'çözüm', target: 500, value: s => s.solvedQuestions },
  { id: 'solved-1000', image: 'images/rozet-soru-1000.png', label: '1000 Soru Çözümü', unit: 'çözüm', target: 1000, value: s => s.solvedQuestions },
  { id: 'exam-1', image: 'images/rozet-deneme-1.png', label: 'İlk Deneme', unit: 'deneme', target: 1, value: s => s.completedMocks },
  { id: 'exam-5', image: 'images/rozet-deneme-5.png', label: '5 Deneme', unit: 'deneme', target: 5, value: s => s.completedMocks }
];

function getBadges(stats) {
  return BADGE_DEFS.map(def => {
    const value = Math.min(def.target, def.value(stats));
    return { ...def, value, unlocked: value >= def.target };
  });
}

const ROLE_ICONS = { memur: 'idcard', sef: 'clipboard', sayman: 'calculator', 'sube-mudur': 'landmark' };

// --- BİLGİ KARTLARI KATALOĞU ---
const CARD_CATEGORY_ORDER = ['general-legislation', 'meb-legislation', 'general-culture'];

// Kart kataloğu artık statik değil — state.catalogue'dan (Supabase) dinamik üretilir.
// getCardCatalogue() her zaman güncel veriyi döndürür.
function getCardCatalogue() {
  if (!state.catalogue) return {};
  const result = {};
  CARD_CATEGORY_ORDER.forEach(key => {
    const cat = state.catalogue[key];
    if (!cat) return;
    const meta = categoryCardMeta(key);
    // Standart: TÜM kart kaynakları (flashcard destesi ya da soru bankasından
    // türetilen) Genel Mevzuat'takiyle aynı "ilk 5 kart ücretsiz, sonrası
    // premium" davranışını izler. quiz-derived kartlar artık
    // get_topic_card_preview RPC'siyle çekiliyor (bkz. content-repo.js) —
    // bu RPC sunucu tarafında zaten free kullanıcıya 5 satırla sınırlıyor,
    // bu yüzden burada "free: false" ile önden tamamen kapatmaya gerek yok.
    const role = progress.selectedRole;
    const flashcardDecks = (state.flashcardDecks || [])
      .filter(d => d.categoryId === key && (!role || !d.kadrolar || d.kadrolar.includes(role)))
      .map(d => ({ id: d.id, title: d.title, cardFile: d.cardFile, free: true }));
    // Aynı başlık için flashcard destesi zaten varsa quiz-derived kopyasını
    // eklemiyoruz — aksi halde aynı konu listede iki kez görünüyordu.
    const normalizeTitle = (title) => (title || '').trim().toLocaleLowerCase('tr-TR');
    const flashcardTitles = new Set(flashcardDecks.map(d => normalizeTitle(d.title)));
    const quizDerived = (cat.topics || [])
      .filter(t => (t.questionCount || 0) > 0 && !flashcardTitles.has(normalizeTitle(t.title)) && (!role || !t.kadrolar || t.kadrolar.includes(role)))
      .map(t => ({ id: t.id, title: t.title, topicId: t.id, free: true }));
    result[key] = {
      title: cat.title,
      description: cat.subtitle || meta.description,
      icon: meta.icon,
      iconClass: meta.iconClass,
      documents: [...flashcardDecks, ...quizDerived]
    };
  });
  return result;
}

const cardDecks = new Map();

const state = {
  view: 'home',
  catalogue: null,
  catalogueError: '',
  flashcardDecks: null,
  activeCategoryKey: null,
  activeDocument: null,
  navStack: [],
  questionBanks: new Map(),
  quiz: null,
  cardStudy: null,
  expandedMistakeGroup: null,
  totalDueFlashcards: 0,
  dueFlashcardsCache: null,
  dueFlashcardsPromise: null,
  weeklyFlowRange: 'week',
  weeklyFlowNote: '',
  totalQuestionCount: 0,
  sharedExamDate: null
};

// Rota Ayarları State'i
const routeSettings = {
  mode: 'Sana Özel Karma',
  questions: 20,
  time: 'Süreli'
};

// Native (Capacitor) katmanı — ana uygulama koyu header'a sahip olduğu için
// durum çubuğu açık/beyaz ikonlarla başlatılır. Web'de tamamen etkisizdir.
window.NativeUX?.init({ statusBarStyle: 'DARK' });

const app = document.getElementById('app');
const scrollArea = document.getElementById('scroll-area');
const toast = document.getElementById('toast');
const navButtons = [...document.querySelectorAll('[data-nav]')];

// Konu Paneli (Topic Sheet) Elementleri
const topicSheet = document.getElementById('topicSheet');
const topicBackdrop = document.getElementById('topicBackdrop');
const closeTopicSheetButton = document.getElementById('closeTopicSheet');
const topicSheetTitle = document.getElementById('topicSheetTitle');
const topicSheetSubtitle = document.getElementById('topicSheetSubtitle');
const topicEyebrow = document.getElementById('topicEyebrow');
const topicHeadingIcon = document.getElementById('topicHeadingIcon');
const topicList = document.getElementById('topicList');
const topicProgressText = document.getElementById('topicProgressText');
const topicProgressBar = document.getElementById('topicProgressBar');
const topicBreadcrumbWrap = document.getElementById('topicBreadcrumbWrap');

// Rota Paneli (Route Sheet) Elementleri
const routeSheet = document.getElementById('routeSheet');
const closeRouteSheetButton = document.getElementById('closeRouteSheet');
const startRouteButton = document.getElementById('startRouteButton');
const summaryMode = document.getElementById('summaryMode');
const summaryDuration = document.getElementById('summaryDuration');

// Arama Paneli Elementleri
const openSearchButton = document.getElementById('openSearchButton');
const searchSheet = document.getElementById('searchSheet');
const closeSearchSheetButton = document.getElementById('closeSearchSheet');
const searchInput = document.getElementById('searchInput');
const searchResultsList = document.getElementById('searchResultsList');

let timerInterval = null;
let searchFocusTimer = null;
let searchScrollTop = null;
// loadProgress() (hemen aşağıda) defaultProgress()'i çağırıyor, o da bu sabiti
// kullanıyor — bu yüzden burada, herhangi bir progress kodu çalışmadan ÖNCE
// tanımlanmalı. Daha önce bu sabit defaultProgress()'in hemen üstünde
// (dosyanın çok altında) tanımlıydı; loadProgress() en üstte senkron
// çağrıldığı için "Cannot access before initialization" hatasıyla TÜM
// app.js'in çökmesine (ve dolayısıyla ana ekranın boş kalmasına) neden
// oluyordu. Bkz. sohbet geçmişi — jsdom ile simüle edilip doğrulandı.
const DEFAULT_NOTIFICATION_PREFS = { dailyReminder: true, reminderTime: '20:00' };
if (!window.SRProgressSync) throw new Error('İlerleme senkronizasyon modülü yüklenemedi.');
let progress = loadProgress();

// NOT (2026-09-05): tüm ikonlar Lucide'ın resmi, güncel path verileriyle
// değiştirildi (lucide-icons/lucide reposundan doğrudan çekildi) — eskiden
// elle çizilmiş, tutarsız/amatör duran path'ler kullanılıyordu. Teknik
// (fill="none" stroke="currentColor", svg() fonksiyonu) aynı kaldı, sadece
// path verisi değişti — yeni bağımlılık/ağ isteği yok.
const iconPaths = {
  alertX: '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>',
  scale: '<path d="M12 3v18"/><path d="m19 8 3 8a5 5 0 0 1-6 0zV7"/><path d="M3 7h1a17 17 0 0 0 8-2 17 17 0 0 0 8 2h1"/><path d="m5 8 3 8a5 5 0 0 1-6 0zV7"/><path d="M7 21h10"/>',
  landmark: '<path d="M10 18v-7"/><path d="M11.119 2.205a2 2 0 0 1 1.762 0l7.84 3.846A.5.5 0 0 1 20.5 7h-17a.5.5 0 0 1-.22-.949z"/><path d="M14 18v-7"/><path d="M18 18v-7"/><path d="M3 22h18"/><path d="M6 18v-7"/>',
  schoolbook: '<path d="M12 5v16"/><path d="M20.001 19A2 2 0 0 0 22 17V5a2 2 0 0 0-1.999-2L16 3.002A5 5 0 0 0 12 5a5 5 0 0 0-4-2H4a2 2 0 0 0-2 2v12a2 2 0 0 0 1.999 2H8a5 5 0 0 1 4 2 5 5 0 0 1 4-2z"/>',
  gavel: '<path d="m14 13-8.381 8.38a1 1 0 0 1-3.001-3l8.384-8.381"/><path d="m16 16 6-6"/><path d="m21.5 10.5-8-8"/><path d="m8 8 6-6"/><path d="m8.5 7.5 8 8"/>',
  arrow: '<path d="m9 18 6-6-6-6"/>',
  back: '<path d="m15 18-6-6 6-6"/>',
  bookmark: '<path d="M17 3a2 2 0 0 1 2 2v15a1 1 0 0 1-1.496.868l-4.512-2.578a2 2 0 0 0-1.984 0l-4.512 2.578A1 1 0 0 1 5 20V5a2 2 0 0 1 2-2z"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  arrowRight: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
  arrowLeft: '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
  target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
  compass: '<path d="m16.24 7.76-1.804 5.411a2 2 0 0 1-1.265 1.265L7.76 16.24l1.804-5.411a2 2 0 0 1 1.265-1.265z"/><circle cx="12" cy="12" r="10"/>',
  book: '<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20"/>',
  trophy: '<path d="M10 14.66V17a1 1 0 0 1-1 1 2 2 0 0 0-2 2v2"/><path d="M14 14.66V17a1 1 0 0 0 1 1 2 2 0 0 1 2 2v2"/><path d="M17.916 10H19.5A2.5 2.5 0 0 0 22 7.5V5a1 1 0 0 0-1-1h-3"/><path d="M4 22h16"/><path d="M6 9a6 6 0 0 0 12 0V3a1 1 0 0 0-1-1H7a1 1 0 0 0-1 1z"/><path d="M6.084 10H4.5A2.5 2.5 0 0 1 2 7.5V5a1 1 0 0 1 1-1h3"/>',
  flame: '<path d="M12 3q1 4 4 6.5t3 5.5a1 1 0 0 1-14 0 5 5 0 0 1 1-3 1 1 0 0 0 5 0c0-2-1.5-3-1.5-5q0-2 2.5-4"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  chart: '<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="m19 9-5 5-4-4-3 3"/>',
  refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
  lock: '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  statTopics: '<path d="M21 10.656V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h12.344"/><path d="m9 11 3 3L22 4"/>',
  statQuestions: '<path d="M21.801 10A10 10 0 1 1 17 3.335"/><path d="m9 11 3 3L22 4"/>',
  statTrials: '<path d="M7.21 15 2.66 7.14a2 2 0 0 1 .13-2.2L4.4 2.8A2 2 0 0 1 6 2h12a2 2 0 0 1 1.6.8l1.6 2.14a2 2 0 0 1 .14 2.2L16.79 15"/><path d="M11 12 5.12 2.2"/><path d="m13 12 5.88-9.8"/><path d="M8 7h8"/><circle cx="12" cy="17" r="5"/><path d="M12 18v-2h-.5"/>',
  idcard: '<path d="M16 10h2"/><path d="M16 14h2"/><path d="M6.17 15a3 3 0 0 1 5.66 0"/><circle cx="9" cy="11" r="2"/><rect x="2" y="5" width="20" height="14" rx="2"/>',
  clipboard: '<rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="m9 14 2 2 4-4"/>',
  calculator: '<rect width="16" height="20" x="4" y="2" rx="2"/><line x1="8" x2="16" y1="6" y2="6"/><line x1="16" x2="16" y1="14" y2="18"/><path d="M16 10h.01"/><path d="M12 10h.01"/><path d="M8 10h.01"/><path d="M12 14h.01"/><path d="M8 14h.01"/><path d="M12 18h.01"/><path d="M8 18h.01"/>',
  squareCheck: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="m16 9-5.5 5.5L8 12"/>',
  circleCheckBig: '<path d="M21.801 10A10 10 0 1 1 17 3.335"/><path d="m9 11 3 3L22 4"/>',
  award: '<path d="m15.477 12.89 1.515 8.526a.5.5 0 0 1-.81.47l-3.58-2.687a1 1 0 0 0-1.197 0l-3.586 2.686a.5.5 0 0 1-.81-.469l1.514-8.526"/><circle cx="12" cy="8" r="6"/>',
  calendar: '<path d="M8 2v3"/><path d="M16 2v3"/><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/>',
  zap: '<path d="M4 14a1 1 0 0 1-.78-1.63l9-11a.5.5 0 0 1 .87.45l-1.69 6.2A1 1 0 0 0 12.36 9H20a1 1 0 0 1 .78 1.63l-9 11a.5.5 0 0 1-.87-.45l1.69-6.2A1 1 0 0 0 11.64 14z"/>',
  shuffle: '<path d="m18 14 4 4-4 4"/><path d="m18 2 4 4-4 4"/><path d="M2 18h1.5c2.5 0 4.5-2 6-5l1-2c1.5-3 3.5-5 6-5H22"/><path d="M2 6h1.5c2.5 0 4.5 2 6 5l1 2c1.5 3 3.5 5 6 5H22"/>',
  briefcase: '<path d="M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/><rect width="20" height="14" x="2" y="6" rx="2"/><path d="M2 12h20"/><path d="M10 12v2h4v-2"/>',
  flashcards: '<rect x="6" y="5" width="13" height="15" rx="2.5"/><path d="M9 5V3.5A1.5 1.5 0 0 1 10.5 2H19a3 3 0 0 1 3 3v11a2 2 0 0 1-2 2h-1"/><path d="M9.5 10h6"/><path d="M9.5 14h4"/>',
};

function svg(name, className = 'ui-icon') {
  return `<svg class="${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${iconPaths[name] || ''}</svg>`;
}

function escapeHtml(value = '') {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  window.clearTimeout(showToast.timeout);
  showToast.timeout = window.setTimeout(() => toast.classList.remove('show'), TOAST_DURATION_MS);
}

// NOT (2026-09-04): Yapay zeka ile CANLI açıklama özelliği kaldırılmıştı
// (maliyet/gizlilik denetimi sonrası). Ama sorular tablosundaki `explanation`
// sütunu zaten önceden yazılmış, statik metin taşıyor (LLM çağrısı yok,
// kullanıcı verisi hiçbir yere gitmiyor) — content-repo.js artık bunu
// istemciye taşıyor (mapQuestionRow). Doluysa <details> ile göster;
// boşsa (bazı sorularda hâlâ yok) hiçbir şey eklenmez.
function mistakeItemHTML(question, idx) {
  const explanationHtml = question.explanation
    ? `<details class="mistake-explanation"><summary>Neden?</summary><p>${escapeHtml(question.explanation)}</p></details>`
    : '';
  return `<article class="quiz-result-item" data-explain-item="${idx}">
    <p>${escapeHtml(question.prompt)}</p>
    <small>Doğru cevap: ${escapeHtml(question.options[question.answerIndex])}</small>
    ${explanationHtml}
  </article>`;
}

function haptic(duration = 18) {
  if (window.NativeUX && window.NativeUX.isNative) {
    window.NativeUX.haptic(duration);
    return;
  }
  if ('vibrate' in navigator) navigator.vibrate(duration);
}

function defaultProgress() {
  return { userId: null, answers: 0, correctAnswers: 0, dailyAnswers: {}, counterShards: {}, completedSections: {}, completedTests: [], flaggedQuestions: {}, reportedQuestions: {}, selectedRole: null, purchasedRoles: [], wrongQuestions: {}, dailyGoal: DEFAULT_DAILY_GOAL, docStats: {}, lastActivity: null, notificationPrefs: { ...DEFAULT_NOTIFICATION_PREFS }, resetAt: 0, mapClocks: {}, fieldClocks: {}, seenBitmap: '' };
}

function sanitizeProgress(saved, fallbackUserId = null) {
  if (!saved || typeof saved !== 'object') return defaultProgress();
  const parsedGoal = Number(saved.dailyGoal);
  const safeGoal = Number.isFinite(parsedGoal) && parsedGoal >= DAILY_GOAL_MIN && parsedGoal <= DAILY_GOAL_MAX ? Math.round(parsedGoal) : DEFAULT_DAILY_GOAL;
  const sanitized = {
    ...defaultProgress(), ...saved,
    userId: saved.userId || fallbackUserId || null,
    dailyAnswers: saved.dailyAnswers || {},
    counterShards: (saved.counterShards && typeof saved.counterShards === 'object') ? saved.counterShards : {},
    completedSections: saved.completedSections || {},
    completedTests: Array.isArray(saved.completedTests) ? saved.completedTests : [],
    flaggedQuestions: saved.flaggedQuestions || {},
    reportedQuestions: saved.reportedQuestions || {},
    purchasedRoles: Array.isArray(saved.purchasedRoles) ? saved.purchasedRoles : [],
    wrongQuestions: saved.wrongQuestions || {},
    dailyGoal: safeGoal,
    docStats: (saved.docStats && typeof saved.docStats === 'object') ? saved.docStats : {},
    lastActivity: (saved.lastActivity && typeof saved.lastActivity === 'object') ? saved.lastActivity : null,
    // Eski kayıtlarda notificationPrefs hiç yoktu; varsayılanlarla birleştirip
    // eksik anahtarları (ör. yeni eklenen bir hatırlatma türü) tamamlıyoruz.
    notificationPrefs: {
      dailyReminder: typeof saved.notificationPrefs?.dailyReminder === 'boolean'
        ? saved.notificationPrefs.dailyReminder
        : DEFAULT_NOTIFICATION_PREFS.dailyReminder,
      reminderTime: /^([01]\d|2[0-3]):[0-5]\d$/.test(saved.notificationPrefs?.reminderTime || '')
        ? saved.notificationPrefs.reminderTime
        : DEFAULT_NOTIFICATION_PREFS.reminderTime
    }
  };
  sanitized.seenBitmap = typeof saved.seenBitmap === 'string' ? saved.seenBitmap : '';
  window.SRProgressSync.ensureClocks(sanitized);
  // D-06: Görülen soru bit dizisi olmayan eski kayıtlar için bilinen soru
  // kimlikleriyle (yanlışlar + işaretliler) bir başlangıç değeri üretilir.
  if (!sanitized.seenBitmap && Number(sanitized.answers) > 0) {
    [...Object.keys(sanitized.wrongQuestions), ...Object.keys(sanitized.flaggedQuestions)]
      .forEach(id => window.SRProgressSync.markSeen(sanitized, id));
  }
  return window.SRProgressSync.normalizeProgressCounters(sanitized, fallbackUserId);
}

function loadProgress() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return sanitizeProgress(saved);
  } catch (error) {
    return defaultProgress();
  }
}

let cloudSyncTimer = null;
let cloudSyncInFlight = false;
let cloudSyncPending = false;
// M-04 düzeltmesi: sunucudan en son çekilen progress_version. Push sırasında
// bu değer WHERE koşuluna eklenir (optimistic lock) — araya başka bir cihaz
// yazmışsa update 0 satır etkiler, kör üzerine yazma yerine merge devreye girer.
let knownProgressVersion = 0;

function scheduleCloudSync() {
  if (!window.currentUser?.id) return;
  clearTimeout(cloudSyncTimer);
  cloudSyncTimer = window.setTimeout(pushProgressToCloud, CLOUD_SYNC_DEBOUNCE_MS);
}

function getProgressDeviceId() {
  const existing = localStorage.getItem(PROGRESS_DEVICE_ID_STORAGE_KEY);
  if (existing && /^[a-zA-Z0-9_.:-]{1,160}$/.test(existing)) return existing;
  const generated = window.crypto?.randomUUID?.()
    || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
  localStorage.setItem(PROGRESS_DEVICE_ID_STORAGE_KEY, generated);
  return generated;
}

// O-06 / O-10 (2026-09-15): Birleştirme kuralları progress-sync.js içinde
// (test edilebilir): sayaçlar cihaz-bazlı CRDT, anahtarlı haritalar silme
// işaretçili "son yazan kazanır", ayarlar alan saatli LWW, sıfırlama dönemi
// (resetAt) öncesi çalışma verisi yok sayılır.
function mergeProgress(local, server) {
  return window.SRProgressSync.mergeProgress(local, server, local?.userId || server?.userId || null);
}

async function pushProgressToCloud() {
  const userId = window.currentUser?.id;
  if (!userId) return;
  if (cloudSyncInFlight) { cloudSyncPending = true; return; }
  cloudSyncInFlight = true;
  try {
    // H-05 düzeltmesi: eşleşen satır sayısını kontrol ediyoruz. profiles satırı
    // (örn. handle_new_user trigger'ı henüz çalışmadıysa) yoksa update sessizce
    // 0 satır etkiler ve kullanıcı ilerlemesinin kaydedildiğini sanır.
    const { data: updatedRows, error } = await supabaseClient
      .from('profiles')
      .update({ progress })
      .eq('id', userId)
      .eq('progress_version', knownProgressVersion)
      .select('id, progress_version');
    if (error) {
      console.error('İlerleme sunucuya kaydedilemedi:', error);
    } else if (!updatedRows || updatedRows.length === 0) {
      // M-04: 0 satır etkilendi — ya profil satırı yok ya da başka bir cihaz
      // araya girip version'ı ilerletti. Sunucudaki son hali çekip merge edip
      // tekrar deniyoruz; körce üzerine yazmıyoruz.
      const { data: serverRow, error: fetchError } = await supabaseClient
        .from('profiles')
        .select('id, progress, progress_version')
        .eq('id', userId)
        .maybeSingle();
      if (fetchError || !serverRow) {
        console.error('İlerleme kaydedilemedi: profil satırı bulunamadı (id=' + userId + ').');
        showToast('İlerleme buluta kaydedilemedi. Lütfen tekrar giriş yapmayı deneyin.');
      } else {
        const serverProgress = sanitizeProgress(serverRow.progress);
        progress = mergeProgress(progress, serverProgress);
        knownProgressVersion = serverRow.progress_version;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
        cloudSyncPending = true; // birleşmiş hali bir sonraki turda tekrar gönder
      }
    } else {
      knownProgressVersion = updatedRows[0].progress_version;
    }
  } catch (err) {
    console.error('İlerleme senkronizasyonu başarısız:', err);
  } finally {
    cloudSyncInFlight = false;
    if (cloudSyncPending) {
      cloudSyncPending = false;
      pushProgressToCloud();
    }
  }
}

// Basit kullanım analitiği: hangi olayın ne sıklıkla tetiklendiğini
// user_events tablosuna kaydeder. Kasıtlı olarak "ateşle ve unut" —
// hata olursa sessizce yutulur, kullanıcı deneyimini asla bloklamaz veya
// bozmaz. Kullanıcıya gösterilen bir özellik değil, sadece Sait'in
// Supabase Studio'dan ihtiyaç oldukça bakacağı ham veri.
function logEvent(eventType, eventData) {
  try {
    if (!progress.userId) return; // misafir/oturumsuz kullanım loglanmaz
    supabaseClient.from('user_events').insert({
      user_id: progress.userId,
      event_type: eventType,
      event_data: eventData || {},
    }).then(({ error }) => {
      if (error) console.warn('logEvent başarısız:', eventType, error.message);
    });
  } catch (_) {
    // Analitik hiçbir zaman uygulamayı kesintiye uğratmamalı.
  }
}

function saveProgress({ rerender = true } = {}) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
  scheduleCloudSync();
  updateHeader();
  const pickerOpen = document.activeElement?.id === 'notifReminderTimeInput';
  if (rerender && !pickerOpen && (state.view === 'home' || state.view === 'profile' || state.view === 'mistakes')) render();
}

// Bekleyen (debounce'lanmış) senkronizasyonu hemen tetikler. Sekme kapatılırken/gizlenirken
// veya çıkış yapılırken 1500ms'lik bekleme süresi içinde kalan son değişikliğin sunucuya
// hiç ulaşmadan kaybolmasını önler.
function flushProgressSync() {
  if (cloudSyncTimer) {
    clearTimeout(cloudSyncTimer);
    cloudSyncTimer = null;
    return pushProgressToCloud();
  }
  return Promise.resolve();
}

// --- WEB KLAVYE ALGILAMA (visualViewport) ---
// native-ux.js'teki Capacitor Keyboard eklentisi yalnızca native (Android/iOS
// paketlenmiş) uygulamada çalışır. Tarayıcıda test ederken (veya native
// eklenti henüz kurulu değilken) --keyboard-height / .keyboard-open hiç
// güncellenmiyordu; bu da açık bir bottom-sheet'in (ör. arama paneli) klavye
// açılınca ekranın altında, klavyenin arkasında kalıp görünmez olmasına yol
// açıyordu. visualViewport API'si tarayıcıda klavye yüksekliğini tespit etmemizi
// sağlar; aynı CSS değişkeni/class'ı besleyerek native ile aynı mekanizmayı
// web'de de çalıştırırız. window.visualViewport yoksa (eski tarayıcı) sessizce
// hiçbir şey yapılmaz.
if (window.visualViewport) {
  const vv = window.visualViewport;
  let lastKeyboardHeight = 0;
  const updateKeyboardHeight = () => {
    // Adres çubuğu/araç çubuğu kaynaklı küçük farkları klavye sanmamak için
    // eşik uyguluyoruz (150px altı fark klavye değildir).
    const heightDiff = window.innerHeight - vv.height - vv.offsetTop;
    const keyboardHeight = heightDiff > 150 ? Math.round(heightDiff) : 0;
    if (keyboardHeight === lastKeyboardHeight) return;
    lastKeyboardHeight = keyboardHeight;
    document.documentElement.style.setProperty('--keyboard-height', `${keyboardHeight}px`);
    document.body.classList.toggle('keyboard-open', keyboardHeight > 0);
  };
  vv.addEventListener('resize', updateKeyboardHeight);
  vv.addEventListener('scroll', updateKeyboardHeight);
}

// Sekme arka plana alındığında / kapatılmak üzereyken bekleyen senkronizasyonu zorla.
// 'pagehide' 'beforeunload'a göre daha güvenilir tetiklenir (bfcache dahil).
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushProgressSync();
});
window.addEventListener('pagehide', () => { flushProgressSync(); });

// Native uygulama arka plana alındığında/öne döndüğünde (native-ux.js üzerinden).
// Arka plana alınca: bekleyen ilerleme senkronunu zorla + açık bir süreli sınav
// varsa arka plana alınma anını kaydet (setInterval arka planda native tarafından
// durdurulabilir/gecikebilir; süreyi gerçek zamana göre düzeltmek için gerekli).
document.addEventListener('nativeux:pause', () => {
  flushProgressSync();
  if (state.quiz && state.quiz.isTimed) {
    state.quiz.backgroundedAt = Date.now();
  }
});

// Öne dönünce: arka planda geçen gerçek süreyi sınav sayacından düş. Süre bu
// sırada tükenmişse sınavı otomatik bitir; hâlâ vakit varsa sayacı gerçek
// kalan süreyle yeniden başlat.
document.addEventListener('nativeux:resume', () => {
  const quiz = state.quiz;
  if (!quiz || !quiz.isTimed || !quiz.backgroundedAt) return;
  const elapsedSeconds = Math.floor((Date.now() - quiz.backgroundedAt) / 1000);
  quiz.backgroundedAt = null;
  if (elapsedSeconds <= 0) return;
  quiz.timeLeft = Math.max(0, quiz.timeLeft - elapsedSeconds);
  if (quiz.timeLeft <= 0) {
    clearInterval(timerInterval);
    timerInterval = null;
    showToast('Arka plandayken sınavın süresi doldu.');
    finishQuizAfterTimeout();
  } else if (!quiz.completionRecorded) {
    renderQuiz();
    startQuizTimer();
  }
});

function dateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Bugün henüz soru çözülmediyse (dailyAnswers[bugün] boş), döngü ilk turda
// durup seriyi 0 gösterirdi — dün 20 gündür seri devam ediyor olsa bile.
// Düzeltme: bugün boşsa dünden geriye say (bugünü seriye dahil etme ama
// sıfırlama da); bugün de doluysa normal şekilde bugünden başla.
function getStreak() {
  const cursor = new Date();
  const todayCount = Number(progress.dailyAnswers[dateKey(cursor)] || 0);
  if (todayCount <= 0) {
    cursor.setDate(cursor.getDate() - 1);
  }
  let streak = 0;
  while (progress.dailyAnswers[dateKey(cursor)] > 0) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

// dailyAnswers üzerindeki tüm günleri tarayıp en uzun ardışık çalışma
// serisini bulur (geçmiş rekor — profil/seri kartında "en uzun serin" için).
function getLongestStreak() {
  const activeDates = Object.keys(progress.dailyAnswers)
    .filter(key => Number(progress.dailyAnswers[key]) > 0)
    .sort();
  if (!activeDates.length) return 0;
  let longest = 1;
  let current = 1;
  for (let i = 1; i < activeDates.length; i++) {
    const prev = new Date(`${activeDates[i - 1]}T00:00:00`);
    const curr = new Date(`${activeDates[i]}T00:00:00`);
    const diffDays = Math.round((curr - prev) / 86400000);
    current = diffDays === 1 ? current + 1 : 1;
    if (current > longest) longest = current;
  }
  return longest;
}

// Ana sayfadaki seri şeridinin 7 noktası için: son 7 günün her biri için
// { done, isToday } — en eskiden en yeniye (bugün en sonda) sıralı.
function getLast7DaysStreak() {
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const cursor = new Date();
    cursor.setDate(cursor.getDate() - i);
    days.push({
      done: Number(progress.dailyAnswers[dateKey(cursor)] || 0) > 0,
      isToday: i === 0
    });
  }
  return days;
}

function getDailyGoal() {
  const value = Number(progress.dailyGoal);
  return Number.isFinite(value) && value >= DAILY_GOAL_MIN && value <= DAILY_GOAL_MAX ? value : DEFAULT_DAILY_GOAL;
}

function setDailyGoal(rawValue) {
  const parsed = Math.round(Number(rawValue));
  if (!Number.isFinite(parsed) || parsed < DAILY_GOAL_MIN || parsed > DAILY_GOAL_MAX) {
    showToast(`Lütfen ${DAILY_GOAL_MIN} ile ${DAILY_GOAL_MAX} arasında bir sayı gir.`);
    return false;
  }
  progress.dailyGoal = parsed;
  window.SRProgressSync.touchField(progress, 'dailyGoal');
  saveProgress();
  showToast(`Günlük hedef ${parsed} soru olarak güncellendi.`);
  return true;
}

function setNotificationPref(key, value) {
  if (!(key in DEFAULT_NOTIFICATION_PREFS)) return;
  progress.notificationPrefs = { ...progress.notificationPrefs, [key]: value };
  window.SRProgressSync.touchField(progress, 'notificationPrefs');
  saveProgress({ rerender: false });
  syncLocalNotificationSchedule();
}

function setReminderTime(rawValue) {
  // <input type="time"> zaten "HH:MM" döndürür; yine de defensif bir kontrol.
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(rawValue)) return false;
  progress.notificationPrefs = { ...progress.notificationPrefs, reminderTime: rawValue };
  window.SRProgressSync.touchField(progress, 'notificationPrefs');
  saveProgress({ rerender: false });
  syncLocalNotificationSchedule();
  return true;
}

// Gerçek cihaz bildirimlerini zamanlamak Capacitor LocalNotifications
// entegrasyonuna (native-ux.js) bağlıdır. O fonksiyon henüz kablolanmadıysa
// bu çağrı sessizce no-op'tur — tercihler yine de progress'e kaydedilir ve
// buluta senkronize edilir; native taraf hazır olduğunda burası devreye girer.
// native-ux.js kendi başına app-özel state'e (progress, state) erişmez —
// (dosyanın kendi başındaki yorumda da belirtildiği gibi "sıkı bağ kurma"
// prensibi) bu yüzden ihtiyaç duyduğu bağlamı (sınav tarihi, bekleyen tekrar
// kart sayısı) burada, çağrı anında ayrı parametre olarak veriyoruz.
function syncLocalNotificationSchedule() {
  if (window.NativeUX && typeof window.NativeUX.scheduleStudyReminders === 'function') {
    window.NativeUX.scheduleStudyReminders(progress.notificationPrefs, {
      examDate: getExamDate(),
      dueFlashcards: state.totalDueFlashcards || 0
    });
  }
}

// NOT (2026-09-05 düzeltme): sınav tarihi kullanıcıya özel bir ayar değil —
// "Görevde Yükselme" sınavının resmi tarihi herkes için aynı. Eskiden her
// kullanıcı kendi profilinden kendi tarihini giriyordu (progress.examDate);
// bu hem yanlıştı hem de kafa karıştırıcı olurdu (herkes farklı bir "sınava
// kalan" görürdü). Artık paylaşılan/genel bir ayar (bkz. app_settings tablosu,
// content-repo.js fetchExamDate — sadece admin yazabilir, herkes okuyabilir).
function getExamDate() {
  return state.sharedExamDate || null;
}

function getDaysUntilExam() {
  const examDate = getExamDate();
  if (!examDate) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(examDate))) return null;
  const target = new Date(`${examDate}T00:00:00`);
  if (Number.isNaN(target.getTime())) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.round((target - today) / 86400000);
}

// Ana sayfadaki "Sınava Kalan" kartında, kalan güne göre değişen kısa
// motivasyon mesajı ("Değişen Koç Mesajı" — üç sabit istatistik kartından
// (halka/nefes/kum saati) farklı olarak veri değil, ton/zamanlama değiştiriyor).
function getExamCountdownMessage(days) {
  if (days === null) return 'Sınav tarihi yakında eklenecek.';
  if (days < 0) return 'Sınav geride kaldı — umarız iyi geçmiştir!';
  if (days === 0) return 'Bugün sınav günü. Başarılar!';
  if (days <= 7) return 'Son düzlük, tekrara odaklan.';
  if (days <= 30) return 'Son sprint — tekrara ağırlık ver.';
  if (days <= 90) return 'Tempoyu koru, düzenli çalış.';
  return 'Temelini sağlam at.';
}

const WEEKDAY_LABELS = ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi', 'Pazar'];
const MONTH_LABELS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];

// Header'daki "Sınav Tarihi" satırı için: 'YYYY-MM-DD' -> "15 Şubat 2027".
// Tarih henüz belirlenmediyse (null) kısa bir yer tutucu döner.
function formatExamDate(examDate) {
  if (!examDate) return 'Yakında belli olacak';
  const d = new Date(`${examDate}T00:00:00`);
  if (Number.isNaN(d.getTime())) return 'Yakında belli olacak';
  return `${d.getDate()} ${MONTH_LABELS[d.getMonth()]} ${d.getFullYear()}`;
}

function startOfWeek(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function sumDailyAnswersBetween(start, end) {
  let total = 0;
  const cursor = new Date(start);
  while (cursor <= end) {
    total += Number(progress.dailyAnswers[dateKey(cursor)] || 0);
    cursor.setDate(cursor.getDate() + 1);
  }
  return total;
}

// "Haftalık Akış" kartı (profileView) için gerçek verilerden bar listesi
// üretir. Üç aralık desteklenir: hafta (7 gün), ay (son 5 hafta), yıl (son
// 12 ay) — hepsi tek veri kaynağından (progress.dailyAnswers) türetiliyor,
// yeni bir senkron alanı gerekmiyor.
function getWeeklyFlowBars(range) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const goal = getDailyGoal();

  if (range === 'month') {
    const bars = [];
    const thisMonday = startOfWeek(today);
    for (let w = 4; w >= 0; w -= 1) {
      const start = new Date(thisMonday);
      start.setDate(thisMonday.getDate() - w * 7);
      const end = new Date(start);
      end.setDate(start.getDate() + 6);
      const cappedEnd = end > today ? today : end;
      const count = sumDailyAnswersBetween(start, cappedEnd);
      bars.push({
        label: `${start.getDate()}-${end.getDate()} ${MONTH_LABELS[end.getMonth()]}`,
        detail: `${start.toLocaleDateString('tr-TR')} – ${end.toLocaleDateString('tr-TR')} · ${count} soru`,
        count, isToday: w === 0, isFuture: false,
        compliance: goal ? Math.min(1, count / (goal * 7)) : 0
      });
    }
    return { bars, unit: 'hafta', periodLabel: 'Bu ay' };
  }

  if (range === 'year') {
    const bars = [];
    for (let m = 11; m >= 0; m -= 1) {
      const monthDate = new Date(today.getFullYear(), today.getMonth() - m, 1);
      const monthEnd = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0);
      const cappedEnd = monthEnd > today ? today : monthEnd;
      const count = sumDailyAnswersBetween(monthDate, cappedEnd);
      const daysInMonth = Math.round((cappedEnd - monthDate) / 86400000) + 1;
      bars.push({
        label: MONTH_LABELS[monthDate.getMonth()],
        detail: `${MONTH_LABELS[monthDate.getMonth()]} ${monthDate.getFullYear()} · ${count} soru`,
        count, isToday: m === 0, isFuture: false,
        compliance: goal && daysInMonth > 0 ? Math.min(1, count / (goal * daysInMonth)) : 0
      });
    }
    return { bars, unit: 'ay', periodLabel: 'Bu yıl' };
  }

  const monday = startOfWeek(today);
  const bars = [];
  for (let i = 0; i < 7; i += 1) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    const isFuture = d > today;
    const count = isFuture ? 0 : Number(progress.dailyAnswers[dateKey(d)] || 0);
    bars.push({
      label: WEEKDAY_LABELS[i],
      detail: `${d.toLocaleDateString('tr-TR', { weekday: 'long' })} · ${count} soru`,
      count, isToday: !isFuture && d.getTime() === today.getTime(), isFuture,
      compliance: goal ? Math.min(1, count / goal) : 0
    });
  }
  return { bars, unit: 'gün', periodLabel: 'Bu hafta' };
}

function renderWeeklyFlowCard() {
  const range = state.weeklyFlowRange || 'week';
  const { bars, periodLabel } = getWeeklyFlowBars(range);
  const total = bars.reduce((sum, bar) => sum + bar.count, 0);
  const consideredBars = bars.filter(bar => !bar.isFuture);
  const compliance = consideredBars.length
    ? Math.round(consideredBars.reduce((sum, bar) => sum + bar.compliance, 0) / consideredBars.length * 100)
    : 0;
  const maxCount = Math.max(1, ...bars.map(bar => bar.count));
  const strongest = bars.reduce((best, bar) => (bar.count > (best?.count || 0) ? bar : best), null);
  const periodWord = range === 'week' ? 'günün' : range === 'month' ? 'haftan' : 'ayın';
  const note = state.weeklyFlowNote || (strongest && strongest.count > 0
    ? `✨ ${strongest.label} en güçlü ${periodWord}. Sütunlara dokunarak ayrıntıyı görebilirsin.`
    : 'Sütunlara dokunarak ayrıntıyı görebilirsin.');

  return `<section class="profile-goal-card">
    <div class="profile-goal-head"><span>HAFTALIK AKIŞ</span></div>
    <p class="profile-goal-desc">Son yedi gündeki çalışma ritmin ve günlük hedeflerin.</p>
    <div class="flow-toolbar">
      <div class="flow-tabs" role="tablist" aria-label="Zaman aralığı">
        <button class="flow-tab${range === 'week' ? ' active' : ''}" data-flow-range="week" type="button">Haftalık</button>
        <button class="flow-tab${range === 'month' ? ' active' : ''}" data-flow-range="month" type="button">Aylık</button>
        <button class="flow-tab${range === 'year' ? ' active' : ''}" data-flow-range="year" type="button">Yıllık</button>
      </div>
      <div class="flow-total">
        <strong>${total} soru</strong>
        <span>${periodLabel} · %${compliance} uyum</span>
      </div>
    </div>
    <div class="flow-chart">
      ${bars.map((bar, idx) => `<button class="flow-day${bar.isToday ? ' today' : ''}" data-flow-bar="${idx}" type="button">
        <span class="flow-bar" style="--h:${Math.max(6, Math.round(bar.count / maxCount * 130))}px"></span>
        <small>${escapeHtml(bar.label)}</small>
      </button>`).join('')}
    </div>
    <div class="flow-note">${escapeHtml(note)}</div>
  </section>`;
}

function getStats() {
  const completedSections = Object.keys(progress.completedSections).filter(key => !key.startsWith('card-deck:') && !key.startsWith('wrong-fixed:')).length;
  const completedMocks = progress.completedTests.filter(test => EXAM_KINDS.includes(test.kind)).length;
  const todayAnswers = Number(progress.dailyAnswers[dateKey()] || 0);
  const dailyGoal = getDailyGoal();
  const examDate = getExamDate();
  return {
    completedSections,
    solvedQuestions: Number(progress.answers || 0),
    uniqueSolved: window.SRProgressSync.estimateSeenCount(progress.seenBitmap),
    completedMocks,
    streak: getStreak(),
    longestStreak: getLongestStreak(),
    streakDays: getLast7DaysStreak(),
    todayAnswers,
    dailyGoal,
    dailyPercentage: Math.min(100, Math.round((todayAnswers / dailyGoal) * 100)),
    accuracy: progress.answers ? Math.round((progress.correctAnswers / progress.answers) * 100) : 0,
    examDate,
    daysUntilExam: getDaysUntilExam(),
    totalQuestionCount: state.totalQuestionCount || 0,
    // Cevaplanan soru varsa yüzde asla "%0" görünmesin (ör. 13/7.646 gerçekte
    // ~%0.17 ama yuvarlanınca 0 çıkıyor ve yeni başlayanı moralsiz ediyordu) —
    // en az %1 gösterilir; hiç soru çözülmediyse gerçek %0 kalır.
    // D-06: Banka yüzdesi farklı soru sayısından (tahmini) hesaplanır;
    // aynı sorunun tekrar çözülmesi yüzdeyi artırmaz.
    bankPercentage: (() => {
      const unique = Math.min(state.totalQuestionCount || 0, window.SRProgressSync.estimateSeenCount(progress.seenBitmap));
      if (!state.totalQuestionCount) return 0;
      return Math.min(100, Math.max(unique > 0 ? 1 : 0, Math.round((unique / state.totalQuestionCount) * 100)));
    })()
  };
}

function setNav(name) {
  navButtons.forEach(button => button.classList.toggle('active', button.dataset.nav === name));
}

// --- SHEET DURUM YÖNETİMİ ---
// Aynı anda yalnızca bir sheet açık kalabilir. Böylece arama açıldığında arkada
// eski bir kategori paneli görünmez ve hem X hem Android geri tuşu aynı temiz
// kapanış yolunu kullanır.
const allSheets = [routeSheet, topicSheet, searchSheet];

function setSheetOpen(sheet, isOpen) {
  if (!sheet) return;
  sheet.classList.toggle('open', isOpen);
  sheet.setAttribute('aria-hidden', String(!isOpen));
  sheet.inert = !isOpen;
}

function restoreSearchScrollPosition() {
  if (searchScrollTop === null) return;
  const top = searchScrollTop;
  searchScrollTop = null;
  const restore = () => { scrollArea.scrollTop = top; };

  // Android klavyesi kapanırken tarayıcı kaydırma konumunu bir kez daha
  // değiştirebilir. Aynı konumu sonraki karede de geri yüklemek, ana ekranın
  // başlığının/kategorilerinin kaybolmasını önler.
  restore();
  window.requestAnimationFrame(restore);
  window.setTimeout(restore, 240);
}

function clearSearchState({ dismissKeyboard = true, restoreScroll = true } = {}) {
  window.clearTimeout(searchFocusTimer);
  searchFocusTimer = null;
  searchInput.value = '';
  searchResultsList.innerHTML = '';
  searchInput.blur();
  if (dismissKeyboard) {
    document.body.classList.remove('keyboard-open');
    document.documentElement.style.setProperty('--keyboard-height', '0px');
    window.NativeUX?.hideKeyboard?.();
  }
  if (restoreScroll) restoreSearchScrollPosition();
}

function closeAllSheets(exceptSheet = null) {
  allSheets.forEach(sheet => setSheetOpen(sheet, sheet === exceptSheet));
  if (exceptSheet !== searchSheet) clearSearchState();
  topicBackdrop.classList.toggle('open', Boolean(exceptSheet));
}

window.go = function go(view) {
  closeAllSheets();
  state.view = view;
  setNav(view);
  render();
  scrollArea.scrollTop = 0;
};

function getCategories() {
  return state.catalogue ? Object.entries(state.catalogue) : [];
}

function slugify(value) {
  return String(value).toLocaleLowerCase('tr-TR').replace(/ı/g, 'i').replace(/ş/g, 's').replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ö/g, 'o').replace(/ç/g, 'c').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function looksLikeDocument(title) {
  return /sayılı|kanunu|yönetmeliği|kararnamesi|khk/i.test(title);
}

function normalizeItem(item) {
  if (typeof item !== 'string') return item;
  return { id: slugify(item), title: item, type: looksLikeDocument(item) ? 'document' : 'topic', contentStatus: 'planned', questionCount: 0, articleCount: 0, children: [] };
}

function getCategory(categoryKey) {
  return state.catalogue && state.catalogue[categoryKey];
}

function getCategoryItems(categoryKey) {
  const category = getCategory(categoryKey);
  const role = progress.selectedRole;
  return category ? (category.topics || []).map(normalizeItem).filter(item => !role || !item.kadrolar || item.kadrolar.includes(role)) : [];
}

function isRolePurchased(role = progress.selectedRole) {
  // Kadro erişimi yalnızca sunucunun doğruladığı premium durumuna dayanır.
  // Eski cihazlarda kalmış purchasedRoles değeri yetki kanıtı değildir.
  return !role || window.currentUserIsPremium === true;
}

function getDocumentProgress(documentItem) {
  const role = progress.selectedRole;
  const sections = (documentItem.children || []).filter(section => !role || !section.kadrolar || section.kadrolar.includes(role));
  if (!sections.length) return 0;
  const completed = sections.filter(section => progress.completedSections[section.id]).length;
  return Math.round((completed / sections.length) * 100);
}

function getCategoryProgress(categoryKey) {
  const items = getCategoryItems(categoryKey).filter(item => item.type === 'document' && item.children && item.children.length);
  if (!items.length) return 0;
  const values = items.map(getDocumentProgress);
  return Math.round(values.reduce((total, value) => total + value, 0) / values.length);
}

function getActiveDocuments() {
  const purchased = isRolePurchased();
  return getCategories().flatMap(([categoryKey]) => getCategoryItems(categoryKey)
    .map((item, index) => ({ item, categoryKey, index }))
    .filter(entry => (entry.item.type === 'document' || entry.item.type === 'topic') && entry.item.questionFile && (purchased || entry.index === 0)));
}

function categoryCardMeta(categoryKey) {
  const presets = {
    'general-legislation': { title: 'Mevzuat', description: 'Kanunlar, yönetmelikler ve resmi düzenlemeler.', icon: 'scale', iconClass: '' },
    'general-culture': { title: 'Ortak Alan Bilgisi', description: 'Türkçe, Genel Kültür gibi mevzuatta yer almayan konular.', icon: 'landmark', iconClass: 'blue' },
    'meb-legislation': { title: 'MEB Mevzuatı', description: 'Millî Eğitim Bakanlığı mevzuat ve yönergeleri.', icon: 'schoolbook', iconClass: 'red' }
  };
  return presets[categoryKey] || { title: getCategory(categoryKey)?.title || 'Konu', description: getCategory(categoryKey)?.subtitle || '', icon: 'book', iconClass: '' };
}

function loadingView() {
  return `<section class="screen neutral-screen"><div class="empty-state"><span class="empty-state-icon">${svg('refresh')}</span><h3>İçerikler hazırlanıyor</h3><p>Konu ve soru bankası yükleniyor.</p></div></section>`;
}

function errorView() {
  return `<section class="screen neutral-screen"><div class="empty-state empty-state-error"><span class="empty-state-icon">${svg('book')}</span><h3>İçerikler yüklenemedi</h3><p>${escapeHtml(state.catalogueError || 'Sunucuya bağlanılamadı, internet bağlantını kontrol et.')}</p><button class="reader-primary" id="retryLoadButton" type="button">Tekrar Dene</button></div></section>`;
}

function statCard(icon, colorClass, number, label, target) {
  return `<button class="stat stat-button" data-stat-target="${target}" type="button"><span class="stat-icon ${colorClass}">${svg(icon)}</span><strong>${number}</strong><span>${label}</span></button>`;
}

// Türkçe ünlü uyumuna göre iyelik+belirtme eki üretir (13 -> "ünü", 8 -> "ini",
// 100 -> "ünü", 2 -> "sini" vb.) — sabit "'ini" eki her sayı için doğru
// değildi (ör. "13'ini" yanlış, doğrusu "13'ünü"). Ek, sayının SÖYLENİŞTEKİ
// son kelimesine (birler/onlar/yüz/bin/milyon) göre belirlenir.
function turkishAccusativeSuffix(n) {
  const num = Math.abs(Math.trunc(Number(n) || 0));
  const units = ['sıfır', 'bir', 'iki', 'üç', 'dört', 'beş', 'altı', 'yedi', 'sekiz', 'dokuz'];
  const tensWords = ['', 'on', 'yirmi', 'otuz', 'kırk', 'elli', 'altmış', 'yetmiş', 'seksen', 'doksan'];
  const harmonyMap = { a: 'ı', ı: 'ı', e: 'i', i: 'i', o: 'u', u: 'u', ö: 'ü', ü: 'ü' };

  function wordSuffix(word) {
    let lastVowel = 'ı';
    for (let i = word.length - 1; i >= 0; i--) {
      if (harmonyMap[word[i]]) { lastVowel = harmonyMap[word[i]]; break; }
    }
    const endsWithVowel = /[aeıioöuü]$/.test(word);
    return `${endsWithVowel ? 's' : ''}${lastVowel}n${lastVowel}`;
  }

  let lastWord;
  if (num === 0) lastWord = 'sıfır';
  else if (num % 10 !== 0) lastWord = units[num % 10];
  else if (Math.floor(num / 10) % 10 !== 0) lastWord = tensWords[Math.floor(num / 10) % 10];
  else if (Math.floor(num / 100) % 10 !== 0) lastWord = 'yüz';
  else if (Math.floor(num / 1000) % 1000 !== 0) lastWord = 'bin';
  else if (Math.floor(num / 1000000) % 1000 !== 0) lastWord = 'milyon';
  else lastWord = 'milyar';
  return wordSuffix(lastWord);
}

function renderBankProgressWidget(stats) {
  const bankPct = stats.bankPercentage;
  return `<section class="bank-progress-card">
    <div class="bank-progress-main">
      <div class="bank-progress-head">
        <div><span>GENEL İLERLEME</span><strong class="bank-progress-percent">%${bankPct}</strong></div>
        <div class="bank-progress-title"><h4>Soru Bankası İlerlemen</h4><small>${stats.totalQuestionCount ? (() => {
          const solvedCount = Math.min(stats.uniqueSolved, stats.totalQuestionCount);
          return `${stats.totalQuestionCount.toLocaleString('tr-TR')} sorudan ${solvedCount.toLocaleString('tr-TR')}'${turkishAccusativeSuffix(solvedCount)} çözdün`;
        })() : `${stats.solvedQuestions} soru çözümü yaptın`}</small></div>
      </div>
      <div class="bank-progress-path">
        <div class="bank-progress-track">
          <div class="bank-progress-track-fill" style="width:${bankPct}%"></div>
          <span class="bank-progress-dot" style="left:${bankPct}%"></span>
        </div>
        <div class="bank-progress-labels">
          <div class="bp-tick bp-tick-mid"><span class="bp-tick-mark"></span><span>%50</span></div>
          <div class="bp-tick bp-tick-end"><span class="bp-tick-mark"></span><span>%100</span></div>
        </div>
      </div>
    </div>
  </section>`;
}

function homeView() {
  if (!state.catalogue) return state.catalogueError ? errorView() : loadingView();
  const stats = getStats();
  const categories = getCategories().filter(([key]) => getCategoryItems(key).length > 0).map(([key]) => {
    const meta = categoryCardMeta(key);
    const topics = getCategoryItems(key);
    const activePackages = topics.filter(item => item.questionFile).length;
    const metaText = activePackages ? `${topics.length} başlık • ${activePackages} aktif paket` : `${topics.length} başlık • içerik planlanıyor`;
    return `<article class="category" role="button" tabindex="0" data-open-category="${key}">
      <div class="cat-icon ${meta.iconClass}">${svg(meta.icon)}</div>
      <div class="cat-copy"><h4>${escapeHtml(meta.title)}</h4><p>${escapeHtml(meta.description)}</p><small>${metaText}</small></div>
      <div class="chevron">${svg('arrow')}</div>
    </article>`;
  }).join('');

  return `<section class="screen home-screen">
    ${renderBankProgressWidget(stats)}
    <div class="section-head"><h3>Test Kategorileri</h3></div>
    <section class="categories">${categories}</section>
    
    <!-- BUGÜNKÜ ROTA BUTONU -->
    <button class="cta-btn" id="openRouteSheetButton" type="button">
      <div class="cta-icon">${svg('compass')}</div><div><strong>Bugünkü Rota</strong><span>Önerilen planı gör veya özelleştir</span></div><span class="chevron-w">${svg('arrow')}</span>
    </button>
    ${state.totalDueFlashcards > 0 ? `
    <button class="cta-btn cta-btn-flashcards" id="openDueFlashcardsButton" type="button">
      <div class="cta-icon">${svg('gavel')}</div><div><strong>Bugün ${state.totalDueFlashcards} kart tekrar seni bekliyor</strong><span>Leitner kutu sistemine göre öncelikli</span></div><span class="chevron-w">${svg('arrow')}</span>
    </button>` : ''}
  </section>`;
}

// NOT (2026-09 sadeleştirme): Bu ekran eskiden iki ayrı deneme kaynağı
// gösteriyordu — sabit/kürate "{kadro} Denemeleri" listesi (denemeler/
// deneme_questions tablolarına dayanıyordu) ve buradaki "Kadro Bazlı Gerçek
// Sınav" kartı (buildKadroExamPool/startKadroExam, Ek-2 ağırlık tablosuna göre
// canlı questions havuzundan HER TIKLAMADA taze bir sınav üretir). Sabit liste
// kaldırıldı: (1) iki paralel sistemin bakımı gereksiz karmaşıktı, (2) sabit
// listedeki benzersiz sorular questions'a taşındı (bkz.
// merge_unique_manual_deneme_pool_questions_into_questions migration'ı), (3)
// otomatik üretim resmi ağırlık dağılımını zaten uyguluyor ve tekrar
// denemelerde aynı soruların ezberlenmesini önlüyor.
function getCompletedKadroExams(limit = 15) {
  return progress.completedTests
    .filter(test => EXAM_KINDS.includes(test.kind))
    .slice()
    .sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt))
    .slice(0, limit);
}

function formatCompletedDate(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function bankView() {
  const stats = getStats();
  const completedExams = getCompletedKadroExams();
  const examAverage = completedExams.length ? Math.round(completedExams.reduce((sum, test) => sum + (test.total ? (test.score / test.total) * 100 : 0), 0) / completedExams.length) : 0;
  const roleLabel = ROLES.find(r => r.key === progress.selectedRole)?.label || 'Kadro';
  const completedExamsHtml = completedExams.length ? `
    <div class="bank-v2-section-head"><h3>Son Çözülenler</h3></div>
    <div class="bank-v2-results">
      ${completedExams.slice(0, 6).map(test => {
        const percentage = test.total ? Math.round((test.score / test.total) * 100) : 0;
        const tone = percentage >= 80 ? 'good' : percentage >= 60 ? 'mid' : 'low';
        return `<article class="bank-v2-result">
          <div class="bank-v2-result-icon" aria-hidden="true">${svg('statTrials')}</div>
          <div class="bank-v2-result-main">
            <strong>${escapeHtml(test.title)}</strong>
            <span>${formatCompletedDate(test.completedAt)} • ${test.total} soru</span>
            <div class="bank-v2-result-track"><i class="${tone}" style="width:${Math.max(0, Math.min(100, percentage))}%"></i></div>
          </div>
          <div class="bank-v2-result-score"><b>%${percentage}</b><small>${test.score}/${test.total}</small></div>
        </article>`;
      }).join('')}
    </div>` : '';

  return `<section class="screen content-screen bank-screen bank-v2">
    <header class="bank-v2-heading">
      <div class="bank-v2-heading-copy">
        <h2>Deneme Sınavları</h2>
        <p>Hedefine bir adım daha yaklaş.</p>
      </div>
      <div class="bank-v2-heading-art" aria-hidden="true">
        <span class="bank-v2-paper">${svg('statTrials')}</span>
        <span class="bank-v2-clock">${svg('clock')}</span>
      </div>
    </header>

    <article class="bank-v2-hero">
      <div class="bank-v2-hero-copy">
        <h3>Kadro Bazlı Gerçek Sınav</h3>
        <p>${escapeHtml(roleLabel)} hedefin için resmi konu ağırlıklarına göre yeni bir deneme oluştur.</p>
      </div>
      <div class="bank-v2-hero-art" aria-hidden="true">
        <span class="bank-v2-hero-paper">${svg('statTrials')}</span>
        <span class="bank-v2-hero-target">${svg('target')}</span>
      </div>
      <button class="bank-v2-hero-start" id="startKadroExamButton" type="button">
        <span class="bank-v2-play" aria-hidden="true"></span><span>Sınava Başla</span>
      </button>
    </article>

    <div class="bank-v2-metrics">
      <article class="bank-v2-metric bank-v2-metric-blue">
        <span class="bank-v2-metric-icon">${svg('circleCheckBig')}</span>
        <div><small>Tamamlanan Deneme</small><strong>${stats.completedMocks}</strong></div>
      </article>
      <article class="bank-v2-metric bank-v2-metric-red">
        <span class="bank-v2-metric-icon">${svg('chart')}</span>
        <div><small>Ortalama Başarı</small><strong>%${examAverage}</strong></div>
      </article>
    </div>

    <div class="bank-v2-types">
      <article class="bank-v2-type">
        <span class="bank-v2-type-icon bank-v2-type-red">${svg('briefcase')}</span>
        <div class="bank-v2-type-copy"><strong>Kadro Bazlı Gerçek Sınav</strong><p>Resmî ağırlık dağılımında tam sınav deneyimi.</p></div>
        <button type="button" class="bank-v2-type-btn bank-v2-btn-red" id="startKadroExamTypeButton"><span class="bank-v2-play"></span>Başlat</button>
      </article>
      <article class="bank-v2-type">
        <span class="bank-v2-type-icon bank-v2-type-blue">${svg('zap')}</span>
        <div class="bank-v2-type-copy"><strong>Hızlı Mini Deneme</strong><p>20 soru • 20 dakika. Kısa sürede seviyeni ölç.</p></div>
        <button type="button" class="bank-v2-type-btn bank-v2-btn-blue" id="startMiniExamButton"><span class="bank-v2-play"></span>Başlat</button>
      </article>
      <article class="bank-v2-type">
        <span class="bank-v2-type-icon bank-v2-type-purple">${svg('shuffle')}</span>
        <div class="bank-v2-type-copy"><strong>Karışık Genel Tekrar</strong><p>40 soru • 50 dakika. Aktif konulardan karma deneme.</p></div>
        <button type="button" class="bank-v2-type-btn bank-v2-btn-purple" id="startMixedExamButton"><span class="bank-v2-play"></span>Başlat</button>
      </article>
    </div>

    ${completedExamsHtml}
  </section>`;
}

function getWrongQuestionsGrouped() {
  const map = new Map();
  Object.values(progress.wrongQuestions).forEach(q => {
    const catKey = q.categoryKey || 'other';
    const docKey = q.documentId || 'other-doc';
    if (!map.has(catKey)) map.set(catKey, new Map());
    const docMap = map.get(catKey);
    if (!docMap.has(docKey)) docMap.set(docKey, { documentId: docKey, documentTitle: q.documentTitle || 'Diğer Sorular', questions: [] });
    docMap.get(docKey).questions.push(q);
  });
  return map;
}

function getMistakeDocuments(categoryKey) {
  const grouped = getWrongQuestionsGrouped();
  const docMap = grouped.get(categoryKey);
  if (!docMap) return [];
  let list = [...docMap.values()];
  if (categoryKey !== 'other' && getCategory(categoryKey)) {
    const allowedIds = new Set(getCategoryItems(categoryKey).map(item => item.id));
    list = list.filter(doc => allowedIds.has(doc.documentId));
  }
  return list.sort((a, b) => b.questions.length - a.questions.length);
}

function mistakeCategoryMeta(categoryKey) {
  if (categoryKey === 'other' || !getCategory(categoryKey)) return { title: 'Diğer Sorular', icon: 'book', iconClass: '' };
  return categoryCardMeta(categoryKey);
}

const WRONG_FIXED_PREFIX = 'wrong-fixed:';

function wrongFixedKey(categoryKey, questionId) {
  return `${WRONG_FIXED_PREFIX}${categoryKey || 'other'}:${String(questionId)}`;
}

function clearWrongFixedForQuestion(questionId) {
  const suffix = `:${String(questionId)}`;
  Object.keys(progress.completedSections || {})
    .filter(key => key.startsWith(WRONG_FIXED_PREFIX) && key.endsWith(suffix))
    .forEach(key => window.SRProgressSync.deleteKey(progress, 'completedSections', key));
}

function getResolvedWrongCountsByCategory() {
  const counts = {};
  Object.keys(progress.completedSections || {}).forEach(key => {
    if (!key.startsWith(WRONG_FIXED_PREFIX)) return;
    const rest = key.slice(WRONG_FIXED_PREFIX.length);
    const splitAt = rest.indexOf(':');
    const categoryKey = splitAt >= 0 ? rest.slice(0, splitAt) : 'other';
    counts[categoryKey] = (counts[categoryKey] || 0) + 1;
  });
  return counts;
}

function getMistakeCategories() {
  const grouped = getWrongQuestionsGrouped();
  return [...grouped.keys()].map(key => {
    const docs = getMistakeDocuments(key);
    const count = docs.reduce((sum, d) => sum + d.questions.length, 0);
    if (!count) return null;
    const meta = mistakeCategoryMeta(key);
    return { key, title: meta.title, icon: meta.icon, iconClass: meta.iconClass, count };
  }).filter(Boolean).sort((a, b) => b.count - a.count);
}

function mistakesView() {
  const remainingByCategory = Object.fromEntries(getMistakeCategories().map(cat => [cat.key, cat]));
  const resolvedByCategory = getResolvedWrongCountsByCategory();
  const categoryKeys = new Set([...Object.keys(remainingByCategory), ...Object.keys(resolvedByCategory)]);
  const order = ['general-legislation', 'meb-legislation', 'general-culture'];

  const presentation = {
    'general-legislation': { title: 'Genel Mevzuat', icon: 'scale', tone: 'red' },
    'meb-legislation': { title: 'MEB Mevzuatı', icon: 'schoolbook', tone: 'blue' },
    'general-culture': { title: 'Ortak Alan Bilgisi', icon: 'landmark', tone: 'violet' },
    other: { title: 'Diğer Sorular', icon: 'book', tone: 'green' }
  };

  const categories = [...categoryKeys].map(key => {
    const current = remainingByCategory[key];
    const remaining = current?.count || 0;
    const completed = resolvedByCategory[key] || 0;
    const meta = current || mistakeCategoryMeta(key);
    return {
      key,
      title: current?.title || meta?.title || 'Diğer Sorular',
      icon: current?.icon || meta?.icon || 'book',
      remaining,
      completed,
      total: remaining + completed
    };
  }).filter(cat => cat.total > 0).sort((a, b) => {
    const rank = key => order.includes(key) ? order.indexOf(key) : order.length;
    return rank(a.key) - rank(b.key);
  });

  const repeatCount = Object.keys(progress.wrongQuestions).length;
  const correctedCount = Object.values(resolvedByCategory).reduce((sum, n) => sum + Number(n || 0), 0);
  const totalWrongCount = repeatCount + correctedCount;

  // Yanlışlarım ikon sistemi — tek ve kalıcı premium set.
  // Harici görsel dosyası yok; bütün illüstrasyonlar inline SVG olarak render edilir.
  const headingArt = `<svg class="mistakes-ref-heading-art" viewBox="0 0 200 150" fill="none" aria-hidden="true">
    <defs>
      <linearGradient id="mist-head-back" x1="100" y1="32" x2="165" y2="120" gradientUnits="userSpaceOnUse"><stop stop-color="#78BEFF"/><stop offset="1" stop-color="#2579EF"/></linearGradient>
      <linearGradient id="mist-head-x" x1="75" y1="49" x2="116" y2="93" gradientUnits="userSpaceOnUse"><stop stop-color="#FF7C86"/><stop offset="1" stop-color="#E93238"/></linearGradient>
      <filter id="mist-head-shadow" x="28" y="8" width="156" height="134" filterUnits="userSpaceOnUse"><feDropShadow dx="0" dy="9" stdDeviation="8" flood-color="#174F9C" flood-opacity=".20"/></filter>
      <filter id="mist-head-badge-shadow" x="61" y="41" width="68" height="68" filterUnits="userSpaceOnUse"><feDropShadow dx="0" dy="5" stdDeviation="5" flood-color="#D91D33" flood-opacity=".25"/></filter>
    </defs>
    <circle cx="124" cy="72" r="57" fill="#EAF3FF" fill-opacity=".72"/>
    <circle cx="124" cy="72" r="45" stroke="#2D7EF7" stroke-opacity=".10" stroke-width="2"/>
    <circle cx="124" cy="72" r="35" stroke="#2D7EF7" stroke-opacity=".06"/>
    <g filter="url(#mist-head-shadow)">
      <g transform="rotate(9 137 79)"><rect x="105" y="40" width="62" height="76" rx="15" fill="url(#mist-head-back)"/><path d="m120 80 9 9 20-22" stroke="#fff" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/></g>
      <g transform="rotate(-7 96 76)"><rect x="58" y="34" width="75" height="88" rx="16" fill="#fff" stroke="#DCE8F7" stroke-width="2"/><rect x="75" y="96" width="41" height="5.5" rx="2.75" fill="#CFE0F5"/><rect x="75" y="106" width="29" height="5.5" rx="2.75" fill="#DFEAF7"/></g>
    </g>
    <g filter="url(#mist-head-badge-shadow)"><circle cx="95" cy="71" r="22" fill="url(#mist-head-x)"/><circle cx="95" cy="71" r="20.5" stroke="#fff" stroke-opacity=".32"/><path d="m86.5 62.5 17 17m0-17-17 17" stroke="#fff" stroke-width="6" stroke-linecap="round"/></g>
    <path d="M154 24c10 4 18 11 22 20" stroke="#2D7EF7" stroke-width="4" stroke-linecap="round"/><path d="m171 36 6 9-10 2" fill="#2D7EF7"/>
    <path d="M42 106c9 7 19 10 30 10" stroke="#E93238" stroke-width="4" stroke-linecap="round"/><path d="m64 110 9 6-9 5" fill="#E93238"/>
    <path d="M177 25v9M172.5 29.5h9M47 39l-6 6" stroke="#63A8FF" stroke-width="3" stroke-linecap="round"/>
  </svg>`;

  const heroArt = `<svg class="mistakes-ref-hero-art" viewBox="0 0 220 180" fill="none" aria-hidden="true">
    <defs>
      <linearGradient id="mist-hero-blue" x1="50" y1="45" x2="176" y2="137" gradientUnits="userSpaceOnUse"><stop stop-color="#72BCFF"/><stop offset="1" stop-color="#2678EF"/></linearGradient>
      <linearGradient id="mist-hero-red" x1="139" y1="111" x2="188" y2="146" gradientUnits="userSpaceOnUse"><stop stop-color="#FF747E"/><stop offset="1" stop-color="#E93238"/></linearGradient>
      <linearGradient id="mist-hero-badge" x1="101" y1="60" x2="145" y2="104" gradientUnits="userSpaceOnUse"><stop stop-color="#FF7C86"/><stop offset="1" stop-color="#E93238"/></linearGradient>
      <filter id="mist-hero-shadow" x="31" y="14" width="174" height="155" filterUnits="userSpaceOnUse"><feDropShadow dx="0" dy="10" stdDeviation="8" flood-color="#020D25" flood-opacity=".32"/></filter>
      <filter id="mist-hero-badge-shadow" x="91" y="51" width="64" height="64" filterUnits="userSpaceOnUse"><feDropShadow dx="0" dy="5" stdDeviation="5" flood-color="#D91D33" flood-opacity=".30"/></filter>
    </defs>
    <circle cx="128" cy="91" r="69" stroke="#fff" stroke-opacity=".06" stroke-width="2"/><circle cx="128" cy="91" r="54" stroke="#fff" stroke-opacity=".04"/>
    <g filter="url(#mist-hero-shadow)">
      <g transform="rotate(8 126 94)"><rect x="88" y="52" width="76" height="92" rx="17" fill="#286ED0" opacity=".58"/></g>
      <g transform="rotate(-7 112 89)"><rect x="75" y="42" width="79" height="98" rx="17" fill="#fff" stroke="#DCE8F8" stroke-width="2"/><rect x="92" y="105" width="44" height="6" rx="3" fill="#8DBCF5"/><rect x="92" y="118" width="31" height="6" rx="3" fill="#BDD6F2"/></g>
      <path d="M63 76c13-22 38-34 63-30 18 3 34 13 45 28" stroke="url(#mist-hero-blue)" stroke-width="12" stroke-linecap="round"/><path d="m162 55 16 20-25 4" fill="#449BFF"/>
      <path d="M177 113c-14 22-41 33-66 27-17-4-32-13-42-28" stroke="url(#mist-hero-red)" stroke-width="12" stroke-linecap="round"/><path d="m78 131-16-19 25-4" fill="#EE3B49"/>
    </g>
    <g filter="url(#mist-hero-badge-shadow)"><circle cx="122" cy="82" r="22" fill="url(#mist-hero-badge)"/><circle cx="122" cy="82" r="20.5" stroke="#fff" stroke-opacity=".32"/><path d="m113.5 73.5 17 17m0-17-17 17" stroke="#fff" stroke-width="6" stroke-linecap="round"/></g>
    <path d="M45 70c-5 8-8 16-8 24M190 89c2 8 2 16 0 23" stroke="#76BCFF" stroke-width="3" stroke-linecap="round" stroke-dasharray="5 7"/>
  </svg>`;

  const metricWrongIcon = `<svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><defs><linearGradient id="metric-x-ring" x1="5" y1="4" x2="27" y2="28"><stop stop-color="#fff"/><stop offset="1" stop-color="#FFE6E9"/></linearGradient></defs><circle cx="16" cy="16" r="10.5" stroke="url(#metric-x-ring)" stroke-width="2.4"/><path d="m12 12 8 8m0-8-8 8" stroke="#fff" stroke-width="3.2" stroke-linecap="round"/></svg>`;
  const metricRepeatIcon = `<svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><circle cx="16" cy="16" r="10.5" stroke="#fff" stroke-width="2.2"/><path d="M16 10v6.2l4.2 2.5" stroke="#fff" stroke-width="2.7" stroke-linecap="round" stroke-linejoin="round"/><path d="M22.4 8.2 25 7v3.7" stroke="#fff" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

  const categoryHtml = categories.map(cat => {
    const design = presentation[cat.key] || { title: cat.title, icon: cat.icon || 'book', tone: 'green' };
    const completed = cat.completed;
    const remaining = cat.remaining;
    const repeat = remaining;
    const pct = cat.total ? Math.round((completed / cat.total) * 100) : 0;
    const interactionAttrs = remaining
      ? `role="button" tabindex="0" data-open-mistake-category="${escapeHtml(cat.key)}" aria-label="${escapeHtml(design.title)} yanlışlarını çalış"`
      : `aria-label="${escapeHtml(design.title)} tamamlandı"`;
    const workLabel = remaining ? `<span class="mistakes-ref-work"><span class="mistakes-ref-play" aria-hidden="true"></span>Çalış</span>` : `<span class="mistakes-ref-work is-complete">${svg('check')}Tamam</span>`;
    return `<article class="mistakes-ref-topic tone-${design.tone}${remaining ? '' : ' is-complete'}" ${interactionAttrs}>
      <div class="mistakes-ref-topic-icon" aria-hidden="true">${svg(design.icon)}</div>
      <div class="mistakes-ref-topic-main">
        <div class="mistakes-ref-topic-top"><div><h4>${escapeHtml(design.title)}</h4><p>${remaining} yanlış soru</p></div>${workLabel}</div>
        <div class="mistakes-ref-progress"><i style="width:${pct}%"></i><strong>%${pct}</strong></div>
        <div class="mistakes-ref-topic-stats">
          <span class="is-done">${svg('check')}<b>${completed}</b> Tamamlandı</span>
          <span class="is-left">${svg('book')}<b>${remaining}</b> Kalan</span>
          <span class="is-repeat">${svg('refresh')}<b>${repeat}</b> Tekrar</span>
        </div>
      </div>
    </article>`;
  }).join('');

  return `<section class="screen content-screen mistakes-screen mistakes-reference" aria-label="Yanlışlarım">
    <header class="mistakes-ref-heading"><div class="mistakes-ref-heading-copy"><h2>Yanlışlarım</h2><p>Yaptığın hatalardan öğren,<br>her denemede daha güçlü ol.</p></div>${headingArt}</header>
    <article class="mistakes-ref-hero"><div class="mistakes-ref-hero-copy"><h3>Bugünün Yanlışları</h3><p>${repeatCount ? `Bugün tekrar zamanı gelen<br><strong>${repeatCount} soru</strong> seni bekliyor.` : 'Şu an tekrar bekleyen<br>yanlış sorun bulunmuyor.'}</p><button class="mistakes-ref-start" id="startWrongPoolButton" type="button" ${repeatCount ? '' : 'disabled'}><span class="mistakes-ref-start-play" aria-hidden="true"></span>Gözden Geçir</button></div>${heroArt}</article>
    <section class="mistakes-ref-metrics" aria-label="Yanlış soru özeti">
      <article class="mistakes-ref-metric metric-wrong"><span class="mistakes-ref-metric-icon">${metricWrongIcon}</span><div><small>Toplam Yanlış</small><span class="mistakes-ref-metric-value"><strong>${totalWrongCount}</strong><em>Soru</em></span></div></article>
      <article class="mistakes-ref-metric metric-repeat"><span class="mistakes-ref-metric-icon">${metricRepeatIcon}</span><div><small>Tekrar Bekleyen</small><span class="mistakes-ref-metric-value"><strong>${repeatCount}</strong><em>Soru</em></span></div></article>
    </section>
    <section class="mistakes-ref-topics" aria-label="Konu bazlı yanlışlar">${categoryHtml || '<div class="mistakes-ref-empty">Henüz yanlış yaptığın bir soru yok.</div>'}</section>
  </section>`;
}

function openMistakeCategorySheet(categoryKey) {
  clearInterval(timerInterval);
  timerInterval = null;
  closeAllSheets(topicSheet);
  topicSheet.classList.add('open');
  topicSheet.setAttribute('aria-hidden', 'false');
  topicBackdrop.classList.add('open');
  renderMistakeCategoryLevel(categoryKey);
}

function renderMistakeCategoryLevel(categoryKey) {
  resetSheetClasses();
  const meta = mistakeCategoryMeta(categoryKey);
  const docs = getMistakeDocuments(categoryKey);
  const total = docs.reduce((sum, d) => sum + d.questions.length, 0);
  applySheetHeader({ title: meta.title, subtitle: `${total} yanlış soru`, eyebrow: 'YANLIŞLARIM', icon: meta.icon, iconClass: meta.iconClass });
  topicBreadcrumbWrap.innerHTML = '';
  setSheetProgress(`${docs.length} konu`, 0);
  if (!docs.length) {
    topicList.innerHTML = `<div class="empty-inline">Bu kategoride yanlış sorun yok.</div>`;
    topicSheet.scrollTop = 0;
    return;
  }
  topicList.innerHTML = docs.map((doc, index) => `
    <article class="topic-item" data-mistake-doc-index="${index}" role="button" tabindex="0">
      <div class="topic-number">${String(index + 1).padStart(2, '0')}</div>
      <div class="topic-copy"><h4>${escapeHtml(doc.documentTitle)}</h4><p>${doc.questions.length} yanlış soru</p></div>
      <div class="topic-arrow">${svg('arrow')}</div>
    </article>`).join('');
  topicList.querySelectorAll('[data-mistake-doc-index]').forEach(element => {
    const open = () => renderMistakeDocument(categoryKey, docs[Number(element.dataset.mistakeDocIndex)]);
    element.addEventListener('click', open);
    element.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') open(); });
  });
  topicSheet.scrollTop = 0;
}

function renderMistakeDocument(categoryKey, doc) {
  topicSheet.classList.add('document-flow');
  const meta = mistakeCategoryMeta(categoryKey);
  applySheetHeader({ title: doc.documentTitle, subtitle: `${doc.questions.length} yanlış soru`, eyebrow: 'YANLIŞLARIM', icon: 'book', iconClass: meta.iconClass });
  renderBreadcrumb(meta.title, () => renderMistakeCategoryLevel(categoryKey));
  setSheetProgress(`${doc.questions.length} soru`, 0);
  topicList.innerHTML = `
    <button class="reader-primary" id="startMistakeDocButton" type="button" style="width:100%;margin-bottom:14px">Bu konudaki ${doc.questions.length} soruyu çöz</button>
    <div class="quiz-result-list">
      ${doc.questions.map((q, idx) => mistakeItemHTML(q, idx)).join('')}
    </div>`;
  document.getElementById('startMistakeDocButton').addEventListener('click', () => startMistakeDocumentQuiz(categoryKey, doc));
  topicSheet.scrollTop = 0;
}

function startMistakeDocumentQuiz(categoryKey, doc) {
  if (!doc.questions.length) return showToast('Bu konuda tekrar edilecek soru yok.');
  startQuiz({
    questions: doc.questions,
    kind: 'wrong-group',
    title: doc.documentTitle,
    subtitle: `${doc.questions.length} soru • tekrar`,
    returnView: () => renderMistakeCategoryLevel(categoryKey)
  });
}

function startWrongPool() {
  const questions = Object.values(progress.wrongQuestions);
  if (!questions.length) return showToast('Tekrar edilecek soru yok.');
  closeAllSheets(topicSheet);
  topicSheet.classList.add('open');
  topicSheet.setAttribute('aria-hidden', 'false');
  topicBackdrop.classList.add('open');
  startQuiz({
    questions,
    kind: 'wrong-pool',
    title: 'Yanlışlarım',
    subtitle: `${questions.length} soru • tekrar havuzu`,
    returnView: closeTopicSheet
  });
}

// --- BİLGİ KARTLARI (KARTLARIM) EKRANLARI ---
function cardDeckCompletionKey(docId) {
  return `card-deck:${docId}`;
}

function isCardDeckCompleted(doc) {
  return Boolean(doc?.id && progress.completedSections?.[cardDeckCompletionKey(doc.id)]);
}

function markCardDeckCompleted(doc) {
  if (!doc?.id || isCardDeckCompleted(doc)) return;
  window.SRProgressSync.setKey(progress, 'completedSections', cardDeckCompletionKey(doc.id), new Date().toISOString());
  saveProgress({ rerender: false });
}

function cardsView() {
  const catalogue = getCardCatalogue();
  const presentation = {
    'general-legislation': { title: 'Genel Mevzuat', icon: 'scale', tone: 'red' },
    'meb-legislation': { title: 'MEB Mevzuatı', icon: 'schoolbook', tone: 'blue' },
    'general-culture': { title: 'Ortak Alan Bilgisi', icon: 'landmark', tone: 'violet' }
  };
  const keys = ['general-legislation', 'meb-legislation', 'general-culture'];
  const rows = keys.map(key => {
    const meta = catalogue[key];
    const design = presentation[key];
    const documents = meta?.documents || [];
    const activeDocuments = documents.filter(doc => doc.topicId || doc.cardFile);
    const activeCount = activeDocuments.length;
    const totalCount = documents.length;
    const completedCount = activeDocuments.filter(isCardDeckCompleted).length;
    const remainingCount = Math.max(0, activeCount - completedCount);
    const pct = activeCount ? Math.round((completedCount / activeCount) * 100) : 0;
    return { key, meta, design, documents, activeCount, totalCount, completedCount, remainingCount, pct };
  });

  const totalSets = rows.reduce((sum, row) => sum + row.totalCount, 0);
  const dueCount = Number(state.totalDueFlashcards || 0);
  const heroTitle = 'Akıllı Tekrar';
  const heroText = dueCount > 0
    ? `Tekrar zamanı gelen ${dueCount} kartını öncelik sırasına göre hızlıca gözden geçir.`
    : 'Şu anda tekrarı gelen kartın yok. Kart setlerinden çalışmaya devam ederek tekrar planını oluştur.';

  const metricsHtml = `
    <div class="cards-dashboard-metrics">
      <article class="cards-dashboard-metric">
        <div class="cards-dashboard-metric-icon metric-blue">${svg('schoolbook')}</div>
        <div><span>Toplam Kart Seti</span><strong>${totalSets}</strong></div>
      </article>
      <article class="cards-dashboard-metric">
        <div class="cards-dashboard-metric-icon metric-red">${svg('refresh')}</div>
        <div><span>Tekrar Bekleyen</span><strong>${dueCount}</strong></div>
      </article>
    </div>`;

  return `<section class="screen content-screen cards-dashboard" aria-label="Kartlarım">
    <header class="cards-dashboard-heading">
      <h2>Kartlarım</h2>
      <p>Konu kartlarıyla bilgini pekiştir, hedeflerine daha hızlı ulaş.</p>
      <div class="cards-dashboard-mark" aria-hidden="true">
        <span></span><span></span><span>${svg('schoolbook')}</span>
      </div>
    </header>

    <article class="cards-smart-review${dueCount ? '' : ' is-empty'}">
      <div class="cards-smart-copy">
        <h3>${heroTitle}</h3>
        <p>${heroText}</p>
        <button class="cards-smart-start" id="openDueFlashcardsButton" type="button" ${dueCount ? '' : 'disabled'}>
          <span class="cards-smart-play" aria-hidden="true"></span>
          <span>${dueCount ? 'Tekrara Başla' : 'Tekrar Yok'}</span>
        </button>
      </div>
      <div class="cards-smart-art" aria-hidden="true">
        <div class="smart-review-emblem">
          <span class="smart-review-book">${svg('schoolbook')}</span>
          <span class="smart-review-loop smart-review-loop-a">${svg('refresh')}</span>
          <span class="smart-review-loop smart-review-loop-b">${svg('refresh')}</span>
        </div>
      </div>
    </article>

    ${metricsHtml}

    <div class="cards-set-list">
      ${rows.map(row => `<article class="cards-set-card" data-open-card-category="${row.key}" role="button" tabindex="0" aria-label="${escapeHtml(row.design.title)}">
        <div class="cards-set-icon tone-${row.design.tone}">${svg(row.design.icon)}</div>
        <div class="cards-set-main">
          <div class="cards-set-title-row">
            <div><h4>${escapeHtml(row.design.title)}</h4><span>${row.totalCount} kart seti</span></div>
            <button class="cards-set-work" type="button" tabindex="-1"><span class="cards-set-play"></span>Çalış</button>
          </div>
          <div class="cards-set-progress-row"><div class="cards-set-track"><i style="width:${row.pct}%"></i></div><strong>%${row.pct}</strong></div>
          <div class="cards-set-meta"><span class="meta-active">${svg('check')}<b>${row.completedCount}</b> Tamamlandı</span><span class="meta-divider"></span><span>${svg('book')}<b>${row.remainingCount}</b> Kalan</span></div>
        </div>
      </article>`).join('')}
    </div>
  </section>`;
}

function openCardCategorySheet(categoryKey) {
  const category = getCardCatalogue()[categoryKey];
  if (!category) return showToast('Kategori bulunamadı.');
  clearInterval(timerInterval);
  timerInterval = null;
  closeAllSheets(topicSheet);
  topicSheet.classList.add('open');
  topicSheet.setAttribute('aria-hidden', 'false');
  topicBackdrop.classList.add('open');
  renderCardCategoryLevel(categoryKey);
}

function renderCardCategoryLevel(categoryKey) {
  const category = getCardCatalogue()[categoryKey];
  resetSheetClasses();
  applySheetHeader({ title: category.title, subtitle: 'Çalışmak istediğin kaynağı seç.', eyebrow: 'BİLGİ KARTLARI', icon: category.icon, iconClass: category.iconClass });
  topicBreadcrumbWrap.innerHTML = '';
  setSheetProgress('Bir kaynak seç', 0);
  if (!category.documents.length) {
    topicList.innerHTML = `<section class="empty-state content-plan"><span class="empty-state-icon">${svg('book')}</span><h3>Bu kategori için kart seti hazırlanıyor</h3><p>Kaynaklar eklendiğinde burada otomatik olarak görünecek.</p></section>`;
    topicSheet.scrollTop = 0;
    return;
  }
  topicList.innerHTML = category.documents.map((doc, index) => {
    const active = doc.topicId || doc.cardFile;
    const info = active ? 'Aktif kart seti' : 'Yakında eklenecek';
    return `<article class="topic-item ${active ? '' : 'is-disabled'}" data-card-doc-index="${index}" role="button" tabindex="0">
      <div class="topic-number">${String(index + 1).padStart(2, '0')}</div>
      <div class="topic-copy"><h4>${escapeHtml(doc.title)}</h4><p class="topic-due-info">${info}</p></div>
      <div class="topic-arrow">${svg('arrow')}</div>
    </article>`;
  }).join('');
  topicList.querySelectorAll('[data-card-doc-index]').forEach(element => {
    const open = () => {
      const doc = category.documents[Number(element.dataset.cardDocIndex)];
      if (!doc.topicId && !doc.cardFile) return showToast('Bu kaynak için kart seti henüz eklenmedi.');
      openCardDeck(doc, categoryKey);
    };
    element.addEventListener('click', open);
    element.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') open(); });
  });
  topicSheet.scrollTop = 0;

  // Faz 4: her gerçek flashcard destesi (cardFile) için "bugün N kart tekrar"
  // rozetini asenkron doldur — deste listesi kendisi senkron render edildi,
  // rozetler geldiğinde ilgili satırın alt metnini günceller.
  const flashcardDocs = category.documents
    .map((doc, index) => ({ doc, index }))
    .filter(({ doc }) => doc.cardFile);
  if (flashcardDocs.length && window.currentUser) {
    ContentRepo.fetchDueFlashcardCounts(flashcardDocs.map(({ doc }) => doc.id))
      .then(counts => {
        flashcardDocs.forEach(({ doc, index }) => {
          const due = counts[doc.id] || 0;
          if (!due) return;
          const el = topicList.querySelector(`[data-card-doc-index="${index}"] .topic-due-info`);
          if (el) el.textContent = `Bugün tekrar: ${due} kart`;
        });
      })
      .catch(() => {}); // sessizce geç — rozet süsleme, kritik değil
  }
}

async function loadCardDeck(doc) {
  if (cardDecks.has(doc.id)) return cardDecks.get(doc.id);
  let cards;
  let totalCount;
  let progressMap = {};
  let isRealFlashcardDeck = false;
  if (doc.topicId) {
    const data = await ContentRepo.fetchCardsByTopicId(doc.topicId);
    cards = Array.isArray(data.cards) ? data.cards : [];
    // totalCount RPC'den (get_topic_card_preview) geliyor — free kullanıcı
    // için satır sayısıyla (5) aynı olmayabilir, "X kart daha var" upsell'i
    // bu farktan tetiklenir (flashcard destelerindeki mantığın aynısı).
    totalCount = typeof data.totalCount === 'number' ? data.totalCount : cards.length;
  } else if (doc.cardFile) {
    isRealFlashcardDeck = true;
    const data = await ContentRepo.fetchFlashcardsByPath(doc.cardFile);
    cards = Array.isArray(data.cards) ? data.cards : [];
    // RLS ücretsiz kullanıcıya sadece ilk 5 kartı döner; totalCount gerçek
    // deste boyutunu (get_flashcard_count RPC'siyle) taşır — aradaki fark
    // varsa "X kart daha premium'da" mesajı göstereceğiz.
    totalCount = typeof data.totalCount === 'number' ? data.totalCount : cards.length;
    // Leitner tekrar takibi: sadece gerçek flashcards.id'si olan (questions'tan
    // türetilmemiş) kartlarda mümkün. Giriş yapmamış kullanıcı için boş kalır,
    // bu durumda kartlar normal karışık sırayla gösterilir (aşağıya bakınız).
    try {
      progressMap = await ContentRepo.fetchFlashcardProgress(doc.id);
    } catch (error) {
      progressMap = {}; // ilerleme çekilemezse sessizce normal moda düş
    }
  } else {
    throw new Error('Bu kaynak için kart seti henüz eklenmedi.');
  }
  const result = { cards, totalCount, progressMap, isRealFlashcardDeck };
  cardDecks.set(doc.id, result);
  return result;
}

async function openCardDeck(doc, categoryKey) {
  // Standart: tüm kart kaynakları (flashcard destesi ya da soru bankasından
  // türetilen) artık doc.free === true — sunucu tarafı (RLS / RPC) zaten
  // ücretsiz kullanıcıya sadece ilk 5 kartı döndürüyor, gerisi için
  // "Premium'a Geç" kartı ekleniyor. Bu satır yine de bir güvenlik ağı: doc.free
  // yanlışlıkla false gelirse önden keser.
  if (!doc.free && !requirePremiumOrWarn()) return;
  try {
    showToast('Kartlar hazırlanıyor…');
    const { cards, totalCount, progressMap, isRealFlashcardDeck } = await loadCardDeck(doc);
    if (!cards.length) return showToast('Bu kaynak için henüz kart bulunmuyor.');
    let ordered;
    if (isRealFlashcardDeck && Object.keys(progressMap).length) {
      // Leitner: tekrarı gelmiş (next_review_at geçmişte/şimdi) kartlar önce,
      // sonra hiç görülmemiş kartlar, sonra henüz tekrar zamanı gelmemişler.
      const now = Date.now();
      const withMeta = cards.map(card => {
        const progress = progressMap[card.id];
        const dueTime = progress ? new Date(progress.next_review_at).getTime() : -1; // hiç görülmemiş = en öncelikli
        return { card, dueTime, seen: !!progress };
      });
      withMeta.sort((a, b) => {
        const aDue = !a.seen || a.dueTime <= now;
        const bDue = !b.seen || b.dueTime <= now;
        if (aDue !== bDue) return aDue ? -1 : 1;
        return a.dueTime - b.dueTime;
      });
      ordered = withMeta.map(x => x.card);
    } else {
      ordered = shuffle(cards);
    }
    if (totalCount > cards.length) {
      ordered.push({ upsell: true, remaining: totalCount - cards.length });
    }
    state.cardStudy = { doc, categoryKey, cards: ordered, index: 0, flipped: false, seenIndices: new Set(), progressMap: progressMap || {}, isRealFlashcardDeck };
    renderCardStudy();
  } catch (error) {
    showToast(error.message || 'Kartlar yüklenemedi.');
  }
}

function invalidateDueFlashcardCache() {
  state.dueFlashcardsCache = null;
  state.dueFlashcardsPromise = null;
}

function prefetchDueFlashcards({ force = false } = {}) {
  if (!window.currentUser) return Promise.resolve([]);
  if (!force && Array.isArray(state.dueFlashcardsCache)) return Promise.resolve(state.dueFlashcardsCache);
  if (!force && state.dueFlashcardsPromise) return state.dueFlashcardsPromise;

  const request = ContentRepo.fetchDueFlashcards()
    .then(due => {
      state.dueFlashcardsCache = Array.isArray(due) ? due : [];
      return state.dueFlashcardsCache;
    })
    .finally(() => {
      if (state.dueFlashcardsPromise === request) state.dueFlashcardsPromise = null;
    });

  state.dueFlashcardsPromise = request;
  return request;
}

// Ana ekrandaki "N kart tekrar" sayacını yeniden hesaplar (tekrar oturumu
// bittikten sonra sayının güncel kalması için). flashcardDecks state'te hazır.
function refreshDueFlashcardCount() {
  invalidateDueFlashcardCache();
  const role = progress.selectedRole;
  const decks = (state.flashcardDecks || []).filter(d => !role || !d.kadrolar || d.kadrolar.includes(role));
  if (!window.currentUser || !decks.length) { state.totalDueFlashcards = 0; if (state.view === 'home' || state.view === 'cards') render(); return; }
  ContentRepo.fetchDueFlashcardCounts(decks.map(d => d.id))
    .then(counts => {
      state.totalDueFlashcards = Object.values(counts).reduce((sum, n) => sum + n, 0);
      syncLocalNotificationSchedule();
      if (state.totalDueFlashcards > 0) prefetchDueFlashcards().catch(() => {});
      if (state.view === 'home' || state.view === 'cards') render();
    })
    .catch(() => {});
}

// "Bugün N kart tekrar seni bekliyor" butonu buraya bağlıdır. Tüm flashcard
// destelerinde tekrarı gelmiş kartları toplayıp TEK bir oturum olarak açar
// (Leitner sırasıyla: en geride kalmış tekrar önce). Kartlar farklı destelerden
// gelebildiği için her kart kendi deckId'sini taşır; puanlama onu kullanır.
async function openDueReviewSession() {
  if (!window.currentUser) return showToast('Tekrar için giriş yapmalısın.');
  try {
    const prefetched = Array.isArray(state.dueFlashcardsCache);
    if (!prefetched) showToast('Tekrar kartların hazırlanıyor…');
    const due = await prefetchDueFlashcards();
    if (!due.length) {
      showToast('Şu an tekrarı gelen kart yok. 👍');
      state.totalDueFlashcards = 0;
      if (state.view === 'home' || state.view === 'cards') render();
      return;
    }
    // progressMap: puanlama öncesi mevcut kutu/tarih bilgisi kart id'siyle
    const progressMap = {};
    due.forEach(c => { if (c.progress) progressMap[c.id] = c.progress; });
    // Sanal deste: tek bir kategori/doc yok. categoryKey bilinçli olarak null —
    // renderCardStudy ve exitCardStudy bunu "karışık oturum" olarak ele alır.
    const virtualDoc = { id: null, title: 'Bugünün Tekrarı' };
    const cards = due.map(c => ({ id: c.id, question: c.question, answer: c.answer, deckId: c.deckId }));
    closeAllSheets(topicSheet);
    topicSheet.classList.add('open');
    topicSheet.setAttribute('aria-hidden', 'false');
    topicBackdrop.classList.add('open');
    state.cardStudy = { doc: virtualDoc, categoryKey: null, cards, index: 0, flipped: false, seenIndices: new Set(), progressMap, isRealFlashcardDeck: true };
    renderCardStudy();
  } catch (error) {
    showToast(error.message || 'Tekrar kartları yüklenemedi.');
  }
}

// Kart çalışma oturumundan çıkış. Normal deste oturumunda kategori listesine
// döner; karışık "Bugünün Tekrarı" oturumunda (categoryKey yok) sheet'i kapatır.
function exitCardStudy(study) {
  state.cardStudy = null;
  topicSheet.classList.remove('card-study-active');
  if (study && study.categoryKey) {
    renderCardCategoryLevel(study.categoryKey);
  } else {
    closeAllSheets(topicSheet);
  }
}

function renderCardStudy() {
  const study = state.cardStudy;
  if (!study) return;
  topicSheet.classList.add('document-flow', 'card-study-active');
  topicSheet.classList.remove('quiz-active');
  // Karışık "Bugünün Tekrarı" oturumunda tek bir kategori yok; güvenli bir
  // varsayılan başlık kullanılır. Normal deste oturumunda kategori bulunur.
  const category = getCardCatalogue()[study.categoryKey] || { title: study.doc?.title || 'Bugünün Tekrarı', iconClass: 'accent' };
  const current = study.cards[study.index];

  if (current.upsell) {
    applySheetHeader({ title: study.doc.title, subtitle: 'Premium içerik', eyebrow: 'BİLGİ KARTLARI', icon: 'gavel', iconClass: category.iconClass });
    renderBreadcrumb(category.title, () => { exitCardStudy(study); });
    setSheetProgress('', 100);
    topicList.innerHTML = `
      <div class="card-study-wrap">
        <div class="empty-state content-plan" style="padding:32px 20px">
          <span class="empty-state-icon">${svg('lock')}</span>
          <h3>${current.remaining} kart daha var</h3>
          <p>Bu destenin ilk 5 kartı ücretsiz. Kalan ${current.remaining} kartı görmek için premium üyeliğe geç.</p>
          <div class="premium-purchase-options" style="display:flex; flex-direction:column; gap:10px; margin-top:16px">
            <button class="premium-buy-btn" type="button" data-product-id="premium_1ay" data-label="1 Ay" data-fallback-price="249₺">
              <span class="premium-btn-label">1 Ay</span>
              <span class="premium-btn-price">249₺</span>
            </button>
            <button class="premium-buy-btn" type="button" data-product-id="premium_2ay" data-label="2 Ay" data-fallback-price="449₺">
              <span class="premium-btn-label">2 Ay</span>
              <span class="premium-btn-price">449₺</span>
            </button>
            <button class="premium-buy-btn featured" type="button" data-product-id="premium_3ay" data-label="3 Ay" data-fallback-price="599₺">
              <span class="premium-btn-label">3 Ay <span class="premium-btn-badge">En avantajlı</span></span>
              <span class="premium-btn-price">599₺</span>
            </button>
          </div>
        </div>
        <div class="card-study-nav">
          <button class="card-nav-btn" id="cardPrevButton" type="button">${svg('arrowLeft')}</button>
          <span class="card-nav-count">${study.index + 1} / ${study.cards.length}</span>
          <button class="card-nav-btn" id="cardNextButton" type="button" disabled>${svg('arrowRight')}</button>
        </div>
      </div>`;
    document.querySelectorAll('.premium-buy-btn').forEach((btn) => {
      btn.addEventListener('click', () => purchasePremiumProduct(btn.dataset.productId, btn));
    });
    updatePremiumButtonPrices();
    document.getElementById('cardPrevButton')?.addEventListener('click', () => {
      if (study.index > 0) { study.index -= 1; study.flipped = false; renderCardStudy(); }
    });
    topicSheet.scrollTop = 0;
    return;
  }

  applySheetHeader({ title: study.doc.title, subtitle: `${study.index + 1} / ${study.cards.length}`, eyebrow: 'BİLGİ KARTLARI', icon: 'gavel', iconClass: category.iconClass });
  renderBreadcrumb(category.title, () => { exitCardStudy(study); });
  setSheetProgress('', Math.round(((study.index + 1) / study.cards.length) * 100));
  // Leitner puanlama butonları: sadece gerçek flashcard destesinde, kullanıcı
  // giriş yapmışsa ve kart geri çevrilmişse gösterilir. topicId'den (quiz-derived)
  // gelen kartlarda stabil bir flashcards.id olmadığı için gösterilmez.
  const canRate = study.isRealFlashcardDeck && window.currentUser && current.id != null;
  const ratingHtml = (study.flipped && canRate) ? `
      <div class="card-rating-row" role="group" aria-label="Bu kartı ne kadar bildin?">
        <button class="card-rating-btn card-rating-zor" type="button" data-rating="zor">Zor</button>
        <button class="card-rating-btn card-rating-orta" type="button" data-rating="orta">Orta</button>
        <button class="card-rating-btn card-rating-kolay" type="button" data-rating="kolay">Kolay</button>
      </div>` : '';
  topicList.innerHTML = `
    <div class="card-study-wrap">
      <div class="flip-card ${study.flipped ? 'flipped' : ''}" id="flipCard">
        <div class="flip-card-inner">
          <div class="flip-card-face flip-card-front">
            <span class="flip-card-label">${escapeHtml(category.title)}</span>
            <span class="flip-card-q-mark">?</span>
            <p class="flip-card-text">${escapeHtml(current.question)}</p>
            <span class="flip-card-hint">Kartı çevirmek için tıkla</span>
          </div>
          <div class="flip-card-face flip-card-back">
            <p class="flip-card-text">${escapeHtml(current.answer)}</p>
            <span class="flip-card-hint">${canRate ? 'Ne kadar bildiğini işaretle' : 'Kartı geri çevirmek için tıkla'}</span>
          </div>
        </div>
      </div>
      ${ratingHtml}
      <div class="card-study-nav">
        <button class="card-nav-btn" id="cardPrevButton" type="button" ${study.index === 0 ? 'disabled' : ''}>${svg('arrowLeft')}</button>
        <span class="card-nav-count">${study.index + 1} / ${study.cards.length}</span>
        <button class="card-nav-btn" id="cardNextButton" type="button" ${study.index === study.cards.length - 1 ? 'disabled' : ''}>${svg('arrowRight')}</button>
      </div>
    </div>`;
  document.getElementById('flipCard').addEventListener('click', () => {
    const revealingAnswer = !study.flipped;
    study.flipped = !study.flipped;
    if (revealingAnswer) {
      if (!(study.seenIndices instanceof Set)) study.seenIndices = new Set();
      study.seenIndices.add(study.index);
      const hasUpsell = study.cards.some(card => card?.upsell);
      const realCardCount = study.cards.filter(card => !card?.upsell).length;
      if (study.categoryKey && study.doc?.id && !hasUpsell && study.seenIndices.size >= realCardCount) {
        markCardDeckCompleted(study.doc);
      }
    }
    haptic(12);
    renderCardStudy();
  });
  document.getElementById('cardPrevButton')?.addEventListener('click', () => {
    if (study.index > 0) { study.index -= 1; study.flipped = false; renderCardStudy(); }
  });
  document.getElementById('cardNextButton')?.addEventListener('click', () => {
    if (study.index < study.cards.length - 1) { study.index += 1; study.flipped = false; renderCardStudy(); }
  });
  document.querySelectorAll('.card-rating-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const rating = btn.dataset.rating;
      const priorProgress = study.progressMap[current.id];
      haptic(16);
      try {
        const deckIdForRating = current.deckId || study.doc.id;
        const updated = await ContentRepo.rateFlashcard(current.id, deckIdForRating, rating, priorProgress);
        if (updated) {
          study.progressMap[current.id] = updated;
          invalidateDueFlashcardCache();
        }
      } catch (error) {
        showToast('Tekrar durumu kaydedilemedi, ama devam edebilirsin.');
      }
      if (study.index < study.cards.length - 1) {
        study.index += 1;
        study.flipped = false;
        renderCardStudy();
      } else {
        showToast(study.categoryKey ? 'Bu desteyi bitirdin! 🎉' : 'Bugünün tekrarını tamamladın! 🎉');
        const wasDueSession = !study.categoryKey;
        exitCardStudy(study);
        // Karışık tekrar oturumu bittiyse home'daki "N kart" sayacını tazele.
        if (wasDueSession) { refreshDueFlashcardCount(); }
      }
    });
  });
  topicSheet.scrollTop = 0;
}

// Profil ekranındaki "BİLDİRİMLER" kartı — mevcut .profile-goal-card görsel
// dilini kullanır. Tercihler progress.notificationPrefs'te tutulur (bkz.
// setNotificationPref/setReminderTime); gerçek cihaz bildirimi zamanlaması
// syncLocalNotificationSchedule() üzerinden native tarafa devredilir.
function renderNotificationSettingsCard() {
  const prefs = progress.notificationPrefs || DEFAULT_NOTIFICATION_PREFS;
  const toggleRow = (key, label, desc) => `
    <div class="notif-row">
      <div><div class="notif-row-title">${escapeHtml(label)}</div><div class="notif-row-desc">${escapeHtml(desc)}</div></div>
      <button type="button" class="notif-switch${prefs[key] ? ' on' : ''}" data-notif-pref="${key}" role="switch" aria-checked="${prefs[key] ? 'true' : 'false'}" aria-label="${escapeHtml(label)}"><i></i></button>
    </div>`;
  return `<section class="profile-goal-card">
    <div class="profile-goal-head"><span>BİLDİRİMLER</span></div>
    <p class="profile-goal-desc">Günlük çalışma hatırlatıcını aç, kapat veya saatini değiştir.</p>
    ${toggleRow('dailyReminder', 'Günlük çalışma hatırlatıcısı', 'Seçtiğin saatte, her gün')}
    <div class="notif-time-row">
      <span class="notif-time-label">Hatırlatma saati</span>
      <input type="time" id="notifReminderTimeInput" class="notif-time-input" lang="tr-TR" value="${escapeHtml(prefs.reminderTime || '20:00')}" aria-label="Hatırlatma saati">
    </div>
  </section>`;
}

// Ad Soyad'ın baş harflerinden avatar için iki harf üretir (ör. "Sait Yıldırım" -> S, Y).
// Tek kelimelik isimlerde (ör. sadece email'den türetilen ad) ikinci harf boş kalır.
// Header'daki kadro rozetinin yerini alan günlük motivasyon sözleri.
// Asıl kaynak Supabase (app_settings.motivational_phrases) — admin panelden
// mağaza onayı beklemeden güncellenebilsin diye. Bu dizi SADECE ağ isteği
// henüz dönmediğinde veya başarısız olduğunda kullanılan yerel yedektir.
const MOTIVATIONAL_PHRASES_FALLBACK = [
  'Bugün 1 adım daha!',
  'Az kaldı, devam et!',
  'Sen yapabilirsin!',
  'Her soru seni güçlendirir.',
  'Hedefine kilitlen!',
  'Bugün de çalış, yarın kazan.',
  'İstikrar kazandırır.',
  'Bir soru daha, bir adım daha.',
  'Pes etme, devam et!',
  'Bugün formundasın!',
  'Küçük adımlar, büyük başarı.',
  'Kendine güven!',
  'Bugün senin günün.',
  'Disiplin, başarıyı getirir.',
  'Şimdi çalış, sonra kutla.'
];
let motivationalPhrasesCache = null; // Supabase'den geldiyse dolu; yoksa null -> yedek kullanılır.

// Supabase'deki app_settings.motivational_phrases satırını çeker (admin panelde
// "Ayarlar" sekmesinden yönetiliyor; JSON dizi olarak text/jsonb kolonda tutuluyor).
// Ağ hatasında veya satır boşsa sessizce yerel yedeğe düşer, uygulamayı bozmaz.
async function loadMotivationalPhrases() {
  try {
    const { data, error } = await supabaseClient
      .from('app_settings')
      .select('value')
      .eq('key', 'motivational_phrases')
      .maybeSingle();
    if (error || !data?.value) return;
    const parsed = JSON.parse(data.value);
    if (Array.isArray(parsed) && parsed.length) {
      motivationalPhrasesCache = parsed;
      if (state.view === 'home') updateHeader();
    }
  } catch (err) {
    console.error('Motivasyon sözleri alınamadı, yerel yedek kullanılıyor:', err);
  }
}

function getMotivationalPhrase() {
  const phrases = motivationalPhrasesCache || MOTIVATIONAL_PHRASES_FALLBACK;
  const dayIndex = Math.floor(Date.now() / 86400000);
  return phrases[dayIndex % phrases.length];
}

function getAvatarInitials(fullName) {
  const parts = (fullName || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { first: '?', second: '' };
  const first = parts[0].charAt(0).toUpperCase();
  const second = parts.length > 1 ? parts[parts.length - 1].charAt(0).toUpperCase() : '';
  return { first, second };
}

function profileView() {
  const stats = getStats();
  const user = window.currentUser;
  const fullName = user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'Aday';
  const email = user?.email || '';
  const { first: avatarFirst } = getAvatarInitials(fullName);
  const roleLabel = ROLES.find(r => r.key === progress.selectedRole)?.label || '';
  const badges = getBadges(stats);
  const prefs = progress.notificationPrefs || DEFAULT_NOTIFICATION_PREFS;
  const bell = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2a2 2 0 0 1 2 2v.35A6 6 0 0 1 18 10v4l2 3v1H4v-1l2-3v-4a6 6 0 0 1 4-5.65V4a2 2 0 0 1 2-2Z"/><path d="M9 20h6a3 3 0 0 1-6 0Z"/></svg>';
  return `<section class="screen content-screen profile-final">
    <header class="pv-hero">
      <svg class="pv-landscape" viewBox="0 0 940 280" preserveAspectRatio="none" aria-hidden="true"><path d="M0 0H940V280H0Z" fill="#0b2348"/><path d="M0 0H940V72C823 12 815 115 709 78S493 155 336 170S105 189 0 45Z" fill="#17365e"/><path d="M0 0H76C129 75 242 89 428 0Z" fill="#264970" opacity=".35"/><path d="M0 48C174 231 281 178 439 153S653 54 743 82S858 27 940 60V280H0Z" fill="#102d54"/><path d="M0 217C233 178 342 178 492 128S712 96 940 179V280H0Z" fill="#071d40" opacity=".5"/><path d="M0 117L238 280H0Z" fill="#ad2b49"/><path d="M940 61C847 32 830 108 718 78S492 155 340 177" stroke="#345580" stroke-width="4" fill="none" opacity=".5"/></svg>
      <div class="pv-brand">Sınav<span>Rotası</span></div><span class="pv-tagline">Hedefine giden yol burada.</span>
      <svg class="pv-route" viewBox="0 0 180 92" fill="none" aria-hidden="true"><path d="M5 90C34 62 61 81 103 77C141 73 105 60 101 55C82 35 127 36 145 33C153 31 153 23 153 20" stroke="#f24056" stroke-width="2" stroke-dasharray="8 6"/><path d="M153 5C144 5 142 14 146 20L153 30L160 20C164 14 162 5 153 5Z" fill="#ef344d"/><circle cx="153" cy="14" r="3.5" fill="#18345c"/></svg>
    </header>
    <article class="pv-id"><div class="pv-avatar">${escapeHtml(avatarFirst)}</div><div class="pv-person"><strong>${escapeHtml(fullName)}</strong><span class="pv-email">${escapeHtml(email)}</span><button class="pv-role" id="changeRoleButton" type="button">${escapeHtml(roleLabel)}</button></div></article>
    <div class="pv-settings">
      <section class="pv-setting"><span class="pv-medallion">${svg('target')}</span><h3 class="pv-heading">GÜNLÜK ÇALIŞMA HEDEFİ</h3><p class="pv-desc">Her gün çözmek istediğin soru sayısını belirle, ana sayfadaki ilerleme halkası buna göre hesaplanır.</p><div class="pv-goal"><input id="profileDailyGoalInput" type="number" min="${DAILY_GOAL_MIN}" max="${DAILY_GOAL_MAX}" step="1" inputmode="numeric" value="${stats.dailyGoal}" aria-label="Günlük hedef soru sayısı"><button class="pv-save" id="profileDailyGoalSaveButton" type="button">Kaydet</button></div></section>
      <section class="pv-setting"><span class="pv-medallion">${bell}</span><h3 class="pv-heading">BİLDİRİMLER</h3><p class="pv-desc">Günlük çalışma hatırlatıcını aç, kapat veya saatini değiştir.</p><div class="pv-reminder"><div><strong>Günlük çalışma hatırlatıcısı</strong><small>Seçtiğin saatte, her gün</small></div><button class="notif-switch${prefs.dailyReminder ? ' on' : ''}" type="button" data-notif-pref="dailyReminder" role="switch" aria-checked="${prefs.dailyReminder ? 'true' : 'false'}" aria-label="Günlük çalışma hatırlatıcısı"><i></i></button></div><label class="pv-time" for="notifReminderTimeInput">Hatırlatma saati<input type="time" id="notifReminderTimeInput" lang="tr-TR" value="${escapeHtml(prefs.reminderTime || '20:00')}" aria-label="Hatırlatma saati"></label></section>
    </div>
    <section class="pv-badges"><div class="pv-badge-head"><strong>ROZETLERİM</strong></div><p>Çalışma alışkanlığın büyüdükçe yeni rozetler açılır.</p><div class="pv-badge-grid" id="profileBadgesGrid">${badges.map(badge => `<div class="badge-item${badge.unlocked ? ' unlocked' : ''}"><span class="badge-image-wrap"><img src="${badge.image}" alt="${escapeHtml(badge.label)}" class="badge-image" loading="eager"></span><small>${badge.unlocked ? escapeHtml(badge.label) : `${badge.value}/${badge.target} ${escapeHtml(badge.unit)}`}</small></div>`).join('')}</div></section>
    ${renderWeeklyFlowCard()}
    <div class="pv-sync">${svg('refresh')}<span>İstatistiklerin hesabına otomatik olarak senkronize ediliyor; başka bir cihazdan giriş yaptığında da seninle gelir.</span></div>
    <section class="pv-actions"><button class="reset-progress" id="resetProgressButton" type="button">${svg('refresh')}<span>İlerleme verisini sıfırla</span></button><button class="signout-btn" id="signOutButton" type="button">${svg('lock')}<span>Çıkış Yap</span></button></section>
    <a class="delete-account-link" id="deleteAccountLink" href="https://sinavrotasi.github.io/sinavrotasi-legal/hesapsilme.html" target="_blank" rel="noopener">Hesabımı silmek istiyorum</a>
  </section>`;
}

function render() {
  const views = { home: homeView, bank: bankView, mistakes: mistakesView, cards: cardsView, profile: profileView };
  const appHeader = document.querySelector('.app-header');
  if (appHeader) appHeader.classList.toggle('hidden', ['cards', 'bank', 'mistakes'].includes(state.view));
  app.innerHTML = (views[state.view] || homeView)();
  bindViewEvents();
  updateHeader();
}

function bindViewEvents() {
  if (state.catalogueError) document.getElementById('retryLoadButton')?.addEventListener('click', loadCatalogue);
  app.querySelectorAll('[data-open-category]').forEach(element => {
    element.addEventListener('click', () => openTopicSheet(element.dataset.openCategory));
    element.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') openTopicSheet(element.dataset.openCategory); });
  });
  app.querySelectorAll('[data-open-card-category]').forEach(element => {
    element.addEventListener('click', () => openCardCategorySheet(element.dataset.openCardCategory));
    element.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') openCardCategorySheet(element.dataset.openCardCategory); });
  });
  app.querySelectorAll('[data-stat-target]').forEach(element => element.addEventListener('click', () => window.go(element.dataset.statTarget)));
  
  // Rota panelini açma butonu
  document.getElementById('openRouteSheetButton')?.addEventListener('click', openRouteSheet);
  document.getElementById('openDueFlashcardsButton')?.addEventListener('click', openDueReviewSession);
  if (state.view === 'cards' && state.totalDueFlashcards > 0) {
    prefetchDueFlashcards().catch(() => {});
  }
  
  document.getElementById('startWrongPoolButton')?.addEventListener('click', startWrongPool);
  app.querySelectorAll('[data-open-mistake-category]').forEach(element => {
  element.addEventListener('click', () => openMistakeCategorySheet(element.dataset.openMistakeCategory));
  element.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') openMistakeCategorySheet(element.dataset.openMistakeCategory); });
    });
  document.getElementById('startKadroExamButton')?.addEventListener('click', startKadroExam);
  document.getElementById('startKadroExamTypeButton')?.addEventListener('click', startKadroExam);
  document.getElementById('startMiniExamButton')?.addEventListener('click', startQuickMiniExam);
  document.getElementById('startMixedExamButton')?.addEventListener('click', startMixedGeneralExam);
  document.getElementById('resetProgressButton')?.addEventListener('click', resetProgress);
  // O-02/O-08 (2026-09-15): Kadro bir kez seçilir ve sunucuda kilitlidir.
  // Profilden değiştirme yerine bilgilendirme gösterilir.
  document.getElementById('changeRoleButton')?.addEventListener('click', () => {
    showToast('Kadro seçimi sabittir. Değişiklik için bilgi.sinavrotasi@gmail.com adresine yazabilirsin.');
  });
  document.getElementById('signOutButton')?.addEventListener('click', async () => {
    await flushProgressSync();
    window.signOut();
  });

  const profileGoalInput = document.getElementById('profileDailyGoalInput');
  const profileGoalSaveButton = document.getElementById('profileDailyGoalSaveButton');
  profileGoalSaveButton?.addEventListener('click', () => { if (profileGoalInput) setDailyGoal(profileGoalInput.value); });
  profileGoalInput?.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); profileGoalSaveButton?.click(); } });
  // O-09 (2026-09-19): Kaydet'e basmadan boş bir alana dokunulduğunda input
  // focus'u bırakıyor ama native (Capacitor) klavyesi açık kalıyordu — çünkü
  // "Kaydet" ile kapanma aslında setDailyGoal() -> saveProgress() -> render()
  // zincirinin input'u DOM'dan tamamen kaldırmasının yan etkisiydi, kapanışı
  // sağlayan asıl bir eylem yoktu. clearSearchState()'teki gibi blur anında
  // native klavyeyi açıkça kapatıyoruz.
  profileGoalInput?.addEventListener('blur', () => {
    window.NativeUX?.hideKeyboard?.();
    document.body.classList.remove('keyboard-open');
    document.documentElement.style.setProperty('--keyboard-height', '0px');
  });

  // Bildirim tercihi anahtarları — tam re-render yerine sadece dokunulan
  // butonu güncelliyoruz ki dokunuş anında görsel geri bildirim gecikmesiz olsun.
  app.querySelectorAll('[data-notif-pref]').forEach(button => {
    button.addEventListener('click', () => {
      const key = button.dataset.notifPref;
      const next = !(progress.notificationPrefs?.[key]);
      setNotificationPref(key, next);
      button.classList.toggle('on', next);
      button.setAttribute('aria-checked', next ? 'true' : 'false');
    });
  });
  document.getElementById('notifReminderTimeInput')?.addEventListener('change', event => {
    setReminderTime(event.target.value);
  });
  bindWeeklyFlowEvents();

}

// Haftalık seçimler yalnızca kendi kartını günceller; rozet DOM'u korunur.
function bindWeeklyFlowEvents() {
  app.querySelectorAll('[data-flow-range]').forEach(button => {
    button.addEventListener('click', () => {
      if (state.weeklyFlowRange === button.dataset.flowRange) return;
      const card = button.closest('.profile-goal-card');
      if (!card) return;
      state.weeklyFlowRange = button.dataset.flowRange;
      state.weeklyFlowNote = '';
      const top = scrollArea.scrollTop;
      card.outerHTML = renderWeeklyFlowCard();
      bindWeeklyFlowEvents();
      scrollArea.scrollTop = top;
    });
  });
  app.querySelectorAll('[data-flow-bar]').forEach(button => {
    button.addEventListener('click', () => {
      const { bars } = getWeeklyFlowBars(state.weeklyFlowRange || 'week');
      const bar = bars[Number(button.dataset.flowBar)];
      if (!bar) return;
      state.weeklyFlowNote = bar.detail;
      const note = button.closest('.profile-goal-card')?.querySelector('.flow-note');
      if (note) note.textContent = bar.detail;
    });
  });
}

function updateHeader() {
  const stats = getStats();
  // Ana sayfa header'ındaki avatar: ad soyadın baş harfleri, seal-5 tasarımıyla
  // aynı dilde (beyaz çember + navy köşeli kare, döndürülmüş, yan yana harfler).
  const headerAvatarMark = document.getElementById('userAvatarMark');
  if (headerAvatarMark) {
    const headerFullName = window.currentUser?.user_metadata?.full_name || window.currentUser?.email?.split('@')[0] || '';
    const { first: headerAvatarFirst, second: headerAvatarSecond } = getAvatarInitials(headerFullName);
    const l1 = headerAvatarMark.querySelector('.avatar-letter-1');
    const l2 = headerAvatarMark.querySelector('.avatar-letter-2');
    if (l1) l1.textContent = headerAvatarFirst;
    if (l2) l2.textContent = headerAvatarSecond;
  }
  const days = stats.daysUntilExam;
  const examDays = document.getElementById('headerExamDays');
  if (examDays) {
    examDays.textContent = days === null ? '—' : days <= 0 ? (days === 0 ? 'BUGÜN' : 'TAMAMLANDI') : String(days);
    document.getElementById('headerExamUnit').textContent = days !== null && days <= 0 ? '' : 'GÜN';
    document.getElementById('headerExamLabel').textContent = days !== null && days <= 0 ? 'SINAV' : 'SINAVA KALAN SÜRE';
    const examMessageEl = document.getElementById('headerExamMessage');
    if (examMessageEl) examMessageEl.textContent = days === null || days <= 0 ? getExamCountdownMessage(days) : 'Her gün, daha güçlü bir sen.';
    const examDateEl = document.getElementById('headerExamDate');
    if (examDateEl) examDateEl.textContent = formatExamDate(getExamDate());
    // Buton index.html'den kaldırıldı — ana sayfadaki "Bugünkü Rota" CTA'sı
    // zaten aynı işlevi görüyor. Guard: eski/farklı bir header markup'unda
    // buton varsa yine çalışsın, yoksa (artık öyle) sessizce atlasın.
    const continueButton = document.getElementById('headerContinueButton');
    if (continueButton) continueButton.onclick = openRouteSheet;
  }
  // O-11 (2026-09-19): Kadro rozeti zaten profil ekranındaki
  // .profile-role-chip'te duruyor — header'da tekrarlamak yerine burada kısa,
  // motive edici bir söz gösteriyoruz. Her gün aynı söz kalsın diye (rastgele
  // her render'da değişip göz tırmalamasın) güne göre sabit seçiliyor.
  const roleBadge = document.getElementById('userRoleBadge');
  if (roleBadge) roleBadge.textContent = getMotivationalPhrase();

  // Seri şeridi (ana sayfa header'ındaki iki üst kartın altında) — index.html'de
  // #streakStrip yoksa bu blok tamamen no-op'tur, uygulamayı bozmaz.
  const streakStrip = document.getElementById('streakStrip');
  if (streakStrip) {
    const streakCountEl = document.getElementById('streakCount');
    const streakHeadlineEl = document.getElementById('streakHeadline');
    const streakSubEl = document.getElementById('streakSub');
    const streakDotsEl = document.getElementById('streakDots');
    const todayDone = stats.todayAnswers > 0;
    if (streakCountEl) streakCountEl.textContent = stats.streak;
    if (streakHeadlineEl && streakSubEl) {
      if (stats.streak === 0 && !todayDone) {
        streakHeadlineEl.textContent = 'Serine başla';
        streakSubEl.textContent = 'Bugün ilk sorunu çöz.';
      } else if (!todayDone) {
        streakHeadlineEl.textContent = 'Bugün 1 soru çöz';
        streakSubEl.textContent = 'Serini korumak için son şans.';
      } else if (stats.longestStreak > stats.streak) {
        streakHeadlineEl.textContent = 'Rekora yaklaşıyorsun';
        streakSubEl.textContent = `En uzun serin ${stats.longestStreak} gün — ${stats.longestStreak - stats.streak} gün kaldı.`;
      } else {
        streakHeadlineEl.textContent = 'Serini koru';
        streakSubEl.textContent = 'En uzun serin şu an bu.';
      }
    }
    if (streakDotsEl) {
      // getLast7DaysStreak() en eskiden en yeniye sıralı döner (bugün son
      // sırada). Kullanıcı "1. GÜN"ün bugün olmasını, serinin soldan
      // dolmasını istedi — bu yüzden ters çeviriyoruz: 1. GÜN = bugün,
      // 2. GÜN = dün, ... 7. GÜN = 6 gün önce.
      streakDotsEl.innerHTML = stats.streakDays.slice().reverse().map((day, i) => {
        const dotClass = `d${day.done ? ' on' : ''}${day.isToday ? ' today' : ''}`;
        const check = day.done ? `${svg('check')}` : '';
        const numClass = `d-num${day.isToday ? ' today' : ''}`;
        return `<div class="d-col"><div class="${dotClass}">${check}</div><span class="${numClass}">${i + 1}. GÜN</span></div>`;
      }).join('');
    }
  }

  const ring = document.getElementById('dailyGoalCircle');
  const percent = document.getElementById('dailyGoalPercent');
  const solved = document.getElementById('dailySolvedCount');
  const total = document.getElementById('dailyGoalTotal');
  const progressFill = document.getElementById('dailyProgressFill');
  const message = document.getElementById('dailyGoalMessage');
  if (!ring || !percent || !solved || !total || !progressFill) return;
  ring.setAttribute('stroke-dasharray', `${stats.dailyPercentage}, 100`);
  percent.textContent = `%${stats.dailyPercentage}`;
  solved.textContent = stats.todayAnswers;
  total.textContent = stats.dailyGoal;
  progressFill.style.width = `${stats.dailyPercentage}%`;
  if (message) message.textContent = stats.dailyPercentage >= 100 ? 'Günlük hedefini tamamladın. Harika iş!' : stats.todayAnswers ? 'Hedefine düzenli biçimde yaklaşıyorsun.' : 'İlk soruyla günlük hedefini başlat.';
}

async function resetProgress() {
  // O-10 (2026-09-15): Sıfırlama artık bir "dönem" (resetAt) başlatır.
  // Birleştirmede bu tarihten önceki çalışma verisi (sayaçlar, yanlışlar,
  // işaretler, testler) başka cihazlardan veya buluttan geri gelmez.
  // Kart (Leitner) ilerlemesi de sunucudan silinir. Kadro, günlük hedef ve
  // bildirim tercihleri korunur.
  if (!window.confirm('Tüm çalışma ilerlemen (bu cihazda ve hesabında; kart tekrarları dahil) sıfırlansın mı? Bu işlem geri alınamaz.')) return;
  const keep = {
    userId: progress.userId,
    selectedRole: progress.selectedRole,
    purchasedRoles: progress.purchasedRoles,
    dailyGoal: progress.dailyGoal,
    notificationPrefs: progress.notificationPrefs,
    fieldClocks: progress.fieldClocks
  };
  progress = { ...defaultProgress(), ...keep, resetAt: Date.now() };
  saveProgress();

  if (window.currentUser?.id) {
    const { error } = await supabaseClient
      .from('flashcard_progress')
      .delete()
      .eq('user_id', window.currentUser.id);
    if (error) {
      console.error('Kart ilerlemesi silinemedi:', error);
      showToast('Çalışma ilerlemen sıfırlandı; kart tekrarları silinemedi, tekrar dene.');
      return;
    }
    state.totalDueFlashcards = 0;
  }
  showToast('İlerleme verisi sıfırlandı.');
  render();
}

// --- ROTA PANELİ YÖNETİMİ ---
function openRouteSheet() {
  closeAllSheets(routeSheet);
  routeSheet.classList.add('open');
  topicBackdrop.classList.add('open');
}

function closeRouteSheet() {
  // GÜVENLİK KİLİDİ: Artık kendi başına yarım iş yapmıyor (sadece routeSheet +
  // şartlı backdrop), searchSheet'in durumunu hiç kontrol etmediği için
  // arkada arama açıkken backdrop'u yanlışlıkla kapatabiliyordu. closeAllSheets()
  // tüm panelleri ve backdrop'u tek seferde, birbirine göre tutarlı kapatır.
  closeAllSheets();
}

function updateRouteSummary() {
  startRouteButton.textContent = `${routeSettings.questions} Soruluk Rotayı Başlat`;
  if (routeSettings.time === 'Süresiz') {
    summaryDuration.textContent = 'Süresiz';
  } else {
    summaryDuration.textContent = `${routeSettings.questions} dakika`; // artık soru sayısı = dakika
  }
}

function bindRouteSheetEvents() {
  document.querySelectorAll('#modeGrid .mode-option').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#modeGrid .mode-option').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      routeSettings.mode = btn.dataset.mode;
      summaryMode.textContent = routeSettings.mode;
    });
  });

  document.querySelectorAll('#questionChoices .choice').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#questionChoices .choice').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      routeSettings.questions = Number(btn.dataset.questions);
      updateRouteSummary();
    });
  });

  document.querySelectorAll('#timeChoices .choice').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#timeChoices .choice').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      routeSettings.time = btn.dataset.time;
      updateRouteSummary();
    });
  });

  closeRouteSheetButton?.addEventListener('click', closeRouteSheet);
  
  startRouteButton?.addEventListener('click', () => {
    closeAllSheets();
    startSmartPractice();
  });
}

// --- ARAMA PANELİ YÖNETİMİ ---
function openSearchSheet() {
  searchScrollTop = scrollArea.scrollTop;
  closeAllSheets(searchSheet);
  clearSearchState({ dismissKeyboard: false, restoreScroll: false });
  // Not: input'a otomatik focus() ARTIK yapılmıyor, bu yüzden panel açılırken
  // klavye kendiliğinden açılmıyor. Kullanıcı input'a dokununca klavye normal
  // şekilde açılır.
  runSearch('');
}

function closeSearchSheet() {
  // X ve Android geri tuşu: açık tüm katmanları ve klavyeyi tek seferde kapatır.
  closeAllSheets();
}

function collectSearchIndex() {
  const index = [];
  getCategories().forEach(([categoryKey, category]) => {
    getCategoryItems(categoryKey).forEach(item => {
      index.push({ type: item.type, title: item.title, categoryKey, categoryTitle: category.title, item, icon: item.type === 'document' ? 'gavel' : 'book' });
      (item.children || []).forEach(section => {
        index.push({ type: 'section', title: section.title, categoryKey, categoryTitle: category.title, item, section, icon: 'gavel', context: item.title });
        (section.children || []).forEach(article => {
          const label = article.summary || article.title || '';
          if (label) index.push({ type: 'article', title: label, categoryKey, categoryTitle: category.title, item, section, article, icon: 'book', context: `${item.title} • ${section.title}` });
        });
      });
    });
  });
  return index;
}

function runSearch(query) {
  if (!state.catalogue) {
    searchResultsList.innerHTML = '<div class="empty-inline">İçerikler henüz yüklenmedi.</div>';
    return;
  }
  const trimmed = query.trim();
  if (trimmed.length < 2) {
    searchResultsList.innerHTML = '<div class="empty-inline">Aramak için en az 2 karakter yaz.</div>';
    return;
  }
  const needle = trimmed.toLocaleLowerCase('tr-TR');
  const results = collectSearchIndex().filter(entry => entry.title.toLocaleLowerCase('tr-TR').includes(needle)).slice(0, 30);
  searchResultsList.innerHTML = results.length ? results.map((result, index) => `
    <article class="topic-item" data-search-index="${index}" role="button" tabindex="0">
      <div class="topic-number">${svg(result.icon)}</div>
      <div class="topic-copy"><h4>${escapeHtml(result.title)}</h4><p>${escapeHtml(result.context || result.categoryTitle)}</p></div>
      <div class="topic-arrow">${svg('arrow')}</div>
    </article>`).join('') : '<div class="empty-inline">Sonuç bulunamadı.</div>';
  searchResultsList.querySelectorAll('[data-search-index]').forEach(element => {
    const open = () => openSearchResult(results[Number(element.dataset.searchIndex)]);
    element.addEventListener('click', open);
    element.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') open(); });
  });
}

function openSearchResult(result) {
  closeAllSheets(topicSheet);
  if (result.type === 'section' || result.type === 'article') {
    renderSummary(result.item, result.categoryKey);
  } else if (result.item.type === 'document') {
    renderDocumentHub(result.item, result.categoryKey);
  } else {
    renderTopicPlan(result.item, result.categoryKey);
  }
}

openSearchButton?.addEventListener('click', openSearchSheet);
closeSearchSheetButton?.addEventListener('click', closeSearchSheet);
searchInput?.addEventListener('input', () => runSearch(searchInput.value));

function resetSheetClasses() {
  topicSheet.classList.remove('document-flow', 'quiz-active', 'card-study-active');
}

function openTopicSheet(categoryKey) {
  const category = getCategory(categoryKey);
  if (!category) return showToast('Kategori bulunamadı.');
  clearInterval(timerInterval);
  timerInterval = null;
  closeAllSheets(topicSheet);
  state.activeCategoryKey = categoryKey;
  state.activeDocument = null;
  state.navStack = [{ kind: 'category', categoryKey }];
  topicSheet.classList.add('open');
  topicSheet.setAttribute('aria-hidden', 'false');
  topicBackdrop.classList.add('open');
  renderCategoryLevel(categoryKey);
}

function closeTopicSheet() {
  clearInterval(timerInterval);
  timerInterval = null;
  state.quiz = null;
  state.cardStudy = null;
  resetSheetClasses();
  // GÜVENLİK KİLİDİ: Eskiden burada backdrop sadece routeSheet'e bakılarak
  // kapatılıyordu; searchSheet açıkken bile backdrop kapanabiliyordu. Bu da
  // arama panelinin arkasındaki tıklama-engelleme katmanını kaybetmesine,
  // dokunuşların alttaki kategori kartlarına "sızmasına" ve topicSheet'in
  // durmadan yeniden açılmasına yol açıyordu. closeAllSheets() her şeyi
  // (routeSheet, searchSheet, backdrop dahil) tek seferde tutarlı kapatır.
  closeAllSheets();
}


function applySheetHeader({ title, subtitle, eyebrow, icon = 'book', iconClass = '' }) {
  topicSheetTitle.textContent = title;
  topicSheetSubtitle.textContent = subtitle;
  topicEyebrow.textContent = eyebrow;
  topicHeadingIcon.className = `topic-heading-icon ${iconClass}`.trim();
  topicHeadingIcon.innerHTML = svg(icon);
}

function renderBreadcrumb(label, onClick) {
  topicBreadcrumbWrap.innerHTML = `<div class="topic-breadcrumb-wrap">
      <button class="topic-breadcrumb-back" id="sheetBackButton" type="button" aria-label="Geri dön">${svg('back')}</button>
      <span class="topic-breadcrumb-pill">${escapeHtml(label)}</span>
    </div>`;
  document.getElementById('sheetBackButton').addEventListener('click', () => { haptic(14); onClick(); });
}

function setSheetProgress(label, percentage, completedLabel = 'tamamlandı') {
  topicProgressText.textContent = percentage ? `%${percentage} ${completedLabel}` : label;
  topicProgressBar.style.width = `${percentage}%`;
}

function renderCategoryLevel(categoryKey) {
  const category = getCategory(categoryKey);
  if (!category) return;
  resetSheetClasses();
  const meta = categoryCardMeta(categoryKey);
  applySheetHeader({ title: category.title, subtitle: category.subtitle, eyebrow: 'KONU KATEGORİSİ', icon: meta.icon, iconClass: meta.iconClass });
  topicBreadcrumbWrap.innerHTML = '';
  const progressPercent = getCategoryProgress(categoryKey);
  setSheetProgress('Henüz çalışılmadı', progressPercent);
  const items = getCategoryItems(categoryKey);
  topicList.innerHTML = items.map((item, index) => {
    const isDocument = item.type === 'document';
    const isComplete = isDocument && getDocumentProgress(item) === 100;
    const info = statLine(item);
    return `<article class="topic-item ${isComplete ? 'completed' : ''}" data-topic-index="${index}" role="button" tabindex="0"><div class="topic-number">${String(index + 1).padStart(2, '0')}</div><div class="topic-copy"><h4>${escapeHtml(item.title)}</h4><p>${info}</p></div>${isDocument && item.articleCount && item.contentStatus === 'sample' ? `<span class="article-range">ÖRNEK SET</span>` : ''}<div class="topic-arrow">${svg('arrow')}</div></article>`;
  }).join('');
  topicList.querySelectorAll('[data-topic-index]').forEach(element => {
    const open = () => {
      const item = items[Number(element.dataset.topicIndex)];
      if (item.type === 'document') renderDocumentHub(item, categoryKey);
      else renderTopicPlan(item, categoryKey);
    };
    element.addEventListener('click', open);
    element.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') open(); });
  });
  topicSheet.scrollTop = 0;
  refreshVisibleQuestionCounts(items, () => { if (state.activeCategoryKey === categoryKey && !state.activeDocument) renderCategoryLevel(categoryKey); });
}

function statValue(value) {
  return (value === null || value === undefined) ? '-' : value;
}

function statLine(item) {
  const sectionCount = (item.children || []).length;
  const sectionPart = sectionCount > 0 ? `${sectionCount} bölüm • ` : '';
  const articlePart = (item.articleCount !== null && item.articleCount !== undefined && item.articleCount !== 0)
    ? `${item.articleCount} madde • ` : '';
  return `${sectionPart}${articlePart}${statValue(item.questionCount)} soru`;
}

function statSpans(item, extraSpans = '') {
  const sectionCount = (item.children || []).length;
  const sectionSpan = sectionCount > 0 ? `<span><strong>${sectionCount}</strong> bölüm</span>` : '';
  const articleSpan = (item.articleCount !== null && item.articleCount !== undefined && item.articleCount !== 0)
    ? `<span><strong>${item.articleCount}</strong> madde</span>` : '';
  return `${sectionSpan}${articleSpan}<span><strong>${statValue(item.questionCount)}</strong> soru</span>${extraSpans}`;
}

function statusLabel(documentItem) {
  if (documentItem.contentStatus === 'sample') return 'ÖRNEK İÇERİK AKTİF';
  if (documentItem.questionFile) return 'İÇERİK PAKETİ AKTİF';
  return 'İÇERİK PLANLANIYOR';
}

function renderDocumentHub(documentItem, categoryKey) {
  state.activeDocument = documentItem;
  state.activeCategoryKey = categoryKey;
  topicSheet.classList.add('document-flow');
  topicSheet.classList.remove('quiz-active', 'card-study-active');
  applySheetHeader({ title: documentItem.title, subtitle: documentItem.questionFile ? statLine(documentItem) : 'İçerik yapısı hazır, kaynak paketi bekleniyor', eyebrow: 'MEVZUAT ÇALIŞMA MERKEZİ', icon: 'gavel', iconClass: categoryCardMeta(categoryKey).iconClass });
  renderBreadcrumb(getCategory(categoryKey).title, () => renderCategoryLevel(categoryKey));
  const documentProgress = getDocumentProgress(documentItem);
  setSheetProgress('Henüz çalışılmadı', documentProgress);
  const isActive = Boolean(documentItem.questionFile);
  const sectionsReady = Boolean(documentItem.children && documentItem.children.length);
  topicList.innerHTML = `<section class="document-overview-card">
      <div class="document-overview-top"><span class="document-number">${escapeHtml(documentItem.documentNumber || 'KONU')}</span><span class="document-status ${isActive ? '' : 'is-pending'}">${statusLabel(documentItem)}</span></div>
      <h4>${escapeHtml(documentItem.title)}</h4><p>${isActive ? 'Bölüm bazında çalışabilir, rastgele test çözebilir ve kritik notlarla hızlı tekrar yapabilirsin.' : 'Bu başlık için akış hazır. Bölüm ve soru verisi eklendiğinde kartlar otomatik olarak aktifleşir.'}</p>
      <div class="document-stats">${statSpans(documentItem, `<span><strong>%${documentProgress}</strong> ilerleme</span>`)}</div>
    </section>
    <div class="document-mode-grid">
      ${modeCard('sections', 'book', 'Madde Madde Çalış', 'Bölüm ve madde listesinden istediğin yere git.', sectionsReady)}
      ${modeCard('random', 'target', 'Rastgele 20 Soru', 'Kanunun tamamından rastgele sorular çöz.', isActive)}
      ${modeCard('truefalse', 'check', 'Doğru / Yanlış', 'Soruları doğru/yanlış olarak değerlendir.', isActive)}
      ${modeCard('summary', 'trophy', 'Özet ve Kritik Noktalar', 'Sınavda öne çıkan maddeleri hızlı tekrar et.', sectionsReady)}
    </div>`;
  topicList.querySelectorAll('[data-document-mode]').forEach(button => button.addEventListener('click', () => {
    if (button.disabled) return showToast('Bu mod, ilgili içerik paketi eklendiğinde açılacak.');
    haptic(18);
    const mode = button.dataset.documentMode;
    if (mode === 'sections') renderSections(documentItem, categoryKey);
    if (mode === 'random') openRandomQuiz(documentItem, categoryKey);
    if (mode === 'summary') renderSummary(documentItem, categoryKey);
    if (mode === 'truefalse') openTrueFalseMode(documentItem, categoryKey);
  }));
  topicSheet.scrollTop = 0;
  refreshVisibleQuestionCounts([documentItem], () => { if (state.activeDocument === documentItem) renderDocumentHub(documentItem, categoryKey); });
}

function modeCard(mode, icon, title, description, enabled) {
  return `<button class="document-mode-card ${enabled ? '' : 'is-disabled'}" data-document-mode="${mode}" type="button" ${enabled ? '' : 'disabled'}><span class="document-mode-icon">${svg(icon)}</span><strong>${title}</strong><small>${description}</small></button>`;
}

function renderTopicPlan(item, categoryKey) {
  state.activeDocument = item;
  state.activeCategoryKey = categoryKey;
  topicSheet.classList.add('document-flow');
  topicSheet.classList.remove('quiz-active', 'card-study-active');
  const isActive = Boolean(item.questionFile);
  const sectionsReady = Boolean(item.children && item.children.length);
  applySheetHeader({
    title: item.title,
    subtitle: isActive ? statLine(item) : 'İçerik yapısı hazır, kaynak paketi bekleniyor',
    eyebrow: 'KONU ÇALIŞMA MERKEZİ',
    icon: 'book',
    iconClass: categoryCardMeta(categoryKey).iconClass
  });
  renderBreadcrumb(getCategory(categoryKey).title, () => renderCategoryLevel(categoryKey));
  const topicProgress = progress.completedSections[item.id] ? 100 : 0;
  setSheetProgress('Henüz çalışılmadı', topicProgress);

  topicList.innerHTML = `<section class="document-overview-card">
      <div class="document-overview-top"><span class="document-number">KONU</span><span class="document-status ${isActive ? '' : 'is-pending'}">${statusLabel(item)}</span></div>
      <h4>${escapeHtml(item.title)}</h4><p>${isActive ? 'Bölüm bazında çalışabilir, rastgele test çözebilir ve kritik notlarla hızlı tekrar yapabilirsin.' : 'Bu başlık için akış hazır. Bölüm ve soru verisi eklendiğinde kartlar otomatik olarak aktifleşir.'}</p>
      <div class="document-stats">${statSpans(item, `<span><strong>%${topicProgress}</strong> ilerleme</span>`)}</div>
    </section>
    <div class="document-mode-grid">
      ${modeCard('sections', 'book', 'Madde Madde Çalış', 'Bölüm ve madde listesinden istediğin yere git.', sectionsReady)}
      ${modeCard('random', 'target', 'Rastgele 20 Soru', 'Konunun tamamından rastgele sorular çöz.', isActive)}
      ${modeCard('truefalse', 'check', 'Doğru / Yanlış', 'Soruları doğru/yanlış olarak değerlendir.', isActive)}
      ${modeCard('summary', 'trophy', 'Özet ve Kritik Noktalar', 'Sınavda öne çıkan maddeleri hızlı tekrar et.', sectionsReady)}
    </div>`;

  topicList.querySelectorAll('[data-document-mode]').forEach(button => button.addEventListener('click', () => {
    if (button.disabled) return showToast('Bu mod, ilgili içerik paketi eklendiğinde açılacak.');
    haptic(18);
    const mode = button.dataset.documentMode;
    if (mode === 'sections') renderSections(item, categoryKey);
    if (mode === 'random') openRandomQuiz(item, categoryKey);
    if (mode === 'summary') renderSummary(item, categoryKey);
    if (mode === 'truefalse') openTrueFalseMode(item, categoryKey);
  }));

  topicSheet.scrollTop = 0;
  refreshVisibleQuestionCounts([item], () => { if (state.activeDocument === item) renderTopicPlan(item, categoryKey); });
}

function renderSections(documentItem, categoryKey) {
  topicSheet.classList.add('document-flow');
  applySheetHeader({ title: 'Bölüm Seçimi', subtitle: 'Bir bölüme dokunarak karma sorularla başla.', eyebrow: 'MADDE MADDE ÇALIŞ', icon: 'gavel', iconClass: categoryCardMeta(categoryKey).iconClass });
  renderBreadcrumb(documentItem.title, () => renderDocumentHub(documentItem, categoryKey));
  setSheetProgress('Henüz çalışılmadı', getDocumentProgress(documentItem));
  // NOT (2026-09-06 düzeltme): bölümler (documentItem.children) daha önce
  // kadroya göre hiç süzülmüyordu — getCategoryItems() üst-düzey konuları
  // doğru süzüyordu ama TEK bir belgenin İÇİNDEKİ bölümler bu filtreden hiç
  // geçmiyordu. Sonuç: örn. Memur, "MEB Yönetmelikleri" belgesini açınca
  // sadece Şef'e ait olması gereken bölümleri (Disiplin Amirleri, İmza
  // Yetkileri) de görüyordu.
  const role = progress.selectedRole;
  const sections = (documentItem.children || []).filter(section => !role || !section.kadrolar || section.kadrolar.includes(role));
  topicList.innerHTML = `<div class="document-section-head"><span>BÖLÜM TESTLERİ</span><strong>Bölüme tıkla, test başlasın</strong></div><div class="document-section-list">${sections.map((section, index) => {
    const completed = progress.completedSections[section.id];
    const childCount = (section.children || []).length;
    // "0" (madde aralığı literal string'i olarak) de boş değer sayılır — aksi
    // halde maddesi olmayan bölümlerde satırda kalıcı olarak "0" görünür.
    const hasArticleRange = Boolean(section.articleRange) && String(section.articleRange).trim() !== '0';
    const sectionMeta = hasArticleRange
      ? section.articleRange
      : (childCount > 0 ? `${childCount} madde` : `${statValue(section.questionCount)} soru`);
    return `<article class="document-section-item ${completed ? 'completed' : ''}" data-section-index="${index}" role="button" tabindex="0"><span class="document-section-number">${completed ? svg('check') : String(index + 1).padStart(2, '0')}</span><div><h4>${escapeHtml(section.title)}</h4><p>${escapeHtml(sectionMeta)}</p></div><span class="document-section-arrow">›</span></article>`;
  }).join('')}</div>`;
  topicList.querySelectorAll('[data-section-index]').forEach(element => {
    const open = () => openSectionQuiz(documentItem, sections[Number(element.dataset.sectionIndex)], categoryKey);
    element.addEventListener('click', open);
    element.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') open(); });
  });
  topicSheet.scrollTop = 0;
  refreshSectionQuestionCounts(sections);
}

// Madde Madde Çalış bölüm listesindeki maddesi olmayan alt konularda
// (articleRange yok, children yok) daha önce sabit "0" yazıyordu; burada
// gerçek soru sayısını topic_id üzerinden çekip ilgili satırı yerinde güncelliyoruz.
//
// NOT (2026-08-17 düzeltme): article_range sütunu bazı satırlarda boş yerine
// literal "0" string'i olarak kaydedilmiş olabiliyor (DB'de düzeltildi, ama
// admin panelinden yeniden aynı şekilde girilebilir). "0" JS'te truthy olduğu
// için `!section.articleRange` bu satırları hatalıca "maddesi var" sayıp
// yenileme hedeflerinin dışında bırakıyor, satır sonsuza kadar "0" göstermeye
// devam ediyordu. "0"ı da boş değer gibi ele alıyoruz.
async function refreshSectionQuestionCounts(sections) {
  const hasArticleRange = section => Boolean(section.articleRange) && String(section.articleRange).trim() !== '0';
  const targets = (sections || []).filter(section => !hasArticleRange(section) && !(section.children || []).length);
  if (!targets.length) return;
  const results = await Promise.allSettled(targets.map(async section => {
    const count = await ContentRepo.fetchQuestionCountByTopicId(section.id);
    return { section, count };
  }));
  results.forEach(result => {
    if (result.status !== 'fulfilled') { console.warn('Bölüm soru sayısı alınamadı:', result.reason); return; }
    const { section, count } = result.value;
    section.questionCount = count;
    const index = sections.indexOf(section);
    const row = topicList.querySelector(`[data-section-index="${index}"] p`);
    if (row) row.textContent = `${count} soru`;
  });
}

function renderSummary(documentItem, categoryKey) {
  topicSheet.classList.add('document-flow');
  applySheetHeader({ title: 'Özet ve Kritik Noktalar', subtitle: documentItem.title, eyebrow: 'HIZLI TEKRAR', icon: 'trophy', iconClass: categoryCardMeta(categoryKey).iconClass });
  renderBreadcrumb(documentItem.title, () => renderDocumentHub(documentItem, categoryKey));
  setSheetProgress('Henüz çalışılmadı', getDocumentProgress(documentItem));
  const role = progress.selectedRole;
  const sections = (documentItem.children || []).filter(section => !role || !section.kadrolar || section.kadrolar.includes(role));
  topicList.innerHTML = `<div class="summary-list">${sections.map(section => {
    const hasOwnSummary = Boolean(section.summary || (section.keyPoints || []).length);
    const ownBlock = hasOwnSummary ? `${section.summary ? `<p class="summary-text">${escapeHtml(section.summary)}</p>` : ''}${(section.keyPoints || []).length ? `<ul>${section.keyPoints.map(point => `<li>${escapeHtml(point)}</li>`).join('')}</ul>` : ''}` : '';
    const articleBlocks = (section.children || []).map(article => `<article class="summary-item"><span>${escapeHtml(article.articleLabel || 'Madde')}</span><h5>${escapeHtml(article.summary || article.title || '')}</h5>${(article.keyPoints || []).length ? `<ul>${article.keyPoints.slice(0, 3).map(point => `<li>${escapeHtml(point)}</li>`).join('')}</ul>` : ''}</article>`).join('');
    if (!ownBlock && !articleBlocks) return '';
    return `<section class="summary-section"><h4>${escapeHtml(section.title)}</h4>${ownBlock || articleBlocks}</section>`;
  }).join('')}</div>`;
  topicSheet.scrollTop = 0;
}

async function loadTfPool(documentItem) {
  // D/Y modu artık ayrı bir tablodan (tf_pool) besleniyor: elle hazırlanmış,
  // doğrudan doğru/yanlış ifadesi şeklinde kayıtlı sorular. `questions`
  // (çoktan seçmeli banka) burada KULLANILMIYOR — o banka hâlâ ÇS/bölüm
  // testleri ve karma tekrar akışları için ayrı ayrı yükleniyor
  // (bkz. openSectionQuiz, loadBanksForEntries), bu fonksiyon onlara dokunmuyor.
  const cacheKey = `tf:${documentItem.id}`;
  if (state.questionBanks.has(cacheKey)) return state.questionBanks.get(cacheKey);

  // O-07: 1.000 satır sınırına karşı sayfalı okuma.
  const data = await ContentRepo.fetchAllRows(() => supabaseClient
    .from('tf_pool')
    .select('id,statement,is_true,correction,explanation,topic_id')
    .eq('topic_id', documentItem.id)
    .order('sort_order', { ascending: true })
    .order('id', { ascending: true }));

  const rows = (data || []).map(row => ({
    id: row.id,
    statement: row.statement,
    isTrue: row.is_true,
    correction: row.correction,
    explanation: row.explanation,
    topicId: row.topic_id,
  }));

  state.questionBanks.set(cacheKey, rows);
  return rows;
}

async function loadQuestionBank(documentItem) {
  if (state.questionBanks.has(documentItem.id)) return state.questionBanks.get(documentItem.id);
  
  try {
    // Önce JSON dosyasından dene (geriye uyumluluk için)
    if (documentItem.questionFile) {
      try {
        const data = await ContentRepo.fetchQuestionsByPath(documentItem.questionFile);
        const questions = Array.isArray(data.questions) ? data.questions : [];
        state.questionBanks.set(documentItem.id, questions);
        return questions;
      } catch (jsonError) {
        console.warn(`JSON dosyası yüklenemedi: ${documentItem.questionFile}`);
      }
    }

    // Veritabanından yükle. NOT: `questions` tablosu RLS ile korunuyor
    // (questions_premium_read → is_premium()), bu yüzden doğrudan seçim
    // güvenli — free/anon kullanıcı answer_index'e erişemez, boş sonuç alır.
    // (M-01 düzeltmesi): şemada `section_id` diye bir sütun yok; sorular
    // doğrudan `topic_id` ile bölüme/alt-konuya bağlanıyor. Bölüm testi filtresi
    // zaten `question.topicId === section.id` kullandığından sectionId'yi
    // topic_id'den türetiyoruz.
    // O-07: 1.000 satır sınırına karşı sayfalı okuma.
    const data = await ContentRepo.fetchAllRows(() => supabaseClient
      .from('questions')
      .select('id,prompt,options,answer_index,topic_id')
      .eq('topic_id', documentItem.id)
      .order('sort_order', { ascending: true })
      .order('id', { ascending: true }));
    
    const questions = (data || []).map(q => ({
      id: q.id,
      prompt: q.prompt,
      options: q.options,
      answerIndex: q.answer_index,
      topicId: q.topic_id,
      sectionId: q.topic_id
    }));
    
    state.questionBanks.set(documentItem.id, questions);
    return questions;
  } catch (error) {
    documentItem.questionFile = null;
    documentItem.contentStatus = 'planned';
    throw error;
  }
}

async function refreshVisibleQuestionCounts(items, onUpdate) {
  const targets = (items || []).filter(item => item && item.questionFile);
  if (!targets.length) return;
  // NOT: Burada artık loadQuestionBank() (tüm soru içeriğini indiren, premium'a
  // kilitli fonksiyon) DEĞİL, sadece sayı dönen ContentRepo.fetchQuestionCount()
  // kullanılıyor — hem ücretsiz kullanıcıda doğru sayıyı gösterir hem de premium
  // kullanıcıda gereksiz yere tüm soru bankasını indirmez.
  const results = await Promise.allSettled(targets.map(async item => {
    const count = await ContentRepo.fetchQuestionCount(item.questionFile);
    return { item, count };
  }));
  let changed = false;
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      const { item, count } = result.value;
      if (item.questionCount !== count) {
        item.questionCount = count;
        changed = true;
      }
    } else {
      // Sayı alma hatası içeriğin bulunmadığı anlamına gelmez. Önceden burada
      // yeniden çizim tetikleniyor ve içerik yanlışlıkla pasif görünüyordu.
      console.warn('Soru sayısı alınamadı:', result.reason);
    }
  });
  if (changed) onUpdate();
}

function shuffle(list) {
  const items = list.slice();
  for (let index = items.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [items[index], items[randomIndex]] = [items[randomIndex], items[index]];
  }
  return items;
}

function tagQuestions(bank, documentItem, categoryKey) {
  return bank.map(question => ({
    ...question,
    documentId: documentItem.id,
    documentTitle: documentItem.title,
    categoryKey: categoryKey || null
  }));
}

// Premium gerektiren bir moda girmeden önce çağrılır. window.currentUserIsPremium
// app-guard.js tarafından oturum açılışında is_premium() RPC'siyle set edilir.
// false ise kullanıcıyı hiç sunucuya sormadan net bir mesajla durdurur — daha
// önce bu durumda sorgu sessizce 0 satır dönüyor ve "içerik yok" gibi
// yanıltıcı bir mesaj gösteriliyordu.
function requirePremiumOrWarn() {
  if (window.currentUserIsPremium === false) {
    openPremiumModal();
    return false;
  }
  if (window.currentUserIsPremium !== true) {
    // D-09 (2026-09-15): Premium durumu bilinmiyor (ağ hatası). İçeriği açmak
    // yerine durumu yeniden sorgula ve kullanıcıya bilgi ver.
    refreshPremiumStatus();
    showToast('Üyelik durumun doğrulanamadı. Bağlantını kontrol edip tekrar dene.');
    return false;
  }
  return true;
}

async function refreshPremiumStatus() {
  try {
    const { data, error } = await supabaseClient.rpc('is_premium');
    if (error) throw error;
    window.currentUserIsPremium = Boolean(data);
  } catch (error) {
    console.warn('Premium durumu yenilenemedi:', error?.message || error);
  }
  return window.currentUserIsPremium;
}

function openPremiumModal() {
  const overlay = document.getElementById('premiumModalOverlay');
  if (!overlay) return;
  overlay.classList.add('open');
  updatePremiumButtonPrices();
}

function initPremiumModal() {
  const overlay = document.getElementById('premiumModalOverlay');
  if (!overlay) return;
  document.getElementById('premiumModalClose')?.addEventListener('click', () => overlay.classList.remove('open'));
  overlay.addEventListener('click', (event) => {
    if (event.target.id === 'premiumModalOverlay') overlay.classList.remove('open');
  });
  overlay.querySelectorAll('.premium-buy-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const result = await purchasePremiumProduct(btn.dataset.productId, btn);
      if (result) overlay.classList.remove('open');
    });
  });
}

async function openSectionQuiz(documentItem, section, categoryKey) {
  if (!requirePremiumOrWarn()) return;
  try {
    showToast('Sorular hazırlanıyor…');
    const bank = tagQuestions(await loadQuestionBank(documentItem), documentItem, categoryKey);
    const questions = bank.filter(question => question.topicId === section.id);
    if (!questions.length) return showToast('Bu bölüm için henüz soru bulunmuyor.');
    startQuiz({
      questions,
      documentItem,
      section,
      kind: 'section',
      title: section.title,
      subtitle: `${documentItem.title} • ${section.articleRange || 'Karma sorular'}`,
      returnView: () => renderSections(documentItem, categoryKey)
    });
  } catch (error) {
    showToast(error.message || 'Sorular yüklenemedi.');
  }
}

async function openRandomQuiz(documentItem, categoryKey) {
  try {
    showToast('Rastgele test hazırlanıyor…');
    // NOT: Artık loadQuestionBank() (tüm bankayı indiren fonksiyon) kullanılmıyor.
    // Rastgele seçim VE ücretsiz hak sayacı (konu başına 2 deneme) sunucuda
    // (start_random_test RPC) uygulanıyor — tarayıcıya asla hakkından fazla
    // soru inmiyor. Cevap/açıklama de artık quiz bitene kadar hiç inmiyor
    // (bkz. revealDeferredQuizAndFinish, content-repo.js reveal_quiz_session).
    const { sessionId, questions: rawQuestions } = await ContentRepo.fetchRandomTestQuestions(documentItem.questionFile);
    const questions = tagQuestions(rawQuestions, documentItem, categoryKey);
    if (!questions.length) return showToast('Bu başlık için henüz soru bulunmuyor.');
    startQuiz({
      questions,
      documentItem,
      kind: 'random',
      sessionId,
      title: documentItem.title,
      subtitle: `Rastgele ${questions.length} soru`,
      returnView: () => renderDocumentHub(documentItem, categoryKey)
    });
  } catch (error) {
    if (error.code === 'FREE_LIMIT_REACHED') {
      openPremiumModal();
      return showToast('Bu konu için 2 ücretsiz rastgele test hakkınızı kullandınız. Devam etmek için premium üyelik gerekiyor.');
    }
    showToast(error.message || 'Sorular yüklenemedi.');
  }
}

// "Aşağıdakilerden hangisi..." kalıbındaki sorular (Türkçe'de çok yaygın bir
// çoktan seçmeli kurgusu) D/Y moduna uygun değil: bu kalıp öğrenciye "şu
// listeden birini seç" der, ama D/Y'de tek bir aday cevap gösteriliyor —
// referans verdiği "aşağıdaki" liste hiç görünmüyor, soru anlamsızlaşıyor.
// Bu fonksiyon Türkçe karakterleri normalize ederek ("İ"/"I" -> "i" gibi)
// prompt'ta "aşağıd..." + "hangi..." birlikteliğini arar.
function isChooseFromListPrompt(prompt) {
  if (!prompt) return false;
  const normalized = prompt
    .toLocaleLowerCase('tr-TR')
    .replace(/i̇/g, 'i'); // TR-TR küçük harfe çevirince "İ" çoğu zaman "i̇" (nokta + i) olur
  return normalized.includes('aşağıd') && normalized.includes('hangi');
}

// ---- DOĞRU / YANLIŞ MODU ----------------------------------------
async function openTrueFalseMode(documentItem, categoryKey) {
  if (!requirePremiumOrWarn()) return;
  try {
    showToast('Doğru/Yanlış modu hazırlanıyor…');
    // D/Y kartları artık elle hazırlanmış tf_pool tablosundan geliyor —
    // çoktan seçmeli soru bankasından (questions) anlık üretim YAPILMIYOR.
    // Bu yüzden eski "usable/filter" adımlarına (yanlış şıksız sorular,
    // "aşağıdakilerden hangisi" kalıbı vb.) artık gerek yok; tf_pool zaten
    // sadece D/Y'ye uygun, doğrudan ifade şeklinde kayıtlardan oluşuyor.
    const usableBank = await loadTfPool(documentItem);
    if (!usableBank.length) return showToast('Bu başlık için Doğru/Yanlış moduna uygun soru bulunmuyor.');

    // Aynı konuda art arda "Tekrar Dene"ye basıldığında ya da modüle
    // tekrar girildiğinde, mümkünse bir önceki turda görülen sorular hariç
    // tutulur — bank yeterince büyükse kullanıcı sürekli aynı 20 soruyla
    // karşılaşmaz. Bank küçükse (tekrar hariç tutunca 20'nin altına
    // düşüyorsa) tekrar dahil edilir, boş ekran görünmesindense tekrar
    // tercih edilir.
    const seenKey = documentItem.id;
    const recentlySeen = state.tfRecentlySeen?.get(seenKey) || new Set();
    const fresh = usableBank.filter(q => !recentlySeen.has(q.id));
    const pool = fresh.length >= Math.min(20, usableBank.length) ? fresh : usableBank;

    // tf_pool kayıtları zaten doğrudan doğru/yanlış ifadesi olarak
    // hazırlanmış (statement + is_true + correction). Burada artık
    // çoktan seçmeli şıklardan cevap "üretmiyoruz" — kayıttaki değeri
    // olduğu gibi karta aktarıyoruz.
    const selected = shuffle(pool).slice(0, Math.min(20, pool.length));
    const tfQuestions = selected.map(q => ({
      id: q.id,
      feedbackQuestionId: `tf_${q.id}`,
      prompt: '',
      displayAnswer: q.statement,
      isCorrectShown: q.isTrue,
      correctAnswer: q.isTrue ? q.statement : (q.correction || q.statement),
      categoryKey,
      sourceQuestion: null, // tf_pool kayıtları questions ile aynı şemada değil;
      // bu yüzden ÇS quiz'deki "Zayıf Konular" yanlış-soru izleme akışına
      // (recordAnswer) beslenmiyor — o akış answerIndex/options bekliyor.
    }));

    // Bu turda gösterilen soruları "son görülenler" olarak işaretle.
    if (!state.tfRecentlySeen) state.tfRecentlySeen = new Map();
    state.tfRecentlySeen.set(seenKey, new Set(tfQuestions.map(q => q.id)));

    state.tfQuiz = {
      questions: tfQuestions,
      index: 0,
      score: 0,
      answers: [], // { correct: bool }[]
      documentItem,
      categoryKey,
      returnView: () => renderDocumentHub(documentItem, categoryKey),
    };

    topicSheet.classList.add('quiz-active');
    topicSheet.classList.remove('document-flow', 'card-study-active');
    renderTrueFalse();
  } catch (err) {
    showToast(err.message || 'Sorular yüklenemedi.');
  }
}

function renderTrueFalse() {
  const tf = state.tfQuiz;
  if (!tf) return;

  const q = tf.questions[tf.index];
  const total = tf.questions.length;
  const progressPct = Math.round((tf.index / total) * 100);
  const tagMeta = categoryCardMeta(tf.categoryKey);
  const tagLabel = tf.documentItem?.title || tagMeta.title;
  const bookmarked = !!progress.flaggedQuestions[q.id];

  topicList.innerHTML = `
    <div class="tf-shell">
      <div class="tf-header">
        <div class="tf-header-row">
          <button type="button" class="tf-icon-btn" id="tfClose" aria-label="Geri dön">${svg('back')}</button>
          <h2 class="tf-header-title"><span class="tf-title-correct">Doğru</span> <span class="tf-title-slash">/</span> <span class="tf-title-wrong">Yanlış</span></h2>
          <span class="tf-icon-btn" aria-hidden="true" style="visibility:hidden"></span>
        </div>
        <div class="tf-progress-row">
          <div class="tf-progress-track"><div class="tf-progress-fill" style="width:${progressPct}%"></div></div>
          <span class="tf-progress-label">${tf.index + 1} / ${total}</span>
        </div>
      </div>
      <div class="tf-body">
        <div class="tf-card">
          <div class="tf-content-box">
            <div class="tf-card-top">
              <span class="tf-topic-tag"><span class="tf-topic-icon">${svg(tagMeta.icon)}</span>${escapeHtml(tagLabel)}</span>
              <div class="tf-card-top-actions">
                <button type="button" class="tf-icon-btn tf-report-inline${progress.reportedQuestions[q.id] ? ' is-active' : ''}" id="tfReport" aria-label="${progress.reportedQuestions[q.id] ? 'Bildirimi Geri Al' : 'Soruyu Bildir'}">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>
                </button>
                <button type="button" class="tf-icon-btn tf-bookmark-inline${bookmarked ? ' is-active' : ''}" id="tfBookmark" aria-label="Soruyu kaydet" aria-pressed="${bookmarked}">${svg('bookmark')}</button>
              </div>
            </div>
            ${q.prompt ? `<span class="tf-prompt-label">SORU</span><p class="tf-prompt">${escapeHtml(q.prompt)}</p>` : ''}
            <span class="tf-answer-label">${q.prompt ? 'GÖSTERİLEN CEVAP' : 'İFADE'}</span>
            <div class="tf-answer-chip">${escapeHtml(q.displayAnswer)}</div>
          </div>
          <p class="tf-question-cue">Bu cevap doğru mu?</p>
          <div class="tf-buttons">
            <button type="button" class="tf-btn tf-btn-neutral" id="tfWrong" aria-label="Bu ifade yanlış">
              <span class="tf-btn-glow" aria-hidden="true"></span>
              <span class="tf-btn-icon">${svg('alertX')}</span>Yanlış
            </button>
            <button type="button" class="tf-btn tf-btn-neutral" id="tfCorrect" aria-label="Bu ifade doğru">
              <span class="tf-btn-glow" aria-hidden="true"></span>
              <span class="tf-btn-icon">${svg('check')}</span>Doğru
            </button>
          </div>
          <div class="tf-result" id="tfResult" aria-live="polite" hidden></div>
        </div>
      </div>
      <div class="tf-sticky-footer" id="tfStickyFooter" hidden>
        <button type="button" class="tf-next-btn" id="tfNext">Sonraki Soru${svg('arrowRight')}</button>
      </div>
    </div>`;

  const exit = () => {
    state.tfQuiz = null;
    topicSheet.classList.remove('quiz-active');
    tf.returnView();
  };
  document.getElementById('tfClose').onclick = exit;

  document.getElementById('tfBookmark').onclick = () => {
    const nowBookmarked = !progress.flaggedQuestions[q.id];
    if (nowBookmarked) window.SRProgressSync.setKey(progress, 'flaggedQuestions', q.id, true);
    else window.SRProgressSync.deleteKey(progress, 'flaggedQuestions', q.id);
    saveProgress();
    const btn = document.getElementById('tfBookmark');
    btn.classList.toggle('is-active', nowBookmarked);
    btn.setAttribute('aria-pressed', String(nowBookmarked));
    showToast(nowBookmarked ? 'Soru kaydedildi' : 'Kaydedilenlerden çıkarıldı');
  };

  document.getElementById('tfReport').onclick = () => reportQuestion(q, renderTrueFalse);

  const wrongBtn = document.getElementById('tfWrong');
  const correctBtn = document.getElementById('tfCorrect');

  const answer = (userSaidCorrect) => {
    const wasRight = userSaidCorrect === q.isCorrectShown;
    tf.answers.push({ correct: wasRight });
    if (wasRight) tf.score++;
    // Doğru/Yanlış modu, ana quiz ile aynı kalıcı ilerleme ve yanlış havuzuna
    // SADECE kartta doğru cevap gösterildiğinde (q.isCorrectShown) yazar.
    // Neden: kartta yanlış bir şık gösterilip kullanıcı onu yanlışlıkla
    // "doğru" işaretlerse, bu kullanıcının konuyu bilmediğini değil, sadece
    // o tek distractor'ı doğru cevapla karıştırdığını gösterir — ÇS quiz'deki
    // "yanlış şık işaretleme" ile aynı güvenilirlikte bir sinyal değildir.
    // Bu yüzden sadece doğru-cevap-gösterilen kartlardaki performans kalıcı
    // "wrongQuestions" / Zayıf Konular havuzuna yansıtılır; oturum içi D/Y
    // skoru (tf.score) her iki durumda da normal şekilde tutulmaya devam eder.
    if (q.sourceQuestion && q.isCorrectShown) {
      recordAnswer({ ...q.sourceQuestion, answerRecorded: false }, wasRight ? q.sourceQuestion.answerIndex : -1);
    }

    // Renkler (kırmızı/yeşil) sadece cevap verildikten SONRA uygulanır —
    // cevap verilmeden önce butonlar nötr (gri) kalır, böylece renk kullanıcıyı
    // önceden yönlendirmez. Seçilen buton kendi rengini (doğru/yanlış'a göre),
    // diğer buton soluklaşmış nötr halini alır.
    wrongBtn.classList.remove('tf-btn-neutral');
    correctBtn.classList.remove('tf-btn-neutral');
    wrongBtn.classList.add('tf-btn-wrong');
    correctBtn.classList.add('tf-btn-correct');
    const selectedBtn = userSaidCorrect ? correctBtn : wrongBtn;
    const otherBtn = userSaidCorrect ? wrongBtn : correctBtn;
    selectedBtn.classList.add('is-selected');
    otherBtn.classList.add('is-muted');
    wrongBtn.disabled = true;
    correctBtn.disabled = true;

    // Seçilen butonda kısa bir "parlama" (glow) efekti + hafif titreşim —
    // önceki tam ekran overlay denemesi (tik/çarpı + 1.2 sn bekleme) yerine
    // geldi. Overlay hem gereksiz tekrar (renk zaten aynı bilgiyi veriyor)
    // hem de her soruda 1+ saniyelik gecikme yaratıyordu; bu yöntemde hiç
    // bekleme yok, glow ile sonuç paneli aynı anda görünür.
    const glow = selectedBtn.querySelector('.tf-btn-glow');
    if (glow) {
      glow.classList.remove('correct', 'wrong', 'play');
      void glow.offsetWidth; // animasyonu sıfırlayıp yeniden tetiklemek için reflow
      glow.classList.add(wasRight ? 'correct' : 'wrong', 'play');
    }
    // Doğru/yanlış için farklı titreşim şiddeti: yanlışta DİZİ veriliyor,
    // çünkü native-ux.js'deki haptic() fonksiyonu sadece dizi geldiğinde
    // belirgin bir "hata" bildirimi (Taptic Engine'in buzz-buzz paterni)
    // tetikliyor. Önceki haliyle her iki durumda da tek sayı veriliyordu,
    // ikisi de aynı hafif "impact" kategorisine düşüp ayırt edilemiyordu —
    // kullanıcı yanlışta hiçbir titreşim hissetmiyordu.
    haptic(wasRight ? 14 : [12, 40, 12]);

    // Sonuç panelini doldur ve göster.
    // Önceki sürümde burada hem "Doğru cevap: Yanlış/Doğru" (D/Y oyunundaki
    // cevabı tekrarlıyordu — başlık zaten bunu ikon+renkle veriyordu) hem de
    // "Açıklama" başlıklı uzun bir cümle vardı. İkisi de gereksiz tekrar/uzunluk
    // yaratıyordu; artık tek, kısa bir satırda doğrudan doğru bilgi gösteriliyor.
    const resultBox = document.getElementById('tfResult');
    resultBox.hidden = false;
    resultBox.innerHTML = `
      <div class="tf-result-panel ${wasRight ? 'is-correct' : 'is-wrong'}">
        <div class="tf-result-head">
          <span class="tf-result-icon">${svg(wasRight ? 'check' : 'alertX')}</span>
          <strong class="tf-result-title">${wasRight ? 'Doğru cevap' : 'Cevabınız yanlış'}</strong>
        </div>
        <p class="tf-result-oneline">Doğru cevap: “${escapeHtml(q.correctAnswer)}”</p>
      </div>`;

    // "Sonraki Soru" butonu artık sonuç panelinin içinde değil, ekranın
    // altına sabitlenmiş (sticky) ayrı bir footer'da — uzun soru/açıklama
    // içeriğinde kullanıcı butona ulaşmak için kaydırmak zorunda kalmasın
    // diye. Buton cevap verilene kadar gizli, cevap sonrası gösteriliyor.
    const stickyFooter = document.getElementById('tfStickyFooter');
    stickyFooter.hidden = false;
    document.getElementById('tfNext').onclick = () => {
      tf.index++;
      if (tf.index >= total) {
        renderTrueFalseResult();
      } else {
        renderTrueFalse();
      }
    };
  };

  correctBtn.onclick = () => answer(true);
  wrongBtn.onclick = () => answer(false);
}

function renderTrueFalseResult() {
  const tf = state.tfQuiz;
  const total = tf.questions.length;
  const pct = Math.round((tf.score / total) * 100);

  logEvent('tf_completed', { category: tf.categoryKey, score: tf.score, total, pct });

  topicList.innerHTML = `
    <div class="tf-shell">
      <div class="tf-header">
        <div class="tf-header-row">
          <button type="button" class="tf-icon-btn" id="tfResultClose" aria-label="Geri dön">${svg('back')}</button>
          <h2 class="tf-header-title">Sonuç</h2>
          <span class="tf-icon-btn" aria-hidden="true" style="visibility:hidden"></span>
        </div>
      </div>
      <div class="tf-body">
        <div class="tf-result-card">
          <strong class="tf-result-score">${tf.score} / ${total}</strong>
          <span class="tf-result-pct">%${pct} başarı</span>
          <div class="quiz-result-actions" style="margin-top:24px">
            <button class="reader-secondary" id="tfRetry" type="button">Tekrar Dene</button>
            <button class="reader-primary" id="tfReturn" type="button">Listeye Dön</button>
          </div>
        </div>
      </div>
    </div>`;

  document.getElementById('tfResultClose').onclick = () => {
    state.tfQuiz = null;
    topicSheet.classList.remove('quiz-active');
    tf.returnView();
  };
  document.getElementById('tfReturn').onclick = () => {
    state.tfQuiz = null;
    topicSheet.classList.remove('quiz-active');
    tf.returnView();
  };
  document.getElementById('tfRetry').onclick = () => openTrueFalseMode(tf.documentItem, tf.categoryKey);
}
// ---- DOĞRU / YANLIŞ MODU SONU ----------------------------------

function dedupeQuestionsById(list) {
  const seen = new Set();
  const out = [];
  for (const q of list) {
    if (q.id) { if (seen.has(q.id)) continue; seen.add(q.id); }
    out.push(q);
  }
  return out;
}

async function loadBanksForEntries(entries) {
  const results = await Promise.allSettled(entries.map(async entry =>
    tagQuestions(await loadQuestionBank(entry.item), entry.item, entry.categoryKey)
  ));
  return results.filter(r => r.status === 'fulfilled').map(r => r.value).flat();
}

function getDocAccuracy(documentId) {
  const stats = progress.docStats[documentId];
  if (!stats || stats.attempts < 3) return null; // yeterli veri yok
  return stats.correct / stats.attempts;
}

function getWeakEntries(entries, limit = 5) {
  return entries
    .map(entry => ({ entry, accuracy: getDocAccuracy(entry.item.id) }))
    .filter(x => x.accuracy !== null)
    .sort((a, b) => a.accuracy - b.accuracy)
    .slice(0, limit)
    .map(x => x.entry);
}

function getUnseenEntries(entries, exclude = []) {
  return entries.filter(entry =>
    (!progress.docStats[entry.item.id] || progress.docStats[entry.item.id].attempts === 0) &&
    !exclude.includes(entry)
  );
}

function findLastActivityEntry(entries) {
  const last = progress.lastActivity;
  if (!last || !last.documentId) return null;
  return entries.find(entry => entry.item.id === last.documentId) || null;
}

// RASTGELE KARMA: tüm aktif konulardan karışık havuz
async function buildRandomPool(entries) {
  return await loadBanksForEntries(shuffle(entries));
}

// ZAYIF KONULAR: en düşük doğruluklu konular + hâlâ yanlış bilinen sorular
async function buildWeakPool(entries) {
  const weakEntries = getWeakEntries(entries);
  const wrongPool = Object.values(progress.wrongQuestions);
  if (!weakEntries.length && !wrongPool.length) return null;
  const weakBank = weakEntries.length ? await loadBanksForEntries(weakEntries) : [];
  const combined = dedupeQuestionsById([...shuffle(wrongPool), ...shuffle(weakBank)]);
  return combined.length ? combined : null;
}

// SON ÇALIŞILAN KONU: en son bırakılan konudan devam, gerekirse aynı kategoriden tamamla
async function buildLastActivityPool(entries) {
  const lastEntry = findLastActivityEntry(entries);
  if (!lastEntry) return null;
  let bank;
  try { bank = tagQuestions(await loadQuestionBank(lastEntry.item), lastEntry.item, lastEntry.categoryKey); }
  catch { return null; }
  if (!bank.length) return null;
  const sameCategoryEntries = entries.filter(e => e.categoryKey === lastEntry.categoryKey && e.item.id !== lastEntry.item.id);
  const extra = sameCategoryEntries.length ? await loadBanksForEntries(shuffle(sameCategoryEntries)) : [];
  return dedupeQuestionsById([...shuffle(bank), ...shuffle(extra)]);
}

// SANA ÖZEL KARMA: zayıf + son çalışılan + hiç görülmemiş konuları harmanla
async function buildPersonalPool(entries) {
  const weakEntries = getWeakEntries(entries, 4);
  const lastEntry = findLastActivityEntry(entries);
  const unseenEntries = getUnseenEntries(entries, lastEntry ? [lastEntry] : []);

  const wrongPool = shuffle(Object.values(progress.wrongQuestions));
  const weakBank = weakEntries.length ? shuffle(await loadBanksForEntries(weakEntries)) : [];
  let lastBank = [];
  if (lastEntry) {
    try { lastBank = shuffle(tagQuestions(await loadQuestionBank(lastEntry.item), lastEntry.item, lastEntry.categoryKey)); }
    catch { lastBank = []; }
  }
  const unseenBank = unseenEntries.length ? shuffle(await loadBanksForEntries(unseenEntries)) : [];

  const combined = dedupeQuestionsById([...wrongPool, ...weakBank, ...lastBank, ...unseenBank]);
  return combined.length ? combined : null;
}

async function startSmartPractice() {
  if (!requirePremiumOrWarn()) return;
  const entries = getActiveDocuments();
  if (!entries.length) {
    closeRouteSheet();
    return showToast('Henüz aktif soru paketi bulunmuyor.');
  }

  showToast('Rota hazırlanıyor…');

  let pool = null;
  try {
    if (routeSettings.mode === 'Zayıf Konular') {
      pool = await buildWeakPool(entries);
      if (!pool) showToast('Henüz yeterli zayıf konu verisi yok, karma sorular getiriliyor.');
    } else if (routeSettings.mode === 'Son Çalışılan Konu') {
      pool = await buildLastActivityPool(entries);
      if (!pool) showToast('Daha önce çalışılan bir konu bulunamadı, karma sorular getiriliyor.');
    } else if (routeSettings.mode === 'Sana Özel Karma') {
      pool = await buildPersonalPool(entries);
    }
    if (!pool || !pool.length) pool = await buildRandomPool(entries);
  } catch (error) {
    pool = null;
  }

  if (!pool || !pool.length) {
    closeRouteSheet();
    return showToast('Şu an hazır bir soru paketi bulunamadı, lütfen tekrar dene.');
  }

  const questions = shuffle(dedupeQuestionsById(pool)).slice(0, Math.min(routeSettings.questions, pool.length));

  closeAllSheets(topicSheet);
  topicSheet.classList.add('open');
  topicSheet.setAttribute('aria-hidden', 'false');
  topicBackdrop.classList.add('open');

  startQuiz({
    questions,
    kind: 'route',
    title: 'Bugünkü Rota',
    subtitle: `${routeSettings.mode} • ${routeSettings.questions} Soru`,
    returnView: closeTopicSheet
  });
}

function startQuiz({ questions, documentItem = null, section = null, kind, sessionId = null, title, subtitle, returnView, customTimeSeconds = null }) {
  clearInterval(timerInterval);
  timerInterval = null;

  const isTimed = customTimeSeconds !== null ? true : (routeSettings.time === 'Süreli' || kind !== 'route');
  const totalTime = customTimeSeconds !== null ? customTimeSeconds : (isTimed ? questions.length * QUESTION_TIME_LIMIT : 9999);

  // NOT (2026-08-18 sıralama düzeltmesi, 2026-09'da güncellendi): kind ===
  // 'kadro-exam' için sıra korunmalı — buildKadroExamPool soruları zaten
  // doğru sıraya (Ek-2 blueprint sırası) diziyor. 'mock' türü, denemeler/
  // deneme_questions'a dayanan eski sabit-deneme akışıyla birlikte kaldırıldı
  // (bkz. bankView) ama EXAM_KINDS/orderedQuestions'ta geriye dönük uyumluluk
  // için bırakıldı — olası eski/önbelleğe alınmış quiz state'i hâlâ doğru
  // sırayı korur. Rastgele test, konu tekrarı gibi gerçekten rastgele sıra
  // istenen türlerde shuffle devam ediyor.
  const orderedQuestions = (kind === 'kadro-exam' || kind === 'mock') ? questions : shuffle(questions);

  state.quiz = {
    questions: orderedQuestions.map(question => ({ ...question, userSelected: null, answerRecorded: false })),
    sourceQuestions: questions,
    documentItem, section, kind, sessionId, title, subtitle, isTimed, timeLeft: totalTime, returnView,
    index: 0, completionRecorded: false, revealed: false
  };

  // YENİ: son çalışılan konuyu işaretle
  if (documentItem && ['section', 'random', 'topic'].includes(kind)) {
    const categoryKeyGuess = state.quiz.questions[0]?.categoryKey || null;
    progress.lastActivity = { documentId: documentItem.id, categoryKey: categoryKeyGuess, timestamp: new Date().toISOString() };
    window.SRProgressSync.touchField(progress, 'lastActivity');
    saveProgress();
  }

  renderQuiz();
  if (state.quiz.isTimed) startQuizTimer();
}

function recordAnswer(question, selected) {
  if (question.answerRecorded) return;
  question.answerRecorded = true;
  const isCorrect = selected === question.answerIndex;
  // NOT (2026-09-05): "Gerçek Sınav Formatı" (kind: 'kadro-exam') yanlışları
  // kalıcı "Yanlışlarım" havuzuna eklenmiyor — o havuz konu bazlı tekrar
  // içindir, tam kapsamlı bir deneme sınavının yanlışları oraya karışınca
  // hangi KONUDA zayıf olduğunu değil, "sınavda ne kaçırdığını" gösteriyordu.
  // Sınavın kendi sonuç ekranı (renderQuizResult/mistakeItemHTML) zaten
  // quiz.questions üzerinden bağımsız çalışıyor, bu değişiklik ondan etkilenmez.
  const skipWrongPool = EXAM_KINDS.includes(state.quiz?.kind);
  if (isCorrect) {
    const previousWrong = progress.wrongQuestions[question.id];
    if (previousWrong) {
      const categoryKey = previousWrong.categoryKey || question.categoryKey || 'other';
      window.SRProgressSync.setKey(progress, 'completedSections', wrongFixedKey(categoryKey, question.id), new Date().toISOString());
      window.SRProgressSync.deleteKey(progress, 'wrongQuestions', question.id);
    }
  } else if (!skipWrongPool) {
    // Daha önce düzeltilmiş bir soru yeniden yanlış yapılırsa tekrar "Kalan"a döner.
    clearWrongFixedForQuestion(question.id);
    window.SRProgressSync.setKey(progress, 'wrongQuestions', question.id, {
      id: question.id, prompt: question.prompt, options: question.options, answerIndex: question.answerIndex,
      sectionId: question.topicId || null, documentId: question.documentId || null,
      documentTitle: question.documentTitle || null, categoryKey: question.categoryKey || null,
      explanation: question.explanation || null
    });
  }
  // NOT (2026-09-05): "Gerçek Sınav Formatı" (kind: 'kadro-exam') soruları
  // genel "Soru Bankası İlerlemen" / "çözülen soru" sayacına da dahil
  // edilmiyor — o sayaç gerçek çalışma/pratik hacmini göstermeli, tam
  // kapsamlı bir deneme denemesi (60-100+ soru) tek seferde bu sayıyı
  // yapay şekilde şişirmemeli. skipWrongPool ile aynı koşulu paylaşıyor.
  if (!skipWrongPool) {
    window.SRProgressSync.recordAnswer(
      progress,
      getProgressDeviceId(),
      isCorrect,
      dateKey(),
      question.documentId || null,
      progress.userId
    );
    window.SRProgressSync.markSeen(progress, question.id);
  }
  saveProgress();
}
function quizScore(quiz) {
  return quiz.questions.filter(question => question.userSelected === question.answerIndex).length;
}


function renderQuiz() {
  const quiz = state.quiz;
  if (!quiz) return;
  topicSheet.classList.add('quiz-active');
  const current = quiz.questions[quiz.index];
  const total = quiz.questions.length;
  const letters = ['A', 'B', 'C', 'D', 'E'];

  const timerDisplay = quiz.isTimed ?
    `<div class="quiz-premium-timer" id="quizTimer">${svg('clock')} ${String(Math.floor(quiz.timeLeft / 60)).padStart(2, '0')}:${String(quiz.timeLeft % 60).padStart(2, '0')}</div>` :
    `<div class="quiz-premium-timer" style="color:var(--green);background:var(--green2);">Süresiz</div>`;

  topicList.innerHTML = `
    <div class="quiz-premium-layout">
      <div class="quiz-premium-header">
        <div class="quiz-premium-topbar">
          <button id="quizBackButton" type="button" aria-label="Geri">${svg('back')}</button>
          <div class="quiz-premium-titles">
            <h2>${escapeHtml(quiz.title)}</h2>
          </div>
          <div class="quiz-premium-top-actions">
            <button type="button" class="topbar-action topbar-finish" id="quizFinishEarlyButton" aria-label="Sınavı Bitir">Bitir</button>
            <button type="button" class="topbar-action ${progress.reportedQuestions[current.id] ? 'active' : ''}" id="quizReportButton" aria-label="${progress.reportedQuestions[current.id] ? 'Bildirimi Geri Al' : 'Soruyu Bildir'}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>
            </button>
          </div>
        </div>

        <div class="quiz-premium-progress">
          <span class="progress-text"><strong>${quiz.index + 1}</strong> / ${total}</span>
          <div class="progress-track">
            <div class="progress-fill" style="width:${Math.round(((quiz.index + 1) / total) * 100)}%"></div>
            <div class="progress-handle" style="left:${Math.round(((quiz.index + 1) / total) * 100)}%"></div>
          </div>
          ${timerDisplay}
        </div>
      </div>

      <div class="quiz-premium-card-wrapper">
        <div class="quiz-premium-card">
          <h3 class="quiz-question-text">${escapeHtml(current.prompt)}</h3>

          <div class="quiz-options">
            ${current.options.map((option, index) => {
              let className = 'quiz-option';
              let iconHtml = '';
              const answered = current.userSelected !== null;
              const deferReveal = DEFERRED_REVEAL_KINDS.includes(quiz.kind) && !quiz.revealed;
              if (deferReveal) {
                if (current.userSelected === index) className += ' selected';
              } else if (answered && index === current.answerIndex) {
                className += ' correct';
                iconHtml = `<svg class="status-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
              } else if (current.userSelected === index) {
                className += ' wrong';
                iconHtml = `<svg class="status-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
              }
              return `
              <button class="${className}" data-answer-index="${index}" type="button">
                <span class="quiz-option-letter">${letters[index] || index + 1}</span>
                <span class="quiz-option-text">${escapeHtml(option)}</span>
                ${iconHtml}
              </button>`;
            }).join('')}
          </div>
        </div>
      </div>

      <div class="quiz-premium-footer">
        <button class="footer-btn btn-prev" id="quizPrevButton" type="button" ${quiz.index === 0 ? 'disabled' : ''}>
          ${svg('arrowLeft')} Önceki
        </button>
        <button class="footer-btn btn-grid" id="quizGridButton" type="button">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>
          Sorular
        </button>
        <button class="footer-btn btn-next" id="quizNextButton" type="button">
          ${quiz.index === total - 1 ? 'Sonucu Gör' : 'Sonraki Soru'} ${svg('arrowRight')}
        </button>
      </div>
      <div class="quiz-nav-overlay" id="quizNavOverlay">
        <div class="quiz-nav-sheet">
          <div class="quiz-nav-head"><strong>Sorular</strong><button type="button" id="quizNavClose" aria-label="Kapat">×</button></div>
          <div class="quiz-nav-grid" id="quizNavGrid"></div>
        </div>
      </div>
      <div class="quiz-nav-overlay" id="reportModalOverlay">
        <div class="quiz-nav-sheet report-modal-sheet">
          <div class="quiz-nav-head">
            <strong>Soruyu Bildir</strong>
            <button type="button" id="reportModalClose" aria-label="Kapat">×</button>
          </div>
          <div id="reportModalNewContent">
            <p class="report-modal-desc">Soruyla ilgili hata veya yorumunu yaz.</p>
            <textarea id="reportModalNote" class="report-modal-textarea" placeholder="Notunu buraya yaz… (isteğe bağlı)" rows="4"></textarea>
            <button type="button" class="report-modal-send" id="reportModalSend">Gönder</button>
          </div>
          <div id="reportModalUndoContent" style="display:none">
            <p class="report-modal-desc">Bu soruyu daha önce bildirdin. Bildirimi geri almak istiyor musun?</p>
            <button type="button" class="report-modal-send report-modal-undo" id="reportModalUndo">Bildirimi Geri Al</button>
          </div>
        </div>
      </div>
    </div>`;
  
  topicSheet.scrollTop = 0;
  bindQuizEvents();
  
  // Timer durmuşsa tekrar başlat
  if (state.quiz && state.quiz.isTimed && !timerInterval) {
    startQuizTimer();
  }
}

function startQuizTimer() {
  clearInterval(timerInterval);
  timerInterval = null;
  const quiz = state.quiz;
  if (!quiz || quiz.timeLeft <= 0) return;
  timerInterval = window.setInterval(() => {
    const timer = document.getElementById('quizTimer');
    if (!timer || !state.quiz || state.quiz !== quiz) {
      clearInterval(timerInterval);
      timerInterval = null;
      return;
    }
    if (quiz.timeLeft <= 0) {
      clearInterval(timerInterval);
      timerInterval = null;
      return;
    }
    quiz.timeLeft -= 1;
    const m = String(Math.floor(quiz.timeLeft / 60)).padStart(2, '0');
    const s = String(quiz.timeLeft % 60).padStart(2, '0');
    timer.innerHTML = `${svg('clock')} ${m}:${s}`;
    if (quiz.timeLeft === 0) {
      clearInterval(timerInterval);
      timerInterval = null;
      showToast('Sınavın süresi doldu.');
      finishQuizAfterTimeout();
    }
  }, 1000);
}

// Y-02 (2026-09-15): Süre dolduğunda da normal bitiş yolu izlenir.
// Ertelenmiş cevaplı türlerde (random / section / kadro-exam) önce cevaplar
// açılır ve recordAnswer çalışır; aksi halde puan 0 çıkıyor, çözülen sorular
// ilerlemeye hiç yazılmıyordu.
function finishQuizAfterTimeout() {
  const quiz = state.quiz;
  if (!quiz) return;
  if (DEFERRED_REVEAL_KINDS.includes(quiz.kind) && !quiz.revealed) {
    revealDeferredQuizAndFinish();
  } else {
    renderQuizResult();
  }
}

function toggleQuestionFlag(question) {
  if (progress.flaggedQuestions[question.id]) {
    window.SRProgressSync.deleteKey(progress, 'flaggedQuestions', question.id);
    showToast('İşaret kaldırıldı.');
  } else {
    window.SRProgressSync.setKey(progress, 'flaggedQuestions', question.id, true);
    showToast('Soru işaretlendi.');
  }
  haptic(14);
  saveProgress();
  renderQuiz();
}

async function sendQuestionReport(payload) {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) throw new Error('Oturum bulunamadı.');
  const response = await fetch(`${SUPABASE_URL}/functions/v1/report-question`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
    body: JSON.stringify(payload)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Bildirim gönderilemedi.');
  return data;
}

// Play Billing: native plugin'den gelen { productId, purchaseToken } bilgisini
// verify-play-purchase Edge Function'a gönderip sunucu tarafında doğrulatır.
// is_premium bu çağrının sonucuna göre SUNUCUDA set edilir, istemci hiçbir
// zaman doğrudan yazmaz.
// R-04 (2026-09-15): Satın alma, kullanıcı kimliğinin SHA-256 özetine
// bağlanır (BillingFlowParams.setObfuscatedAccountId). Sunucu aynı özeti
// kendi tarafında hesaplayıp karşılaştırır.
async function getBillingAccountId() {
  const userId = window.currentUser?.id;
  if (!userId || !window.crypto?.subtle) return null;
  const digest = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(userId));
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function verifyPlayPurchase(productId, purchaseToken) {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) throw new Error('Oturum bulunamadı.');
  const response = await fetch(`${SUPABASE_URL}/functions/v1/verify-play-purchase`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
    body: JSON.stringify({ product_id: productId, purchase_token: purchaseToken, client_capabilities: ['pending'] })
  });
  const data = await response.json().catch(() => ({}));
  if (response.status === 202 && data.pending) return data;
  if (!response.ok) throw new Error(data.error || 'Satın alma doğrulanamadı.');
  return data;
}

async function purchasePremiumProduct(productId, buttonEl) {
  const billing = window.Capacitor?.Plugins?.PlayBilling;
  if (!billing) {
    showToast('Satın alma yalnızca Android uygulamasında kullanılabilir.');
    return;
  }
  const priceEl = buttonEl?.querySelector('.premium-btn-price');
  const originalPriceText = priceEl?.textContent;
  if (buttonEl) buttonEl.disabled = true;
  if (priceEl) priceEl.textContent = 'İşleniyor…';
  try {
    const accountId = await getBillingAccountId();
    const purchase = await billing.purchase(accountId ? { productId, accountId } : { productId });
    if (purchase.purchaseState === 'PENDING') {
      showToast('Ödemen onay bekliyor. Tamamlandığında premium otomatik açılacak.');
      return;
    }
    const result = await verifyPlayPurchase(purchase.productId || productId, purchase.purchaseToken);
    if (result?.pending) {
      showToast('Ödemen onay bekliyor. Tamamlandığında premium otomatik açılacak.');
      return;
    }
    logEvent('purchase_success', { product_id: purchase.productId || productId });
    // O-09: Premium durumunu sunucudan yeniden oku (tahmin etme).
    await refreshPremiumStatus();
    showToast('Premium aktif edildi!');
    document.getElementById('premiumModalOverlay')?.classList.remove('open');
    render();
    return result;
  } catch (error) {
    if (error?.code === 'USER_CANCELED') return;
    if (error?.code === 'ITEM_ALREADY_OWNED') {
      restoreUnverifiedPurchases();
    }
    console.error('Satın alma hatası:', error);
    showToast(error?.message || 'Satın alma tamamlanamadı.');
  } finally {
    if (buttonEl) buttonEl.disabled = false;
    if (priceEl && originalPriceText) priceEl.textContent = originalPriceText;
  }
}

// Paywall butonlarındaki fiyatları Google Play'den canlı çeker. Play
// Console'da fiyat değiştiğinde kod değişikliği gerekmeden buton metni
// otomatik güncellenir. Plugin yoksa (web/tarayıcı) veya sorgu başarısız
// olursa buton, HTML'e gömülü sabit yedek fiyatta kalır.
async function updatePremiumButtonPrices() {
  const billing = window.Capacitor?.Plugins?.PlayBilling;
  const buttons = Array.from(document.querySelectorAll('.premium-buy-btn'));
  if (!billing || buttons.length === 0) return;
  try {
    const { products } = await billing.getProductDetails({ productIds: buttons.map((b) => b.dataset.productId) });
    const priceByProductId = Object.fromEntries((products || []).map((p) => [p.productId, p.formattedPrice]));
    buttons.forEach((btn) => {
      const livePrice = priceByProductId[btn.dataset.productId];
      const priceEl = btn.querySelector('.premium-btn-price');
      if (livePrice && priceEl) priceEl.textContent = livePrice;
    });
  } catch (error) {
    console.error('Fiyat bilgisi alınamadı, yedek fiyatlar kullanılıyor:', error);
  }
}

// Uygulama açılışında yarım kalmış (doğrulanmamış) satın almaları tamamlamayı
// dener. Kullanıcı ödemeyi yaptı ama uygulama kapandıysa vb. durumlar için.
// O-09 (2026-09-15): Başarılı doğrulamadan sonra premium durumu yenilenir.
// R-05 (2026-09-15): Bekleyen bir satın alma sonradan tamamlanırsa native
// eklenti "purchaseUpdated" olayı gönderir; burada dinlenip doğrulanır.
let purchaseListenerRegistered = false;

async function handleBackgroundPurchase(purchase) {
  if (!purchase?.purchaseToken || purchase.purchaseState === 'PENDING') return false;
  try {
    const result = await verifyPlayPurchase(purchase.productId, purchase.purchaseToken);
    if (result?.ok) {
      await refreshPremiumStatus();
      render();
      return true;
    }
  } catch (_) {
    // Bir sonraki açılışta tekrar denenir.
  }
  return false;
}

async function restoreUnverifiedPurchases() {
  const billing = window.Capacitor?.Plugins?.PlayBilling;
  if (!billing) return;
  if (!purchaseListenerRegistered && typeof billing.addListener === 'function') {
    purchaseListenerRegistered = true;
    try {
      billing.addListener('purchaseUpdated', async purchase => {
        if (await handleBackgroundPurchase(purchase)) showToast('Premium aktif edildi!');
      });
    } catch (error) {
      console.warn('Satın alma dinleyicisi kurulamadı:', error);
    }
  }
  try {
    const { purchases } = await billing.restorePurchases();
    let restored = false;
    for (const purchase of purchases || []) {
      if (await handleBackgroundPurchase(purchase)) restored = true;
    }
    if (restored) showToast('Önceki satın alman doğrulandı, premium aktif.');
  } catch (_) { /* Play Billing kullanılamıyorsa (ör. web) sessizce geç */ }
}

function reportQuestion(question, rerender) {
  const doRerender = typeof rerender === 'function' ? rerender : renderQuiz;
  const overlay = document.getElementById('reportModalOverlay');
  if (!overlay) return;

  const isReported = Boolean(progress.reportedQuestions[question.id]);
  document.getElementById('reportModalNewContent').style.display = isReported ? 'none' : 'block';
  document.getElementById('reportModalUndoContent').style.display = isReported ? 'block' : 'none';
  if (!isReported) document.getElementById('reportModalNote').value = '';

  overlay.classList.add('open');

  const closeModal = () => overlay.classList.remove('open');
  const feedbackQuestionId = Object.prototype.hasOwnProperty.call(question, 'feedbackQuestionId')
    ? question.feedbackQuestionId
    : question.id;
  document.getElementById('reportModalClose').onclick = closeModal;
  overlay.onclick = e => { if (e.target === overlay) closeModal(); };

  // Geri al
  document.getElementById('reportModalUndo').onclick = async () => {
    const previousReportState = progress.reportedQuestions[question.id];
    window.SRProgressSync.deleteKey(progress, 'reportedQuestions', question.id);
    haptic(14);
    saveProgress();
    closeModal();
    doRerender();

    try {
      await sendQuestionReport({
        action: 'undo',
        question_id: feedbackQuestionId
      });
    } catch (err) {
      window.SRProgressSync.setKey(progress, 'reportedQuestions', question.id, previousReportState || true);
      saveProgress();
      doRerender();
      showToast('Bildirim geri alınamadı, tekrar dene.');
      return;
    }
    showToast('Bildirim geri alındı.');
  };

  // Gönder
  document.getElementById('reportModalSend').onclick = async () => {
    const note = document.getElementById('reportModalNote').value.trim();
    closeModal();
    window.SRProgressSync.setKey(progress, 'reportedQuestions', question.id, true);
    haptic(14);
    saveProgress();
    doRerender();

    try {
      await sendQuestionReport({
        action: 'report',
        question_id: feedbackQuestionId,
        note
      });
      showToast('Bildirimin alındı, teşekkürler.');
    } catch (err) {
      window.SRProgressSync.deleteKey(progress, 'reportedQuestions', question.id);
      saveProgress();
      doRerender();
      showToast('Bildirim gönderilemedi, tekrar dene.');
    }
  };
}

function openQuizNav() {
  const quiz = state.quiz;
  const overlay = document.getElementById('quizNavOverlay');
  const grid = document.getElementById('quizNavGrid');
  if (!overlay || !grid) return;
  grid.innerHTML = quiz.questions.map((question, index) => {
    let className = 'quiz-nav-cell';
    if (index === quiz.index) className += ' current';
    else if (question.userSelected !== null) {
      if (DEFERRED_REVEAL_KINDS.includes(quiz.kind) && !quiz.revealed) className += ' answered';
      else className += question.userSelected === question.answerIndex ? ' answered-correct' : ' answered-wrong';
    }
    if (progress.flaggedQuestions[question.id]) className += ' flagged';
    return `<button class="${className}" data-jump-index="${index}" type="button">${index + 1}</button>`;
  }).join('');
  grid.querySelectorAll('[data-jump-index]').forEach(button => button.addEventListener('click', () => {
    finalizeQuestionAnswer(quiz.questions[quiz.index]);
    quiz.index = Number(button.dataset.jumpIndex);
    overlay.classList.remove('open');
    renderQuiz();
  }));
  overlay.classList.add('open');
}

// Aktif sınavı kapatıp quiz.returnView() ile önceki konu listesine döner.
// Görünür geri butonu (#quizBackButton) VE donanım geri tuşu (Android) aynı
// işlevi kullanır, böylece ikisi arasında davranış farkı olmaz.
function exitQuizToReturnView() {
  clearInterval(timerInterval);
  timerInterval = null;
  const quiz = state.quiz;
  if (!quiz) return;
  finalizeQuestionAnswer(quiz.questions[quiz.index]);
  const returnView = quiz.returnView;
  state.quiz = null;
  topicSheet.classList.remove('quiz-active');
  returnView();
}

// NOT (2026-09-05 düzeltme): eskiden bir şıkka basar basmaz cevap hem
// ekranda kilitleniyor (disabled) hem de recordAnswer ile KALICI olarak
// sayılıyordu — kullanıcı fikrini değiştirip başka bir şıkka basamıyordu,
// haklı olarak "saçma" buldu. Artık bir soruyu görüntülerken şıklar hiç
// kilitlenmiyor; asıl sayım (recordAnswer) SADECE o sorudan ayrılırken
// (sonraki/önceki soruya geçerken, soru haritasından zıplarken ya da
// sınavdan çıkarken) o an ekranda seçili olan şıkka göre yapılıyor. Bu
// sayede istediği kadar fikir değiştirebiliyor, sadece son seçimi sayılıyor.
// Ertelenen (random/kadro-exam) türlerde zaten ayrı bir toplu kayıt akışı
// var (revealDeferredQuizAndFinish), o yüzden bu fonksiyon onlara dokunmaz.
function finalizeQuestionAnswer(question) {
  if (!question || question.userSelected === null || question.answerRecorded) return;
  const quiz = state.quiz;
  if (quiz && DEFERRED_REVEAL_KINDS.includes(quiz.kind)) return;
  recordAnswer(question, question.userSelected);
}

function bindQuizEvents() {
  const quiz = state.quiz;
  if (!quiz) return;
  
  const quizBackButton = document.getElementById('quizBackButton');
  if (quizBackButton) {
    quizBackButton.addEventListener('click', exitQuizToReturnView);
  }
  
  topicList.querySelectorAll('[data-answer-index]').forEach(button => {
    button.addEventListener('click', () => {
      const current = quiz.questions[quiz.index];
      const selected = Number(button.dataset.answerIndex);
      current.userSelected = selected;
      haptic(DEFERRED_REVEAL_KINDS.includes(quiz.kind) ? 16 : (selected === current.answerIndex ? 16 : [12, 40, 12]));
      renderQuiz();
    });
  });
  
  document.getElementById('quizPrevButton')?.addEventListener('click', () => {
    if (quiz.index < 1) return;
    finalizeQuestionAnswer(quiz.questions[quiz.index]);
    quiz.index -= 1;
    renderQuiz();
  });
  
  document.getElementById('quizNextButton')?.addEventListener('click', () => {
    finalizeQuestionAnswer(quiz.questions[quiz.index]);
    if (quiz.index < quiz.questions.length - 1) {
      quiz.index += 1;
      renderQuiz();
    } else if (DEFERRED_REVEAL_KINDS.includes(quiz.kind) && !quiz.revealed) {
      revealDeferredQuizAndFinish();
    } else {
      renderQuizResult();
    }
  });
  
  document.getElementById('quizReportButton')?.addEventListener('click', () => reportQuestion(quiz.questions[quiz.index]));
  document.getElementById('quizGridButton')?.addEventListener('click', openQuizNav);
  document.getElementById('quizNavClose')?.addEventListener('click', () => {
    const overlay = document.getElementById('quizNavOverlay');
    if (overlay) overlay.classList.remove('open');
  });
  
  document.getElementById('quizNavOverlay')?.addEventListener('click', event => {
    if (event.target.id === 'quizNavOverlay') event.currentTarget.classList.remove('open');
  });

  // NOT (2026-09-05): eskiden sınavı tamamlamanın tek yolu son soruya kadar
  // "Sonraki Soru"ya basmaktı — kullanıcı erken bitiremiyordu. Bu buton,
  // "Sorular" panelinden, geri kalan soruları boş bırakarak sonuç ekranına
  // geçmeyi sağlıyor (boş bırakılanlar zaten yanlış sayılıyor, quizScore
  // zaten userSelected===null'ı otomatik "yanlış" kabul ediyor).
  document.getElementById('quizFinishEarlyButton')?.addEventListener('click', () => {
    const answeredCount = quiz.questions.filter(q => q.userSelected !== null).length;
    const remaining = quiz.questions.length - answeredCount;
    const confirmMsg = remaining > 0
      ? `${remaining} soru boş kalacak, yine de sınavı bitirmek istiyor musun?`
      : 'Sınavı bitirmek istediğine emin misin?';
    if (!window.confirm(confirmMsg)) return;
    document.getElementById('quizNavOverlay')?.classList.remove('open');
    finalizeQuestionAnswer(quiz.questions[quiz.index]);
    if (DEFERRED_REVEAL_KINDS.includes(quiz.kind) && !quiz.revealed) {
      revealDeferredQuizAndFinish();
    } else {
      renderQuizResult();
    }
  });
}

function recordQuizCompletion(quiz) {
  if (quiz.completionRecorded) return;
  quiz.completionRecorded = true;
  // D-07 (2026-09-15): Hiç cevap verilmeden bitirilen test "tamamlandı"
  // sayılmaz (bölüm ilerlemesini ve deneme rozetlerini şişirmesin).
  const answeredCount = quiz.questions.filter(question => question.userSelected !== null && question.userSelected !== undefined).length;
  if (answeredCount === 0) return;
  const score = quizScore(quiz);
  progress.completedTests.push({
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    title: quiz.title,
    kind: quiz.kind,
    documentId: quiz.documentItem?.id || null,
    sectionId: quiz.section?.id || null,
    score,
    total: quiz.questions.length,
    completedAt: new Date().toISOString()
  });
  if (quiz.section?.id) window.SRProgressSync.setKey(progress, 'completedSections', quiz.section.id, new Date().toISOString());
  saveProgress();
}

// "Rastgele Test" (kind: 'random') VE "Gerçek Sınav Formatı" (kind:
// 'kadro-exam') sırasında ekranda anlık doğru/yanlış rengi gösterilmez —
// gerçek bir sınav gibi, sonuç sadece bitince topluca açılır. 'random'da
// cevap anahtarı client'a hiç inmemişti (bkz. content-repo.js
// start_random_test), quiz bitince tek seferlik reveal_quiz_session RPC'siyle
// SADECE bu oturumun sorularının cevabı açılır. 'kadro-exam'da ise answerIndex
// zaten baştan client'ta var (buildKadroExamPool premium'a özel, sunucudan
// tam soru çekiyor) — orada RPC'ye gerek yok, sadece görsel geri bildirimi
// erteliyoruz. İkisinde de sonunda normal recordAnswer/progress akışı çalışıp
// sonuç ekranına geçilir.
async function revealDeferredQuizAndFinish() {
  const quiz = state.quiz;
  if (!quiz || quiz.revealed) return renderQuizResult();
  if (quiz.kind === 'random') {
    showToast('Sonuçlar hazırlanıyor…');
    try {
      const reveal = await ContentRepo.revealQuizSession(quiz.sessionId);
      const byId = new Map(reveal.map(row => [row.id, row]));
      quiz.questions.forEach(question => {
        const info = byId.get(question.id);
        if (!info) return;
        question.answerIndex = info.answerIndex;
        question.explanation = info.explanation;
      });
    } catch (error) {
      showToast('Sonuçlar alınamadı, tekrar dene.');
      return;
    }
  }
  quiz.revealed = true;
  quiz.questions.forEach(question => {
    if (question.userSelected !== null) recordAnswer(question, question.userSelected);
  });
  renderQuizResult();
}

function renderQuizResult() {
  clearInterval(timerInterval);
  timerInterval = null;
  const quiz = state.quiz;
  if (!quiz) return;
  recordQuizCompletion(quiz);
  const score = quizScore(quiz);
  const total = quiz.questions.length;
  const percentage = total ? Math.round((score / total) * 100) : 0;
  logEvent('quiz_completed', { kind: quiz.kind || 'standard', score, total, pct: percentage });
  topicSheet.classList.remove('quiz-active');
  topicSheet.classList.add('document-flow');
  applySheetHeader({ title: quiz.title, subtitle: 'Test tamamlandı', eyebrow: 'SONUÇ', icon: 'trophy', iconClass: 'red' });
  topicBreadcrumbWrap.innerHTML = '';
  setSheetProgress('Henüz yanıtlanmış soru yok', percentage, 'başarı');
  const wrongAnswers = quiz.questions.filter(question => question.userSelected !== null && question.userSelected !== question.answerIndex);
  topicList.innerHTML = `<section class="quiz-result-card"><strong>${score} / ${total}</strong><span>Doğru cevap • %${percentage} başarı</span></section>${wrongAnswers.length ? `<div class="quiz-result-list"><span class="quiz-result-list-title">YANLIŞ YAPILAN SORULAR</span>${wrongAnswers.map((question, idx) => mistakeItemHTML(question, idx)).join('')}</div>` : '<p class="quiz-result-perfect">Tebrikler, yanıtladığın soruların tamamı doğru!</p>'}<div class="quiz-result-actions"><button class="reader-secondary" id="quizRetryButton" type="button">Tekrar Dene</button><button class="reader-primary" id="quizReturnButton" type="button">Listeye Dön</button></div>`;
  document.getElementById('quizRetryButton').addEventListener('click', () => {
    if (quiz.kind === 'random') {
      // NOT (2026-09-05): random quiz artık sessionId'ye bağlı (reveal_quiz_session
      // sadece o oturumun sorularını açıyor) — eski soru kümesini yeniden
      // kullanamayız, yeni bir start_random_test çağrısı (yeni session) gerekiyor.
      const categoryKey = quiz.questions[0]?.categoryKey || null;
      openRandomQuiz(quiz.documentItem, categoryKey);
      return;
    }
    if (quiz.kind === 'kadro-exam') {
      // NOT (2026-09-05): kadro-exam da her seferinde havuzdan taze bir
      // seçim yapıyor (buildKadroExamPool) — eski (artık revealed=true,
      // answerIndex açılmış) soru kümesini tekrar kullanmak hem "gerçek
      // sınav" hissini bozar hem de renk gösterimini yeniden erteleyemez.
      startKadroExam();
      return;
    }
    if (quiz.kind === 'mini-exam') {
      startQuickMiniExam();
      return;
    }
    if (quiz.kind === 'mixed-exam') {
      startMixedGeneralExam();
      return;
    }
    const retry = { ...quiz, questions: quiz.sourceQuestions };
    startQuiz({ questions: retry.questions, documentItem: retry.documentItem, section: retry.section, kind: retry.kind, title: retry.title, subtitle: retry.subtitle, returnView: retry.returnView });
  });
  document.getElementById('quizReturnButton').addEventListener('click', () => {
    const returnView = quiz.returnView;
    state.quiz = null;
    returnView();
  });
  topicSheet.scrollTop = 0;
}

navButtons.forEach(button => button.addEventListener('click', () => window.go(button.dataset.nav)));
closeTopicSheetButton.addEventListener('click', closeTopicSheet);
topicBackdrop.addEventListener('click', () => closeAllSheets());

// ================= ANDROID DONANIM GERİ TUŞU =================
// native-ux.js, App plugin'in 'backButton' event'ini burada dinlenebilecek genel
// bir 'nativeux:backbutton' DOM event'ine çevirir (bkz. native-ux.js). Bu dinleyici
// açık olan en üstteki ekranı/paneli kapatır; hiçbiri açık değilse (ana ekrandayız)
// event'i tüketmeden bırakır — bu durumda native-ux.js'in kendi "çıkmak için tekrar
// bas" davranışı devreye girer. Amaç: quiz sırasında ya da bir panel açıkken
// yanlışlıkla uygulamadan çıkılmasını önlemek.
function handleHardwareBack() {
  // D-08 (2026-09-15): Zorunlu kadro kapısı açıkken geri tuşu uygulamayı
  // kapatmak dışında bir şey yapmaz (kapı atlanamaz).
  if (roleGate && roleGate.getAttribute('aria-hidden') === 'false') {
    return false;
  }
  const premiumOverlay = document.getElementById('premiumModalOverlay');
  if (premiumOverlay && premiumOverlay.classList.contains('open')) {
    premiumOverlay.classList.remove('open');
    return true;
  }
  const reportOverlay = document.getElementById('reportModalOverlay');
  if (reportOverlay && reportOverlay.classList.contains('open')) {
    reportOverlay.classList.remove('open');
    return true;
  }
  const quizNavOverlay = document.getElementById('quizNavOverlay');
  if (quizNavOverlay && quizNavOverlay.classList.contains('open')) {
    quizNavOverlay.classList.remove('open');
    return true;
  }
  if (searchSheet.classList.contains('open')) { closeSearchSheet(); return true; }
  if (topicSheet.classList.contains('open')) {
    // Gerçek (zamanlı/notlu) bir sınav hâlâ sürüyorsa yanlışlıkla çıkışı
    // engellemek için onay iste. Pratik testlerde (route/section/random) ve
    // sonuç ekranında ekstra sürtünme yok — görünür geri tuşuyla aynı davranış.
    if (state.quiz && EXAM_KINDS.includes(state.quiz.kind) && !state.quiz.completionRecorded) {
      if (!window.confirm('Sınavdan çıkmak istediğine emin misin? İlerlemen kaydedilmeyecek.')) return true;
    } else if (state.quiz && state.quiz.kind === 'random' && !state.quiz.revealed) {
      if (!window.confirm('Testten çıkarsan bu deneme hakkın kullanılmış sayılır. Çıkmak istiyor musun?')) return true;
    }
    if (state.quiz) { exitQuizToReturnView(); return true; }
    const sheetBackButton = document.getElementById('sheetBackButton');
    if (sheetBackButton) { sheetBackButton.click(); return true; }
    closeTopicSheet();
    return true;
  }
  if (routeSheet.classList.contains('open')) { closeRouteSheet(); return true; }
  if (state.view !== 'home') { go('home'); return true; }
  return false;
}
document.addEventListener('nativeux:backbutton', event => {
  if (handleHardwareBack()) event.preventDefault();
});

async function loadCatalogue() {
  state.catalogueError = '';
  state.catalogue = null;
  // Y-01 (cihaz testi sonrası): Cihaz çevrimdışıysa istekleri denemeden
  // (supabase-js yeniden deneme beklemeleri olmadan) hemen bilgilendir.
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    state.catalogueError = 'İnternet bağlantısı yok. Bağlantı gelince içerikler otomatik yüklenecek.';
    render();
    return;
  }
  render();
  try {
    // Çevrimdışıyken istek uzun süre askıda kalabiliyor; 15 sn sonra
    // "Tekrar Dene" ekranını göster.
    const withTimeout = (promise, ms) => Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('Sunucuya bağlanılamadı, internet bağlantını kontrol et.')), ms))
    ]);
    const [data, flashcardDecks] = await withTimeout(Promise.all([
      ContentRepo.fetchCatalogue(),
      // Flashcard desteleri çekilemese bile (ör. ağ hatası) katalog ekranı
      // çalışmaya devam etsin — bu yüzden hata burada yutulup boş dizi dönüyor.
      ContentRepo.fetchFlashcardDecks().catch(error => {
        console.error('Flashcard desteleri yüklenemedi:', error);
        return [];
      })
    ]), 15000);
    if (!data || typeof data !== 'object') throw new Error('Konu verisi geçerli değil.');
    state.catalogue = data;
    state.flashcardDecks = flashcardDecks;
    render();
    // Faz 4: ana ekrandaki "bugünkü tekrarlar" widget'ı için toplam gecikmiş
    // kart sayısı — katalog render edildikten SONRA arka planda çekiliyor,
    // ana ekranın açılışını bloke etmesin diye ayrı bir render() ile gelir.
    if (window.currentUser && flashcardDecks.length) {
      const role = progress.selectedRole;
      const roleFilteredDecks = flashcardDecks.filter(d => !role || !d.kadrolar || d.kadrolar.includes(role));
      ContentRepo.fetchDueFlashcardCounts(roleFilteredDecks.map(d => d.id))
        .then(counts => {
          state.totalDueFlashcards = Object.values(counts).reduce((sum, n) => sum + n, 0);
          syncLocalNotificationSchedule();
          if (state.totalDueFlashcards > 0) prefetchDueFlashcards().catch(() => {});
          if (state.view === 'home' || state.view === 'cards') render();
        })
        .catch(() => {}); // widget süsleme, sessizce geç
    }
    // Ana sayfadaki "Genel İlerleme" halkası için toplam soru bankası
    // büyüklüğü — aynı "arka planda çek, hazır olunca sessizce yeniden
    // render et" deseni.
    ContentRepo.fetchTotalQuestionCount()
      .then(total => {
        state.totalQuestionCount = total;
        if (state.view === 'home' || state.view === 'cards') render();
      })
      .catch(() => {});
    // Sınav tarihi artık paylaşılan/genel bir ayar (bkz. app_settings) —
    // her kullanıcı için aynı, admin dışında kimse değiştiremiyor.
    ContentRepo.fetchExamDate()
      .then(examDate => {
        state.sharedExamDate = examDate;
        syncLocalNotificationSchedule();
        if (state.view === 'home' || state.view === 'cards') render();
      })
      .catch(() => {});
  } catch (error) {
    state.catalogueError = error.message || 'Konu verisi yüklenemedi.';
    render();
  }
}

bindRouteSheetEvents();

// Y-01 (cihaz testi sonrası): Bağlantı geri gelince içerikleri ve profil
// bilgisini kendiliğinden yenile.
window.addEventListener('online', () => {
  if (!window.currentUser) return;
  if (!state.catalogue || state.catalogueError) loadCatalogue();
  if (window.currentUserIsPremium === null || window.currentUserIsPremium === undefined) refreshPremiumStatus();
});
document.addEventListener('sinavrotasi:profile-refreshed', () => {
  // Kadro okunamadığı için "Tekrar Dene" ekranı gösterildiyse, bilgi
  // geldiğinde normal açılış akışını yeniden başlat.
  if (profileLoadErrorShown) {
    window.location.reload();
    return;
  }
  if (window.currentUserRole && progress.selectedRole !== window.currentUserRole) {
    progress.selectedRole = window.currentUserRole;
    window.SRProgressSync.touchField(progress, 'selectedRole');
    saveProgress();
  }
  render();
});

// --- KADRO SEÇİM KAPISI ---
const roleGate = document.getElementById('roleGate');
const roleGateList = document.getElementById('roleGateList');
const roleGateContinue = document.getElementById('roleGateContinue');
let pendingRoleSelection = null;

function renderRoleGate() {
  roleGateList.innerHTML = ROLES.map(role => `
    <button class="role-gate-item" data-role-key="${role.key}" type="button">
      <span class="role-gate-item-icon">${svg(ROLE_ICONS[role.key] || 'book')}</span>
      <strong>${escapeHtml(role.label)}</strong>
      <span class="role-gate-item-arrow">${svg('arrow')}</span>
    </button>`).join('');
  roleGateList.querySelectorAll('[data-role-key]').forEach(button => {
    button.addEventListener('click', () => {
      pendingRoleSelection = button.dataset.roleKey;
      roleGateList.querySelectorAll('.role-gate-item').forEach(el => el.classList.toggle('selected', el === button));
      roleGateContinue.disabled = false;
      roleGateContinue.classList.add('enabled');
      haptic(14);
    });
  });
}

function openRoleGate(allowClose = false) {
  pendingRoleSelection = null;
  renderRoleGate();
  roleGateContinue.disabled = true;
  roleGateContinue.classList.remove('enabled');
  const closeBtn = document.getElementById('roleGateClose');
  if (closeBtn) closeBtn.style.display = allowClose ? 'flex' : 'none';
  roleGate.setAttribute('aria-hidden', 'false');
}

function closeRoleGate() {
  roleGate.setAttribute('aria-hidden', 'true');
}
document.getElementById('roleGateClose')?.addEventListener('click', closeRoleGate);

roleGateContinue?.addEventListener('click', async () => {
  if (!pendingRoleSelection) return;
  // O-08 (2026-09-15): Tek doğruluk kaynağı profiles.role. Önce sunucuya
  // yazılır; yalnızca başarılı olursa yerel ilerlemeye yansıtılır. Sunucu
  // kilidi (O-02) daha önce seçilmiş kadroyu korursa o değer kullanılır.
  const requestedRole = pendingRoleSelection;
  roleGateContinue.disabled = true;
  const { data: updatedRows, error } = await supabaseClient
    .from('profiles')
    .update({ role: requestedRole })
    .eq('id', window.currentUser.id)
    .select('id, role');
  if (error || !updatedRows || updatedRows.length === 0) {
    console.error('Kadro sunucuya kaydedilemedi:', error || 'profil satırı yok');
    showToast('Kadro seçimi kaydedilemedi. Bağlantını kontrol edip tekrar dene.');
    roleGateContinue.disabled = false;
    return;
  }
  const savedRole = updatedRows[0].role;
  if (savedRole !== requestedRole) {
    const label = ROLES.find(r => r.key === savedRole)?.label || savedRole;
    showToast(`Kadron daha önce ${label} olarak kaydedilmiş.`);
  }
  window.currentUserRole = savedRole;
  window.currentUserRoleError = false;
  progress.selectedRole = savedRole;
  window.SRProgressSync.touchField(progress, 'selectedRole');
  saveProgress();

  closeRoleGate();
  initializeApp();
});

let profileLoadErrorShown = false;
function showProfileLoadError() {
  profileLoadErrorShown = true;
  app.innerHTML = `<section class="screen neutral-screen"><div class="empty-state empty-state-error"><span class="empty-state-icon">${svg('book')}</span><h3>Hesap bilgilerin alınamadı</h3><p>Kadro bilgine ulaşılamadı. İnternet bağlantını kontrol edip tekrar dene.</p><button class="reader-primary" id="retryProfileButton" type="button">Tekrar Dene</button></div></section>`;
  document.getElementById('retryProfileButton')?.addEventListener('click', () => window.location.reload());
}

let appInitialized = false;
function initializeApp() {
  if (appInitialized) return;
  appInitialized = true;
  render();
  loadCatalogue();
  // Fire-and-forget: hata olursa loadMotivationalPhrases zaten kendi içinde
  // yakalayıp yerel yedeğe düşüyor, initializeApp'i (ve dolayısıyla splash
  // kapanışını) hiçbir şekilde bekletmemeli.
  loadMotivationalPhrases();
}

let authHandledOnce = false;
async function handleAuthenticated() {
  if (authHandledOnce) return;
  authHandledOnce = true;

  // O-10 (2026-09-19): window.NativeUX?.hideSplash() en sonda, tek noktada
  // çağrılıyordu — aradaki herhangi bir adım (initializeApp dahil) hata
  // fırlatırsa bu satıra hiç ulaşılmıyor ve splash ekranı sonsuza kadar açık
  // kalıyordu ("splash açılıyor ama uygulama gelmiyor"). try/finally ile
  // splash'in her durumda kapanmasını garanti ediyoruz; hata da konsola
  // basılıyor ki ileride aynı şey sessizce tekrar olmasın.
  try {
    const currentUserId = window.currentUser?.id || null;
    if (progress.userId !== currentUserId) {
      progress = defaultProgress();
      progress.userId = currentUserId;
    }

    restoreUnverifiedPurchases();
    initPremiumModal();

    // Yerel ve bulut ilerlemesini birleştir. Sunucunun körlemesine cihazdaki
    // verinin üstüne yazılması, çevrimdışı çözümlerin ilk girişte kaybolmasına
    // neden oluyordu.
    if (currentUserId) {
      try {
        const { data, error } = await supabaseClient
          .from('profiles')
          .select('progress, progress_version')
          .eq('id', currentUserId)
          .maybeSingle();
        if (error) {
          console.error('İlerleme sunucudan okunamadı:', error);
        } else if (data?.progress) {
          progress = mergeProgress(progress, sanitizeProgress(data.progress, currentUserId));
          progress.userId = currentUserId;
          knownProgressVersion = data.progress_version || 0;
        }
      } catch (err) {
        console.error('İlerleme senkronizasyonu başarısız:', err);
      }
    }

    // O-08 (2026-09-15): Sunucudaki kadro her zaman önceliklidir.
    if (window.currentUserRole && progress.selectedRole !== window.currentUserRole) {
      progress.selectedRole = window.currentUserRole;
      window.SRProgressSync.touchField(progress, 'selectedRole');
    }
    saveProgress();
    // İlk senkronizasyon: sınav tarihi ve bekleyen kart sayısı henüz gelmediyse
    // bu çağrı günlük hatırlatıcı/seri uyarısını yine de kurar; diğer ikisi
    // (sınav geri sayımı, tekrar hatırlatıcısı) kendi verileri gelince yukarıdaki
    // fetchExamDate/fetchDueFlashcardCounts noktalarında ayrıca senkronize edilir.
    syncLocalNotificationSchedule();

    if (progress.selectedRole) {
      initializeApp();
    } else if (window.currentUserRoleError) {
      // Kadro okunamadı ve yerelde de yok: kapıyı açıp yanlışlıkla farklı bir
      // kadro seçtirmek yerine yeniden deneme ekranı göster.
      showProfileLoadError();
    } else {
      openRoleGate();
    }
  } catch (err) {
    console.error('Uygulama başlatılamadı:', err);
    showProfileLoadError();
  } finally {
    // Kadro kapısı ya da ana uygulama artık ekranda (ya da en azından hata
    // ekranı) — native açılış ekranını her durumda kapat.
    window.NativeUX?.hideSplash();
  }
}

document.addEventListener('sinavrotasi:authenticated', handleAuthenticated);
if (window.currentUserAuthReady) handleAuthenticated();

// ================= KADRO BAZLI GERÇEK SINAV DENEMESİ =================
// Ek-2 (Konu Başlıkları, Ağırlık Yüzdeleri ve Soru Sayılarını Gösteren
// Tablo) kaynaklı resmi soru dağılımına göre kadroya özel deneme üretir.
let examTopicRegistry = null;
let examBlueprints = null;

async function loadExamConfig() {
  if (examTopicRegistry && examBlueprints) return;
  const [topicsData, blueprintData] = await Promise.all([
    ContentRepo.fetchExamTaxonomy(),
    ContentRepo.fetchExamBlueprint()
  ]);
  examTopicRegistry = topicsData.topics || {};
  examBlueprints = blueprintData;
}

async function loadExamTopicBank(topicId, excludeTopicIds = []) {
  const topic = examTopicRegistry?.[topicId];
  if (!topic) return [];

  const cacheKey = `exam-topic:${topicId}:${excludeTopicIds.slice().sort().join(',')}`;
  if (state.questionBanks.has(cacheKey)) return state.questionBanks.get(cacheKey);

  const collected = new Map();
  // NOT (2026-09-05 DÜZELTME 2): blueprint bazen kısa/eski bir id kullanıyor
  // (ör. "anayasa"), gerçek questions.topic_id ise "law-anayasa" gibi farklı
  // bir değer — bu ikisi arasındaki çözümleme SADECE fetchQuestionsByPathExact
  // içinde (source_file üzerinden) yapılıyor ve dışarı hiç sızmıyordu. İlk
  // sürümde alt konu genişletmesini dışarıdaki (çözülmemiş) topicId ile
  // yapıyordum — bu yüzden RPC hep boş dönüyordu, sessizce, hiçbir etkisi
  // olmadan. Şimdi gerçek id'yi (resolvedTopicId) fetchQuestionsByPathExact'ın
  // döndüğü topicId'den yakalayıp alt konu genişletmesinde ONU kullanıyoruz.
  let resolvedTopicId = topicId;

  try {
    // Önce JSON dosyasından dene
    if (topic.questionFile) {
      try {
        // NOT: fetchQuestionsByPathExact kullanılıyor (fetchQuestionsByPath DEĞİL) —
        // burada SADECE tam konu eşleşmesi alınır; alt konu genişletmesi
        // aşağıda ayrı ve kontrollü bir adımda yapılıyor (bkz. alt not).
        const data = await ContentRepo.fetchQuestionsByPathExact(topic.questionFile);
        if (data.topicId) resolvedTopicId = data.topicId;
        const questions = Array.isArray(data.questions) ? data.questions : [];
        questions.forEach(q => collected.set(q.id, q));
      } catch (jsonError) {
        console.warn(`Sınav JSON dosyası yüklenemedi: ${topic.questionFile}`);
      }
    }

    if (!collected.size) {
      // Veritabanından yükle. NOT: questions tablosu RLS ile korunuyor
      // (questions_premium_read → is_premium()); doğrudan seçim güvenli.
      const data = await ContentRepo.fetchAllRows(() => supabaseClient
        .from('questions')
        .select('id,prompt,options,answer_index')
        .eq('topic_id', resolvedTopicId)
        .order('sort_order', { ascending: true })
        .order('id', { ascending: true }));
      (data || []).forEach(q => collected.set(q.id, {
        id: q.id, prompt: q.prompt, options: q.options, answerIndex: q.answer_index
      }));
    }

    // NOT (2026-09-05 içerik eksikliği düzeltmesi): bazı konuların (T.C.
    // Anayasası, 657 sayılı Kanun, 5442, 4734, 4735, Atatürk İlkeleri ve
    // İnkılap Tarihi) TÜM soruları alt bölümlere etiketli — ana konunun
    // kendisinde neredeyse hiç soru yoktu, "Bazı konularda içerik eksik"
    // uyarısı hep bunlar için çıkıyordu. Eskiden burası bilerek alt konulara
    // hiç inmiyordu (2026-08-15: aynı sorunun iki kez seçilmesini önlemek
    // için — risk SADECE alt konu blueprint'te AYRI bir satır olarak da
    // varsa doğar). Şimdi: alt bölümlere iniyoruz ama excludeTopicIds'teki
    // (yani bu kadronun blueprint'inde zaten kendi satırı olan) konuları
    // hariç tutuyoruz — o riski yeniden açmadan içeriği kurtarır.
    // resolvedTopicId kullanılıyor (yukarıdaki not) — topicId DEĞİL.
    try {
      const { data: descendantIds, error: descError } = await supabaseClient.rpc('get_topic_descendant_ids', { p_root_topic_id: resolvedTopicId });
      if (!descError && Array.isArray(descendantIds)) {
        const excludeSet = new Set(excludeTopicIds.filter(id => id !== topicId && id !== resolvedTopicId));
        const extraIds = descendantIds.filter(id => id !== resolvedTopicId && !excludeSet.has(id));
        if (extraIds.length) {
          // O-07 (2026-09-15): 657 sayılı Kanun gibi büyük başlıklarda alt
          // bölümlerde 1.000'den fazla soru var; sayfalı okunmazsa kadro
          // sınavı havuzu sessizce ve rastgele bir alt kümeyle sınırlanıyordu.
          const extraData = await ContentRepo.fetchAllRows(() => supabaseClient
            .from('questions')
            .select('id,prompt,options,answer_index')
            .in('topic_id', extraIds)
            .order('id', { ascending: true }));
          (extraData || []).forEach(q => {
            if (!collected.has(q.id)) {
              collected.set(q.id, { id: q.id, prompt: q.prompt, options: q.options, answerIndex: q.answer_index });
            }
          });
        }
      }
    } catch (descError) {
      console.warn(`Alt konu genişletmesi başarısız (${topicId}):`, descError);
    }

    const questions = Array.from(collected.values());
    state.questionBanks.set(cacheKey, questions);
    return questions;
  } catch (error) {
    console.error(`Sınav konusu yüklenemedi (${topicId}):`, error);
    state.questionBanks.set(cacheKey, []);
    return [];
  }
}

// Tekli konu ({topicId, count}) ve grup / "bağlı mevzuat" ({topics:[...], count})
// girdilerini düz bir [{topicId, count}] listesine açar. Grup içindeki toplam
// soru sayısı, konular arasında olabildiğince eşit dağıtılır.
function expandBlueprintEntries(entries) {
  const flat = [];
  entries.forEach(entry => {
    if (entry.topics && entry.topics.length) {
      const base = Math.floor(entry.count / entry.topics.length);
      let remainder = entry.count - base * entry.topics.length;
      entry.topics.forEach(topicId => {
        const extra = remainder > 0 ? 1 : 0;
        if (remainder > 0) remainder -= 1;
        flat.push({ topicId, count: base + extra });
      });
    } else {
      flat.push({ topicId: entry.topicId, count: entry.count });
    }
  });
  return flat;
}


// Resmî kadro blueprint'indeki soru sayılarını daha küçük bir denemeye
// oransal olarak indirger. Largest-remainder yöntemi toplamın hedef sayıya
// TAM eşit kalmasını sağlar; bu yüzden 20 soruluk mini denemede oranlar
// mümkün olduğunca resmî sınav dağılımını korur.
function scaleBlueprintCounts(flatEntries, targetCount) {
  const source = flatEntries
    .map((entry, index) => ({ ...entry, sourceIndex: index, officialCount: Math.max(0, Number(entry.count) || 0) }))
    .filter(entry => entry.officialCount > 0);
  const total = source.reduce((sum, entry) => sum + entry.officialCount, 0);
  if (!total || !targetCount) return [];

  const scaled = source.map(entry => {
    const exact = (entry.officialCount / total) * targetCount;
    const count = Math.floor(exact);
    return { ...entry, count, remainder: exact - count };
  });
  let left = targetCount - scaled.reduce((sum, entry) => sum + entry.count, 0);
  [...scaled]
    .sort((a, b) => b.remainder - a.remainder || b.officialCount - a.officialCount || a.sourceIndex - b.sourceIndex)
    .slice(0, left)
    .forEach(entry => { entry.count += 1; });
  return scaled.sort((a, b) => a.sourceIndex - b.sourceIndex);
}

async function buildScaledMiniExamPool(roleKey, targetCount = 20) {
  await loadExamConfig();
  const blueprint = examBlueprints?.[roleKey];
  if (!blueprint) throw new Error('Bu kadro için sınav planı tanımlı değil.');

  const flatEntries = expandBlueprintEntries(blueprint.topics);
  const scaledEntries = scaleBlueprintCounts(flatEntries, targetCount);
  const allBlueprintTopicIds = flatEntries.map(entry => entry.topicId);
  const banks = await Promise.all(flatEntries.map(({ topicId }) => loadExamTopicBank(topicId, allBlueprintTopicIds)));
  const bankByIndex = banks;
  const pickedIds = new Set();
  const pool = [];
  const missingTopics = [];

  scaledEntries.forEach(entry => {
    if (entry.count <= 0) return;
    const topicMeta = examTopicRegistry[entry.topicId];
    const bank = shuffle(bankByIndex[entry.sourceIndex] || []);
    const picked = [];
    for (const q of bank) {
      if (picked.length >= entry.count) break;
      if (q.id && pickedIds.has(q.id)) continue;
      if (q.id) pickedIds.add(q.id);
      picked.push({
        ...q,
        documentId: entry.topicId,
        documentTitle: topicMeta?.title || entry.topicId,
        categoryKey: topicMeta?.category || null
      });
    }
    pool.push(...picked);
    if (picked.length < entry.count) {
      missingTopics.push(`${topicMeta?.title || entry.topicId} (${picked.length}/${entry.count})`);
    }
  });

  // İçeriği eksik bir konu hedef kotasını dolduramazsa mini denemeyi eksik
  // bırakmak yerine aynı kadronun diğer blueprint konularındaki kullanılmamış
  // sorulardan tamamlıyoruz. Normal durumda bu kola hiç girilmez.
  if (pool.length < targetCount) {
    const fallback = [];
    flatEntries.forEach((entry, index) => {
      const topicMeta = examTopicRegistry[entry.topicId];
      for (const q of (bankByIndex[index] || [])) {
        if (q.id && pickedIds.has(q.id)) continue;
        fallback.push({
          ...q,
          documentId: entry.topicId,
          documentTitle: topicMeta?.title || entry.topicId,
          categoryKey: topicMeta?.category || null
        });
      }
    });
    for (const q of shuffle(dedupeQuestionsById(fallback))) {
      if (pool.length >= targetCount) break;
      if (q.id && pickedIds.has(q.id)) continue;
      if (q.id) pickedIds.add(q.id);
      pool.push(q);
    }
  }

  return { pool: pool.slice(0, targetCount), blueprint, scaledEntries, missingTopics };
}

// Aktif konu bankalarından round-robin seçim yapar. Her turda her bankadan
// en fazla bir soru alındığı için 40 soruluk Karışık Genel Tekrar, tek bir
// konuya yığılmak yerine mevcut aktif başlıklar arasında olabildiğince eşit
// dağılır. Bankası tükenen konu atlanır ve diğerleri dengeyi koruyarak devam eder.
async function buildBalancedMixedPool(entries, targetCount = 40) {
  const settled = await Promise.allSettled(entries.map(async entry => {
    const tagged = tagQuestions(await loadQuestionBank(entry.item), entry.item, entry.categoryKey);
    return { entry, questions: shuffle(dedupeQuestionsById(tagged)) };
  }));
  const groups = shuffle(settled
    .filter(result => result.status === 'fulfilled' && result.value.questions.length)
    .map(result => ({ ...result.value, cursor: 0 })));

  const picked = [];
  const seen = new Set();
  while (picked.length < targetCount && groups.length) {
    let addedThisRound = 0;
    for (const group of groups) {
      while (group.cursor < group.questions.length) {
        const q = group.questions[group.cursor++];
        if (q.id && seen.has(q.id)) continue;
        if (q.id) seen.add(q.id);
        picked.push(q);
        addedThisRound += 1;
        break;
      }
      if (picked.length >= targetCount) break;
    }
    if (!addedThisRound) break;
  }
  return picked;
}

async function startQuickMiniExam() {
  if (!requirePremiumOrWarn()) return;
  const roleKey = progress.selectedRole;
  if (!roleKey) return showToast('Önce kadronu seçmelisin.');
  showToast('Mini deneme hazırlanıyor…');
  try {
    const { pool, missingTopics } = await buildScaledMiniExamPool(roleKey, 20);
    if (!pool.length) return showToast('Bu kadro için henüz soru bankası eklenmedi.');
    if (pool.length < 20) showToast(`Havuzda ${pool.length} benzersiz soru bulundu.`);
    else if (missingTopics.length) showToast('Bazı konu kotaları içerik durumuna göre diğer kadro konularından tamamlandı.');
    closeAllSheets(topicSheet);
    topicSheet.classList.add('open');
    topicSheet.setAttribute('aria-hidden', 'false');
    topicBackdrop.classList.add('open');
    startQuiz({
      questions: pool,
      kind: 'mini-exam',
      title: 'Hızlı Mini Deneme',
      subtitle: `${pool.length} soru • kadro dağılımına göre`,
      returnView: closeTopicSheet,
      customTimeSeconds: 20 * 60
    });
  } catch (error) {
    showToast(error?.message || 'Mini deneme hazırlanamadı.');
  }
}

async function startMixedGeneralExam() {
  if (!requirePremiumOrWarn()) return;
  const entries = getActiveDocuments();
  if (!entries.length) return showToast('Henüz aktif soru paketi bulunmuyor.');
  showToast('Karışık tekrar hazırlanıyor…');
  try {
    const questions = await buildBalancedMixedPool(entries, 40);
    if (!questions.length) return showToast('Şu an hazır bir soru paketi bulunamadı.');
    if (questions.length < 40) showToast(`Aktif konularda ${questions.length} benzersiz soru bulundu.`);
    closeAllSheets(topicSheet);
    topicSheet.classList.add('open');
    topicSheet.setAttribute('aria-hidden', 'false');
    topicBackdrop.classList.add('open');
    startQuiz({
      questions,
      kind: 'mixed-exam',
      title: 'Karışık Genel Tekrar',
      subtitle: `${questions.length} soru • aktif konulara dengeli dağılım`,
      returnView: closeTopicSheet,
      customTimeSeconds: 50 * 60
    });
  } catch (error) {
    showToast(error?.message || 'Karışık tekrar hazırlanamadı.');
  }
}

async function buildKadroExamPool(roleKey) {
  await loadExamConfig();
  const blueprint = examBlueprints?.[roleKey];
  if (!blueprint) throw new Error('Bu kadro için sınav planı tanımlı değil.');
  const flatEntries = expandBlueprintEntries(blueprint.topics);
  const allBlueprintTopicIds = flatEntries.map(entry => entry.topicId);
  const missingTopics = [];
  const pool = [];
  // NOT (2026-08-15 performans düzeltmesi): önceden bu döngü sıralıydı
  // (her `await loadExamTopicBank` bir öncekini bekliyordu) — sube-mudur gibi
  // 20+ konulu blueprint'lerde 20+ ardışık ağ isteği birikip "Başlat" düğmesini
  // birkaç saniye geciktiriyordu. Konular birbirinden bağımsız olduğu için
  // hepsini paralel çekiyoruz.
  const banks = await Promise.all(flatEntries.map(({ topicId }) => loadExamTopicBank(topicId, allBlueprintTopicIds)));
  flatEntries.forEach(({ topicId, count }, i) => {
    const topicMeta = examTopicRegistry[topicId];
    const bank = banks[i];
    if (!bank.length) { missingTopics.push(topicMeta?.title || topicId); return; }
    const picked = shuffle(bank).slice(0, count).map(q => ({
      ...q,
      documentId: topicId,
      documentTitle: topicMeta?.title || topicId,
      categoryKey: topicMeta?.category || null
    }));
    pool.push(...picked);
    if (picked.length < count) missingTopics.push(`${topicMeta?.title || topicId} (${picked.length}/${count})`);
  });
  // NOT (2026-08-15 sıralama düzeltmesi): eskiden pool sonunda tamamen
  // shuffle ediliyordu — bu, blueprint'in (resmi Ek-2 tablosunun) konu sırasını
  // (Türkçe → İnsan Hakları → ... → bağlı mevzuat) tamamen bozuyordu. Artık
  // konular BLUEPRINT SIRASIYLA ekleniyor; her konunun kendi soruları rastgele
  // seçiliyor (shuffle(bank).slice) ama konular arası sıra korunuyor.
  return { pool, missingTopics, blueprint };
}

async function startKadroExam() {
  if (!requirePremiumOrWarn()) return;
  const roleKey = progress.selectedRole;
  if (!roleKey) return showToast('Önce kadronu seçmelisin.');
  showToast('Gerçek sınav formatı hazırlanıyor…');
  try {
    const { pool, missingTopics, blueprint } = await buildKadroExamPool(roleKey);
    if (!pool.length) return showToast('Bu kadro için henüz soru bankası eklenmedi.');
    if (missingTopics.length) {
      showToast(`Bazı konularda içerik eksik: ${missingTopics.slice(0, 2).join(', ')}${missingTopics.length > 2 ? '…' : ''}`);
    }
    closeAllSheets(topicSheet);
    topicSheet.classList.add('open');
    topicSheet.setAttribute('aria-hidden', 'false');
    topicBackdrop.classList.add('open');
    const roleLabel = ROLES.find(r => r.key === roleKey)?.label || '';
    const customTimeSeconds = blueprint.durationMinutes ? blueprint.durationMinutes * 60 : null;
    startQuiz({
      questions: pool,
      kind: 'kadro-exam',
      title: `${roleLabel} - Gerçek Sınav Formatı`,
      subtitle: `${pool.length} soru • resmi ağırlık dağılımı`,
      returnView: closeTopicSheet,
      customTimeSeconds
    });
  } catch (error) {
    showToast(error.message || 'Sınav hazırlanamadı.');
  }
}
