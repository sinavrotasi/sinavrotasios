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

const UI_PREFS_STORAGE_KEY = 'sinavrotasi-ui-prefs-v1';
const DEFAULT_UI_PREFS = { textSize: 'standard', density: 'standard' };

const STUDY_PREFS_STORAGE_KEY = 'sinavrotasi-study-prefs-v1';
const DEFAULT_STUDY_PREFS = { repeatPriority:'personal', pauseStartedAt:null, pauseUntil:null };

function loadStudyPrefs() {
  try {
    const saved = JSON.parse(localStorage.getItem(STUDY_PREFS_STORAGE_KEY) || '{}');
    return {
      repeatPriority: ['personal','weak','recent','random'].includes(saved.repeatPriority)
        ? saved.repeatPriority
        : (saved.repeatPriority === 'balanced' ? 'random' : 'personal'),
      pauseStartedAt: typeof saved.pauseStartedAt === 'string' ? saved.pauseStartedAt : null,
      pauseUntil: typeof saved.pauseUntil === 'string' ? saved.pauseUntil : null
    };
  } catch (_) { return { ...DEFAULT_STUDY_PREFS }; }
}
let studyPrefs = loadStudyPrefs();
function saveStudyPrefs(){ localStorage.setItem(STUDY_PREFS_STORAGE_KEY, JSON.stringify(studyPrefs)); }
function getRepeatPriorityLabel(value = studyPrefs.repeatPriority){
  return ({
    personal:'Sana Özel',
    weak:'Zayıf Konular',
    recent:'Son Çalışılan',
    random:'Rastgele Karma'
  })[value] || 'Sana Özel';
}
function getRepeatPriorityMode(value = studyPrefs.repeatPriority){
  return ({
    personal:'Sana Özel Karma',
    weak:'Zayıf Konular',
    recent:'Son Çalışılan Konu',
    random:'Rastgele Karma'
  })[value] || 'Sana Özel Karma';
}
function isStudyPaused(at = new Date()){
  if (!studyPrefs.pauseUntil) return false;
  const until = new Date(studyPrefs.pauseUntil);
  return Number.isFinite(until.getTime()) && at <= until;
}
function formatStudyPauseDate(){
  if (!isStudyPaused()) return 'Plan aktif';
  const until = new Date(studyPrefs.pauseUntil);
  return `${until.toLocaleDateString('tr-TR',{day:'numeric',month:'long'})} tarihine kadar duraklatıldı`;
}
function setStudyRepeatPriority(value){
  if (!['personal','weak','recent','random'].includes(value)) return;
  studyPrefs.repeatPriority = value;
  saveStudyPrefs();
  routeSettings.mode = getRepeatPriorityMode(value);
}
function setStudyPauseUntil(date){
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return false;
  const now = new Date();
  date.setHours(23,59,59,999);
  if (date < now) return false;
  studyPrefs.pauseStartedAt = now.toISOString();
  studyPrefs.pauseUntil = date.toISOString();
  saveStudyPrefs();
  syncLocalNotificationSchedule();
  return true;
}
function setStudyPauseDays(days){
  const until = new Date();
  until.setDate(until.getDate() + Math.max(1,Number(days)||1) - 1);
  return setStudyPauseUntil(until);
}
function resumeStudyPlan(){
  studyPrefs.pauseStartedAt = null;
  studyPrefs.pauseUntil = null;
  saveStudyPrefs();
  syncLocalNotificationSchedule();
}


function loadUiPrefs() {
  try {
    const saved = JSON.parse(localStorage.getItem(UI_PREFS_STORAGE_KEY) || '{}');
    return {
      textSize: ['small', 'standard', 'large'].includes(saved.textSize) ? saved.textSize : 'standard',
      density: ['comfortable', 'standard', 'compact'].includes(saved.density) ? saved.density : 'standard'
    };
  } catch (_) {
    return { ...DEFAULT_UI_PREFS };
  }
}

let uiPrefs = loadUiPrefs();

function applyUiPrefs() {
  document.documentElement.dataset.textSize = uiPrefs.textSize;
  document.documentElement.dataset.uiDensity = uiPrefs.density;
  requestAnimationFrame(applyTextScaleToCurrentUi);
}
function applyTextScaleToCurrentUi() {
  const scale = ({ small:.92, standard:1, large:1.12 })[uiPrefs.textSize] || 1;
  const nodes = [...document.querySelectorAll('.phone h1,.phone h2,.phone h3,.phone h4,.phone h5,.phone p,.phone span,.phone small,.phone strong,.phone b,.phone label,.phone button,.phone input,.phone textarea,.phone select,.phone summary')]
    .filter(el => !el.closest('svg'));
  nodes.forEach(el => {
    if (!el.dataset.uiBaseFontSize) {
      const base = parseFloat(getComputedStyle(el).fontSize);
      if (Number.isFinite(base) && base > 0) el.dataset.uiBaseFontSize = String(base);
    }
  });
  nodes.forEach(el => {
    const base = Number(el.dataset.uiBaseFontSize);
    if (!Number.isFinite(base) || base <= 0) return;
    let size = base * scale;
    if (el.matches('input,textarea,select')) size = Math.max(16,size);
    el.style.fontSize = `${size.toFixed(2)}px`;
  });
}
function saveUiPrefs() {
  localStorage.setItem(UI_PREFS_STORAGE_KEY, JSON.stringify(uiPrefs));
  applyUiPrefs();
}


// ---- Zamanlama sabitleri (önceden dosya içinde dağınık "magic number" olarak vardı) ----
const TOAST_DURATION_MS = 2400;          // Toast bildiriminin ekranda kalma süresi
const CLOUD_SYNC_DEBOUNCE_MS = 1500;     // Progress değişikliğinden sonra Supabase'e yazana kadar bekleme (debounce)
const SEARCH_FOCUS_DELAY_MS = 300;       // Arama input'una modal açıldıktan sonra odaklanma gecikmesi
const LOCAL_SAVE_DEBOUNCE_MS = 400;      // PERF: localStorage yazımını art arda gelen cevaplarda tekilleştirir

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

const statisticsUi = {
  overviewRange: 'all',
  range: 'week',
  subjectMetric: 'correct',
  openMenu: null
};

let accountConfirmAction = null;

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
  cardCompletionReconciled: false,
  cardCompletionReconcilePromise: null,
  weeklyFlowRange: 'week',
  weeklyFlowNote: '',
  totalQuestionCount: 0,
  sharedExamDate: null,
  showAllCompletedExams: false
};

// Rota Ayarları State'i
const routeSettings = {
  mode: getRepeatPriorityMode(),
  questions: 20,
  time: 'Süreli',
  durationMinutes: 20,
  durationCustomized: false
};

// Native (Capacitor) katmanı — ana uygulama koyu header'a sahip olduğu için
// durum çubuğu açık/beyaz ikonlarla başlatılır. Web'de tamamen etkisizdir.
window.NativeUX?.init({ statusBarStyle: 'DARK' });
applyUiPrefs();

const app = document.getElementById('app');
const scrollArea = document.getElementById('scroll-area');
const toast = document.getElementById('toast');
const navButtons = [...document.querySelectorAll('[data-nav]')];
// Sayfa yeniden çizilse de tek dinleyici: hedef alanının dışına dokununca klavyeyi bırak.
function dismissProfileGoalOnOutsidePress(event) {
  const input = document.getElementById('profileDailyGoalInput');
  if (!input || document.activeElement !== input) return;
  const target = event.target;
  if (!(target instanceof Element)) return;
  if (target.closest('.pv-goal') || target.closest('input,textarea,select,[contenteditable="true"]')) return;
  input.blur(); // Mevcut blur dinleyicisi native klavyeyi ve klavye durumunu kapatır.
}

document.addEventListener('pointerdown', dismissProfileGoalOnOutsidePress, { capture:true, passive:true });

function dismissStatisticsMenuOnOutsidePress(event) {
  if (state.view !== 'statistics' || !statisticsUi.openMenu) return;
  const target = event.target;
  if (!(target instanceof Element)) return;
  if (target.closest('.stats-dropdown')) return;
  statisticsUi.openMenu = null;
  render();
}
document.addEventListener('pointerdown', dismissStatisticsMenuOnOutsidePress, { capture:true, passive:true });


// Profil düzenleme ekranında boş alana dokununca aktif input'tan çık ve
// native klavyeyi kapat. Başka bir input'a dokunuluyorsa doğal focus geçişine
// müdahale etmiyoruz; böylece kutular arası geçişte ekstra blur/focus zıplaması olmaz.
function dismissProfileEditInputOnOutsidePress(event) {
  if (state.view !== 'profile-edit') return;
  const active = document.activeElement;
  if (!active?.classList?.contains('sp-text-input')) return;
  const target = event.target;
  if (!(target instanceof Element)) return;
  if (target.closest('.sp-text-input')) return;

  active.blur();
  window.NativeUX?.hideKeyboard?.();
  document.body.classList.remove('keyboard-open');
  document.documentElement.style.setProperty('--keyboard-height', '0px');
}
document.addEventListener('pointerdown', dismissProfileEditInputOnOutsidePress, { capture:true, passive:true });

// Profil düzenle ekranında input odaklanınca ekran otomatik kaydırılmaz.
let profileEditFocusScrollTop = null;
let profileReturnScrollTop = 0;
function restoreProfilePosition() {
  const top = profileReturnScrollTop;
  scrollArea.scrollTop = top;
  requestAnimationFrame(() => { if(state.view === 'profile') scrollArea.scrollTop = top; });
}

function restoreProfileEditScrollPosition(expectedTop) {
  if (state.view !== 'profile-edit' || !Number.isFinite(expectedTop)) return;
  scrollArea.scrollTop = expectedTop;
}



// Eski HTML önbellekten gelse de gezinme ikonlarını tek SVG biçimine getirir.
function prepareNavIcons() {
  const solids = {"home": "<path fill-rule=\"evenodd\" d=\"M12 2 2 10v10a2 2 0 0 0 2 2h6v-8h4v8h6a2 2 0 0 0 2-2V10L12 2Z\"/>", "bank": "<path d=\"M6 2a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6H6Z\"/><path d=\"M14 3v5h5M8 13h8M8 17h8\" fill=\"none\" stroke=\"white\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>", "cards": "<rect x=\"3\" y=\"6\" width=\"14\" height=\"15\" rx=\"2.5\" transform=\"rotate(-8 10 13.5)\"/><rect x=\"7\" y=\"3\" width=\"14\" height=\"15\" rx=\"2.5\" stroke=\"white\" stroke-width=\"1.4\"/>", "mistakes": "<circle cx=\"12\" cy=\"12\" r=\"10\"/><path d=\"m8.8 8.8 6.4 6.4m0-6.4-6.4 6.4\" fill=\"none\" stroke=\"white\" stroke-width=\"2\" stroke-linecap=\"round\"/>", "profile": "<circle cx=\"12\" cy=\"7\" r=\"4\"/><path d=\"M4 22v-3a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v3H4Z\"/>"};
  document.querySelectorAll('.bottom-nav [data-nav]').forEach(button => {
    const svg = button.querySelector('svg');
    const solid = solids[button.dataset.nav];
    if (!svg || !solid) return;
    button.querySelectorAll('svg.nav-solid').forEach(extra => extra.remove());
    if (!svg.querySelector('.nav-icon-solid')) {
      const outline = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      outline.setAttribute('class', 'nav-icon-outline');
      while (svg.firstChild) outline.appendChild(svg.firstChild);
      svg.appendChild(outline);
      const filled = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      filled.setAttribute('class', 'nav-icon-solid');
      filled.setAttribute('fill', 'currentColor');
      filled.setAttribute('stroke', 'none');
      filled.innerHTML = solid;
      svg.appendChild(filled);
    }
    svg.setAttribute('aria-hidden', 'true');
  });
}
prepareNavIcons();


// Konu Paneli (Topic Sheet) Elementleri
const topicSheet = document.getElementById('topicSheet');
const topicBackdrop = document.getElementById('topicBackdrop');
const closeTopicSheetButton = document.getElementById('closeTopicSheet');
const topicSheetTitle = document.getElementById('topicSheetTitle');
const topicSheetSubtitle = document.getElementById('topicSheetSubtitle');
const topicEyebrow = document.getElementById('topicEyebrow');
const topicHeadingIcon = document.getElementById('topicHeadingIcon');
const topicList = document.getElementById('topicList');
const topicProgressPercent = document.getElementById('topicProgressPercent');
const topicProgressBar = document.getElementById('topicProgressBar');
const topicProgressCount = document.getElementById('topicProgressCount');
const topicBreadcrumbWrap = document.getElementById('topicBreadcrumbWrap');

// Rota Paneli (Route Sheet) Elementleri
const routeSheet = document.getElementById('routeSheet');
const closeRouteSheetButton = document.getElementById('closeRouteSheet');
const startRouteButton = document.getElementById('startRouteButton');
const summaryMode = document.getElementById('summaryMode');
const summaryDuration = document.getElementById('summaryDuration');
const routeDurationFilter = document.getElementById('routeDurationFilter');
const routeDurationButton = document.getElementById('routeDurationButton');
const routeDurationValue = document.getElementById('routeDurationValue');
const routeDurationMenu = document.getElementById('routeDurationMenu');

// Arama Paneli Elementleri
const openSearchButton = document.getElementById('openSearchButton');
const searchSheet = document.getElementById('searchSheet');
const closeSearchSheetButton = document.getElementById('closeSearchSheet');
const searchInput = document.getElementById('searchInput');
const searchResultsList = document.getElementById('searchResultsList');

// Bildirim Paneli Elementleri
const openNotifButton = document.getElementById('openNotifButton');
const notifSheet = document.getElementById('notifSheet');
const closeNotifSheetButton = document.getElementById('closeNotifSheet');
const notifList = document.getElementById('notifList');
const notifBadge = document.getElementById('notifBadge');
const notifClearButton = document.getElementById('notifClearButton');

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
  sparkles: '<path d="m12 3-1.2 3.2L8 7.5l2.8 1.3L12 12l1.2-3.2L16 7.5l-2.8-1.3z"/><path d="m5.5 12-.8 2.1L2.5 15l2.2.9.8 2.1.8-2.1 2.2-.9-2.2-.9z"/><path d="m18.5 14-1 2.7-2.5 1.1 2.5 1.1 1 2.6 1-2.6 2.5-1.1-2.5-1.1z"/>',
  sliders: '<path d="M4 7h10"/><path d="M18 7h2"/><circle cx="16" cy="7" r="2"/><path d="M4 17h2"/><path d="M10 17h10"/><circle cx="8" cy="17" r="2"/><path d="M4 12h4"/><path d="M12 12h8"/><circle cx="10" cy="12" r="2"/>',
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

// PERF: JSON.stringify + localStorage.setItem artık her çağrıda değil, kısa
// bir debounce sonunda tek seferde çalışıyor (ör. bir sınavda art arda gelen
// her cevapta senkron bir yazma/serileştirme maliyeti oluşmasın diye).
// Sekme arka plana alınırken / kapanırken (visibilitychange, pagehide,
// nativeux:pause) bekleyen yazma varsa hemen flush ediliyor — veri kaybı yok.
let localSaveTimer = null;
let localSavePending = false;

function flushLocalProgressSave() {
  if (!localSavePending) return;
  clearTimeout(localSaveTimer);
  localSaveTimer = null;
  localSavePending = false;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
}

function scheduleLocalProgressSave() {
  localSavePending = true;
  clearTimeout(localSaveTimer);
  localSaveTimer = setTimeout(flushLocalProgressSave, LOCAL_SAVE_DEBOUNCE_MS);
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushLocalProgressSave();
});
window.addEventListener('pagehide', flushLocalProgressSave);
document.addEventListener('nativeux:pause', flushLocalProgressSave);

function saveProgress({ rerender = true } = {}) {
  scheduleLocalProgressSave();
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
    const effectivePrefs = isStudyPaused()
      ? { ...progress.notificationPrefs, dailyReminder: false }
      : progress.notificationPrefs;
    window.NativeUX.scheduleStudyReminders(effectivePrefs, {
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
  const completedSections = Object.keys(progress.completedSections).filter(key => !key.startsWith('card-deck:') && !key.startsWith('wrong-fixed:') && !key.startsWith('topic-question:')).length;
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
  navButtons.forEach(button => {
    const active = button.dataset.nav === name;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  const menu = document.querySelector('.bottom-nav');
  if (!menu) return;
  const items = [...menu.querySelectorAll('[data-nav]')];
  const index = items.findIndex(button => button.dataset.nav === name);
  menu.style.setProperty('--nav-visible', index < 0 ? '0' : '1');
  if (index >= 0) menu.style.setProperty('--nav-index', String(index));
}

// --- SHEET DURUM YÖNETİMİ ---
// Aynı anda yalnızca bir sheet açık kalabilir. Böylece arama açıldığında arkada
// eski bir kategori paneli görünmez ve hem X hem Android geri tuşu aynı temiz
// kapanış yolunu kullanır.
const allSheets = [routeSheet, topicSheet, searchSheet, notifSheet];
const sheetCloseTimers = new WeakMap();

function setSheetOpen(sheet, isOpen) {
  if (!sheet) return;
  const pending = sheetCloseTimers.get(sheet);
  if (pending) {
    window.clearTimeout(pending);
    sheetCloseTimers.delete(sheet);
  }

  if (isOpen) {
    sheet.classList.remove('closing');
    sheet.setAttribute('aria-hidden', 'false');
    sheet.inert = false;
    // iOS sheet hissi: önce görünür yap, ardından sonraki karede yukarı kaydır.
    window.requestAnimationFrame(() => sheet.classList.add('open'));
    return;
  }

  sheet.inert = true;
  if (!sheet.classList.contains('open') && !sheet.classList.contains('closing')) {
    sheet.setAttribute('aria-hidden', 'true');
    return;
  }

  // aria-hidden kapanışın sonunda verilir; aksi halde CSS visibility:hidden
  // dönüş animasyonunu ilk karede kesiyordu.
  sheet.classList.remove('open');
  sheet.classList.add('closing');
  sheet.setAttribute('aria-hidden', 'false');
  const timer = window.setTimeout(() => {
    if (!sheet.classList.contains('open')) {
      sheet.classList.remove('closing');
      sheet.setAttribute('aria-hidden', 'true');
    }
    sheetCloseTimers.delete(sheet);
  }, 430);
  sheetCloseTimers.set(sheet, timer);
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
  if(exceptSheet !== topicSheet){
    if(state.quiz?.studyFinishing){showToast('Sonuç hazırlanıyor, lütfen bekle.');return false;}
    if(!pauseStudyAttempts(true))return false;
  }
  if(exceptSheet!==topicSheet)resetTopicViewCache();
  allSheets.forEach(sheet => setSheetOpen(sheet, sheet === exceptSheet));
  if (exceptSheet !== searchSheet) clearSearchState();
  topicBackdrop.classList.toggle('open', Boolean(exceptSheet));
  return true;
}

window.go = function go(view) {
  if(closeAllSheets()===false)return;
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

// Stored in the existing synchronized map so reset and cross-device merge apply.
function uniqueTopicQuestionPrefix(documentId) {
  return `topic-question:${encodeURIComponent(String(documentId))}:`;
}

function recordUniqueTopicQuestion(question) {
  if (!question || question.id == null || !question.documentId) return;
  const key = uniqueTopicQuestionPrefix(question.documentId) + encodeURIComponent(String(question.id));
  if (progress.completedSections[key]) return;
  window.SRProgressSync.setKey(progress, 'completedSections', key, new Date().toISOString());
}

function getDocumentCompletion(documentItem) {
  const total = Math.max(0, Number(documentItem.questionCount) || 0);
  const role = progress.selectedRole;
  const sections = (documentItem.children || []).filter(section => !role || !section.kadrolar || section.kadrolar.includes(role));
  if ((documentItem.children || []).length) {
    const completed = sections.filter(section => progress.completedSections[section.id]).length;
    const percentage = sections.length ? Math.round(completed / sections.length * 100) : 0;
    return {total, completed: Math.round(total * percentage / 100), percentage};
  }
  const prefix = uniqueTopicQuestionPrefix(documentItem.id);
  const seen = Object.keys(progress.completedSections).filter(key => key.startsWith(prefix) && progress.completedSections[key]).length;
  const completed = Math.min(total, seen);
  return {total, completed, percentage: total ? Math.round(completed / total * 100) : 0};
}

function getDocumentProgress(documentItem) {
  return getDocumentCompletion(documentItem).percentage;
}

function getCategoryCompletion(categoryKey) {
  const items = getCategoryItems(categoryKey).filter(item => item.type === 'document' || item.type === 'topic');
  const counts = items.reduce((sum, item) => {
    const value = getDocumentCompletion(item);
    sum.total += value.total;
    sum.completed += value.completed;
    return sum;
  }, {total:0, completed:0});
  return {...counts, percentage: counts.total ? Math.round(counts.completed / counts.total * 100) : 0};
}

function getCategoryProgress(categoryKey) {
  return getCategoryCompletion(categoryKey).percentage;
}

function getCategoryQuestionTotal(categoryKey) {
  return getCategoryCompletion(categoryKey).total;
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
function getCompletedKadroExamSummary() {
  const tests = Array.isArray(progress.completedTests) ? progress.completedTests : [];
  let count = 0;
  let percentageSum = 0;

  tests.forEach(test => {
    if (!EXAM_KINDS.includes(test.kind)) return;
    count += 1;
    const answered = Math.max(0, Number(test.answered ?? test.total) || 0);
    const score = Math.min(answered, Math.max(0, Number(test.score) || 0));
    percentageSum += answered ? (score / answered) * 100 : 0;
  });

  return {
    count,
    average: count ? Math.round(percentageSum / count) : 0
  };
}

function getRecentCompletedKadroExams(limit = 5) {
  const safeLimit = Math.max(1, Math.min(50, Number(limit) || 5));
  const recent = [];

  (Array.isArray(progress.completedTests) ? progress.completedTests : []).forEach(test => {
    if (!EXAM_KINDS.includes(test.kind)) return;
    const time = new Date(test.completedAt || 0).getTime();
    if (!Number.isFinite(time)) return;

    const item = { ...test, __time: time };
    let inserted = false;
    for (let i = 0; i < recent.length; i += 1) {
      if (time > recent[i].__time) {
        recent.splice(i, 0, item);
        inserted = true;
        break;
      }
    }
    if (!inserted) recent.push(item);
    if (recent.length > safeLimit) recent.pop();
  });

  return recent.map(({ __time, ...test }) => test);
}

function formatCompletedDate(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function bankView() {
  const stats = getStats();
  const examSummary = getCompletedKadroExamSummary();
  const visibleLimit = state.showAllCompletedExams ? Math.min(50, examSummary.count) : 3;
  const completedExams = getRecentCompletedKadroExams(Math.max(1, visibleLimit));
  const examAverage = examSummary.average;
  const roleLabel = ROLES.find(r => r.key === progress.selectedRole)?.label || 'Kadro';
  const completedExamsHtml = completedExams.length ? `
    <div class="bank-v2-section-head"><h3>Son Çözülenler</h3></div>
    <div class="bank-v2-results" id="completedExamResults">
      ${completedExams.map((test, index) => {
        const answered = Math.max(0, Number(test.answered ?? test.total) || 0);
        const percentage = answered ? Math.round((Math.min(answered, Number(test.score) || 0) / answered) * 100) : 0;
        const tone = percentage >= 80 ? 'good' : percentage >= 60 ? 'mid' : 'low';
        return `<article class="bank-v2-result">
          <div class="bank-v2-result-icon" aria-hidden="true">${svg('statTrials')}</div>
          <div class="bank-v2-result-main">
            <strong>${escapeHtml(test.title)}</strong>
            <span>${formatCompletedDate(test.completedAt)} • ${test.answered ?? test.total} cevap</span>
            <div class="bank-v2-result-track"><i class="${tone}" style="width:${Math.max(0, Math.min(100, percentage))}%"></i></div>
          </div>
          <div class="bank-v2-result-score"><b>%${percentage}</b><small>${test.score}/${test.answered ?? test.total}</small></div>
        </article>`;
      }).join('')}
    </div>
    ${examSummary.count > 3 ? `<button type="button" class="bank-v2-show-all" id="showAllExamsButton" aria-expanded="${state.showAllCompletedExams ? 'true' : 'false'}" aria-controls="completedExamResults" data-total="${examSummary.count}">${state.showAllCompletedExams ? 'Daha az göster' : (examSummary.count > 50 ? `Son 50 denemeyi göster (${examSummary.count})` : `Tümünü göster (${examSummary.count})`)}</button>` : ''}` : '';

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
    'general-legislation': { title: 'Genel Mevzuat', icon: 'scale', tone: 'navy' },
    'meb-legislation': { title: 'MEB Mevzuatı', icon: 'schoolbook', tone: 'red' },
    'general-culture': { title: 'Ortak Alan Bilgisi', icon: 'landmark', tone: 'blue' },
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
      <linearGradient id="mist-shield-blue" x1="72" y1="35" x2="144" y2="122" gradientUnits="userSpaceOnUse"><stop stop-color="#6CB6FF"/><stop offset="1" stop-color="#176FE8"/></linearGradient>
      <linearGradient id="mist-shield-red" x1="92" y1="52" x2="129" y2="96" gradientUnits="userSpaceOnUse"><stop stop-color="#FF7A83"/><stop offset="1" stop-color="#E93238"/></linearGradient>
      <filter id="mist-shield-shadow" x="35" y="8" width="145" height="136" filterUnits="userSpaceOnUse"><feDropShadow dx="0" dy="10" stdDeviation="8" flood-color="#174F9C" flood-opacity=".20"/></filter>
    </defs>
    <circle cx="121" cy="74" r="58" fill="#EAF3FF" fill-opacity=".72"/>
    <circle cx="121" cy="74" r="46" stroke="#2D7EF7" stroke-opacity=".10" stroke-width="2"/>
    <g filter="url(#mist-shield-shadow)">
      <path d="M118 27 158 43v31c0 27-17 46-40 57-23-11-40-30-40-57V43l40-16Z" fill="url(#mist-shield-blue)"/>
      <path d="M118 36 149 48v25c0 21-13 36-31 46-18-10-31-25-31-46V48l31-12Z" fill="#fff" fill-opacity=".94"/>
      <circle cx="118" cy="72" r="19" fill="url(#mist-shield-red)"/>
      <path d="M118 60v15" stroke="#fff" stroke-width="5.5" stroke-linecap="round"/>
      <circle cx="118" cy="84" r="3" fill="#fff"/>
      <path d="m101 102 10 9 23-25" stroke="#2D7EF7" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round"/>
    </g>
    <path d="M163 31v11M157.5 36.5h11M58 47l-7 7M168 93l7 3-7 3" stroke="#63A8FF" stroke-width="3.2" stroke-linecap="round"/>
    <circle cx="60" cy="99" r="4" fill="#E93238"/>
  </svg>`;

  const heroArt = `<svg class="mistakes-ref-hero-art" viewBox="0 0 220 180" fill="none" aria-hidden="true">
    <defs>
      <linearGradient id="mist-lens-blue" x1="69" y1="42" x2="157" y2="133" gradientUnits="userSpaceOnUse"><stop stop-color="#78BEFF"/><stop offset="1" stop-color="#1F70EC"/></linearGradient>
      <linearGradient id="mist-handle-red" x1="146" y1="119" x2="190" y2="160" gradientUnits="userSpaceOnUse"><stop stop-color="#FF747E"/><stop offset="1" stop-color="#E93238"/></linearGradient>
      <filter id="mist-lens-shadow" x="30" y="12" width="180" height="160" filterUnits="userSpaceOnUse"><feDropShadow dx="0" dy="10" stdDeviation="8" flood-color="#020D25" flood-opacity=".30"/></filter>
    </defs>
    <circle cx="120" cy="88" r="68" stroke="#fff" stroke-opacity=".055" stroke-width="2"/>
    <circle cx="120" cy="88" r="53" stroke="#fff" stroke-opacity=".035"/>
    <g filter="url(#mist-lens-shadow)">
      <circle cx="108" cy="82" r="48" fill="url(#mist-lens-blue)"/>
      <circle cx="108" cy="82" r="38" fill="#F8FBFF" stroke="#D9E8F8" stroke-width="2"/>
      <path d="M83 65h35" stroke="#BFD6F2" stroke-width="5" stroke-linecap="round"/>
      <path d="M83 80h26" stroke="#BFD6F2" stroke-width="5" stroke-linecap="round"/>
      <path d="M83 95h31" stroke="#BFD6F2" stroke-width="5" stroke-linecap="round"/>
      <circle cx="132" cy="65" r="6" fill="#38B980"/>
      <path d="m129 65 2 2 4-5" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="124" cy="95" r="7" fill="#E93238"/>
      <path d="M124 91v5" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/>
      <circle cx="124" cy="99" r="1.2" fill="#fff"/>
      <path d="M141 118 181 158" stroke="url(#mist-handle-red)" stroke-width="18" stroke-linecap="round"/>
      <path d="M146 123 176 153" stroke="#FF9BA3" stroke-opacity=".28" stroke-width="5" stroke-linecap="round"/>
    </g>
    <path d="M45 58c7-11 16-19 27-25M169 49c9 7 16 16 20 27" stroke="#6CB6FF" stroke-width="3" stroke-linecap="round" stroke-dasharray="5 7"/>
    <path d="M52 118c8 10 18 17 30 21" stroke="#E93238" stroke-width="3" stroke-linecap="round"/>
    <circle cx="188" cy="88" r="4" fill="#63A8FF"/>
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
    element.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); } });
  });
  topicSheet.scrollTop = 0;
}

function renderMistakeDocument(categoryKey, doc) {
  topicSheet.classList.remove('category-glass');
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

function markCardDeckCompletedById(deckId) {
  if (!deckId) return false;
  const key = cardDeckCompletionKey(deckId);
  if (progress.completedSections?.[key]) return false;
  window.SRProgressSync.setKey(progress, 'completedSections', key, new Date().toISOString());
  return true;
}

// Gerçek flashcard destelerinde tamamlanma artık yalnız "desteyi kendi ekranından
// tek seferde açıp bitirme" işaretine bağlı değil. Kullanıcının Supabase'teki
// gerçek flashcard_progress satırları sayılır. Destedeki tüm kartlar en az bir kez
// çalışılmışsa, kartlar ana sayfadaki karışık tekrar oturumundan çözülmüş olsa bile
// deste tamamlandı olarak işaretlenir.
async function maybeMarkRealFlashcardDeckCompleted(deckId) {
  if (!window.currentUser || !deckId) return false;
  if (progress.completedSections?.[cardDeckCompletionKey(deckId)]) return false;

  try {
    const [progressMap, countResult] = await Promise.all([
      ContentRepo.fetchFlashcardProgress(deckId),
      supabaseClient.rpc('get_flashcard_count', { p_deck_id: deckId })
    ]);

    if (countResult.error) throw countResult.error;
    const total = Math.max(0, Number(countResult.data) || 0);
    const reviewed = Object.keys(progressMap || {}).length;

    if (total > 0 && reviewed >= total) {
      const changed = markCardDeckCompletedById(deckId);
      if (changed) saveProgress({ rerender: false });
      return changed;
    }
  } catch (error) {
    console.warn('Kart destesi ilerlemesi doğrulanamadı:', deckId, error?.message || error);
  }
  return false;
}

function reconcileFlashcardDeckCompletions({ force = false } = {}) {
  if (!window.currentUser) return Promise.resolve(false);
  if (!force && state.cardCompletionReconciled) return Promise.resolve(false);
  if (!force && state.cardCompletionReconcilePromise) return state.cardCompletionReconcilePromise;

  const catalogue = getCardCatalogue();
  const deckIds = [...new Set(
    Object.values(catalogue)
      .flatMap(category => category?.documents || [])
      .filter(doc => doc?.cardFile && doc?.id && !progress.completedSections?.[cardDeckCompletionKey(doc.id)])
      .map(doc => doc.id)
  )];

  if (!deckIds.length) {
    state.cardCompletionReconciled = true;
    return Promise.resolve(false);
  }

  const request = Promise.all(deckIds.map(id => maybeMarkRealFlashcardDeckCompleted(id)))
    .then(results => {
      const changed = results.some(Boolean);
      state.cardCompletionReconciled = true;
      if (changed && state.view === 'cards') render();
      return changed;
    })
    .catch(error => {
      console.warn('Kart ilerleme eşitlemesi tamamlanamadı:', error?.message || error);
      return false;
    })
    .finally(() => {
      if (state.cardCompletionReconcilePromise === request) state.cardCompletionReconcilePromise = null;
    });

  state.cardCompletionReconcilePromise = request;
  return request;
}

function cardsView() {
  const catalogue = getCardCatalogue();
  if (window.currentUser && !state.cardCompletionReconciled && !state.cardCompletionReconcilePromise) {
    setTimeout(() => reconcileFlashcardDeckCompletions().catch(() => {}), 0);
  }
  const presentation = {
    'general-legislation': { title: 'Genel Mevzuat', icon: 'scale', tone: 'navy' },
    'meb-legislation': { title: 'MEB Mevzuatı', icon: 'schoolbook', tone: 'red' },
    'general-culture': { title: 'Ortak Alan Bilgisi', icon: 'landmark', tone: 'blue' }
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
      ${rows.map(row => `<article class="cards-set-card tone-${row.design.tone}" data-open-card-category="${row.key}" role="button" tabindex="0" aria-label="${escapeHtml(row.design.title)}">
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
  applyCategoryProgressTone(categoryKey);
  resetSheetClasses();
  applySheetHeader({ title: category.title, subtitle: 'Çalışmak istediğin kaynağı seç.', eyebrow: 'BİLGİ KARTLARI', icon: category.icon, iconClass: category.iconClass });
  topicBreadcrumbWrap.innerHTML = '';

  // Kategori ilerlemesi artık sabit %0 değil; gerçek tamamlanan kart
  // setlerinden hesaplanır. Henüz aktif olmayan kaynaklar paydaya dahil edilmez.
  const activeDocuments = (category.documents || []).filter(doc => doc.topicId || doc.cardFile);
  const completedDocuments = activeDocuments.filter(isCardDeckCompleted);
  const categoryProgress = activeDocuments.length
    ? Math.round((completedDocuments.length / activeDocuments.length) * 100)
    : 0;
  const progressRatio = `${completedDocuments.length}/${activeDocuments.length} set tamamlandı`;
  setSheetProgress(
    progressRatio,
    categoryProgress,
    `· ${progressRatio}`
  );

  // Eski oturumlarda veya ana sayfadaki karışık kart tekrarlarında tamamlama
  // işareti oluşmamış olabilir. Supabase flashcard_progress ile bir kez uzlaştır;
  // değişiklik varsa açık kategori ekranını da anında yeniden çiz.
  if (window.currentUser && (!state.cardCompletionReconciled || state.cardCompletionReconcilePromise)) {
    const reconciliation = state.cardCompletionReconcilePromise || reconcileFlashcardDeckCompletions();
    reconciliation
      .then(changed => {
        if (!changed) return;
        if (!topicSheet.classList.contains('open') || topicSheet.classList.contains('card-study-active')) return;
        renderCardCategoryLevel(categoryKey);
      })
      .catch(() => {});
  }

  if (!category.documents.length) {
    topicList.innerHTML = `<section class="empty-state content-plan"><span class="empty-state-icon">${svg('book')}</span><h3>Bu kategori için kart seti hazırlanıyor</h3><p>Kaynaklar eklendiğinde burada otomatik olarak görünecek.</p></section>`;
    topicSheet.scrollTop = 0;
    return;
  }
  topicList.innerHTML = category.documents.map((doc, index) => {
    const active = doc.topicId || doc.cardFile;
    const completed = active && isCardDeckCompleted(doc);
    const info = completed ? 'Tamamlandı' : (active ? 'Aktif kart seti' : 'Yakında eklenecek');
    return `<article class="topic-item ${active ? '' : 'is-disabled'} ${completed ? 'is-completed' : ''}" data-card-doc-index="${index}" role="button" tabindex="0">
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
    element.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); } });
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
          state.cardCompletionReconciled = false;
          // Normal deste veya ana sayfadaki karışık tekrar fark etmez:
          // kartın ait olduğu gerçek desteyi tamamlanma açısından kontrol et.
          maybeMarkRealFlashcardDeckCompleted(deckIdForRating)
            .then(changed => {
              if (changed && state.view === 'cards') render();
            })
            .catch(() => {});
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
        if (wasDueSession) {
          refreshDueFlashcardCount();
          state.cardCompletionReconciled = false;
          reconcileFlashcardDeckCompletions({ force: true }).catch(() => {});
        }
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


function getProfileWeekDays() {
  const now = new Date();
  const jsDay = now.getDay(); // Pazar=0
  const mondayOffset = (jsDay + 6) % 7;
  const monday = new Date(now);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(now.getDate() - mondayOffset);
  const labels = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];
  return labels.map((label, index) => {
    const date = new Date(monday);
    date.setDate(monday.getDate() + index);
    const count = Number(progress.dailyAnswers?.[dateKey(date)] || 0);
    return {
      label,
      date,
      count,
      isToday: dateKey(date) === dateKey(now),
      isStudyDay: true,
      completed: count > 0
    };
  });
}

function getDailyGoalPreset(goal) {
  if (goal <= 20) return 'light';
  if (goal <= 50) return 'balanced';
  return 'intense';
}

function renderProfileDay(day) {
  const classes = [
    'sp-day',
    day.isStudyDay ? 'planned' : 'off',
    day.completed ? 'done' : '',
    day.isToday ? 'today' : ''
  ].filter(Boolean).join(' ');
  const marker = day.completed && !day.isToday
    ? `${svg('check', 'sp-day-check')}`
    : '<span class="sp-day-circle"></span>';
  return `<div class="${classes}">
    <strong>${escapeHtml(day.label)}</strong>
    ${marker}
    ${day.isToday ? '<small>Bugün</small>' : '<small>&nbsp;</small>'}
  </div>`;
}

function profileView() {
  const stats = getStats();
  const user = window.currentUser;
  const fullName = user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'Aday';
  const { first, second } = getAvatarInitials(fullName);
  const roleLabel = ROLES.find(r => r.key === progress.selectedRole)?.label || 'Hedef belirlenmedi';
  const prefs = progress.notificationPrefs || DEFAULT_NOTIFICATION_PREFS;
  const goalPreset = getDailyGoalPreset(stats.dailyGoal);
  const examLabel = 'Kadronu değiştir';

  const targetIcon = `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="4.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M14.8 9.2 21 3m0 0v5m0-5h-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/></svg>`;
  const pencilIcon = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 20 4.3-1 10.8-10.8a2.1 2.1 0 0 0-3-3L5.3 16 4 20Z"/><path d="m14.8 6.5 2.7 2.7"/></svg>`;
  const calendarIcon = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3v3m10-3v3M4 9h16"/><rect x="4" y="5" width="16" height="16" rx="3"/></svg>`;
  const focusIcon = `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="5"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3"/><circle cx="12" cy="12" r="1.5"/></svg>`;
  const gearIcon = `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V21h-4v-.08A1.7 1.7 0 0 0 8.97 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.56-1.03H3v-4h.08A1.7 1.7 0 0 0 4.6 8.94a1.7 1.7 0 0 0-.34-1.88L4.2 7l2.83-2.83.06.06a1.7 1.7 0 0 0 1.88.34A1.7 1.7 0 0 0 10 3.01V3h4v.08a1.7 1.7 0 0 0 1.03 1.56 1.7 1.7 0 0 0 1.88-.34l.06-.06L19.8 7l-.06.06a1.7 1.7 0 0 0-.34 1.88A1.7 1.7 0 0 0 20.96 10H21v4h-.08A1.7 1.7 0 0 0 19.4 15Z"/></svg>`;
  const studyPreferencesIcon = svg('sliders');
  const cupIcon = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h12v6a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V8Z"/><path d="M16 10h2a3 3 0 0 1 0 6h-2M7 3v2m4-2v2m4-2v2"/></svg>`;
  const userIcon = `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="7" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>`;
  const aaIcon = `<span class="sp-aa">Aa</span>`;
  const bellIcon = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/></svg>`;
  const logoutIcon = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 5H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h5"/><path d="m15 8 4 4-4 4"/><path d="M19 12H9"/></svg>`;

  return `<section class="screen content-screen profile-v2">
    <button class="sp-profile-card" id="editProfileButton" type="button">
      <span class="sp-avatar"><b>${escapeHtml(first)}</b><b>${escapeHtml(second || '')}</b></span>
      <span class="sp-profile-copy">
        <strong>${escapeHtml(fullName)}</strong>
        <small>${pencilIcon}<span>Profilimi düzenle</span></small>
      </span>
      <span class="sp-chevron">›</span>
    </button>

    <section class="sp-exam-card sp-exam-card-v2">
      <div class="sp-exam-icon-v2" aria-hidden="true">
        <span class="sp-exam-icon-ring">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <rect x="5" y="7.5" width="14" height="10.5" rx="2.3"></rect>
            <path d="M9 7.5V6.2A2.2 2.2 0 0 1 11.2 4h1.6A2.2 2.2 0 0 1 15 6.2v1.3"></path>
            <path d="M5 11.5h14"></path>
            <path d="M10 11.5v1.3h4v-1.3"></path>
          </svg>
        </span>
      </div>

      <div class="sp-exam-copy sp-exam-copy-v2">
        <span class="sp-exam-kicker-v2">Sınav hedefim</span>
        <strong class="${roleLabel === 'Şube Müdürü' ? 'is-long-role' : ''}">${escapeHtml(roleLabel)}</strong>
      </div>

      <button class="sp-exam-date sp-exam-date-v2" id="profileChangeRoleButton" type="button">
        <svg class="sp-swap-icon-v2" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M7 7h11l-2.7-2.7"></path>
          <path d="m18 7-2.7 2.7"></path>
          <path d="M17 17H6l2.7 2.7"></path>
          <path d="m6 17 2.7-2.7"></path>
        </svg>
        <span>${escapeHtml(examLabel)}</span>
        <b>›</b>
      </button>

      <span class="sp-exam-curve-v2" aria-hidden="true"></span>
    </section>

    <section class="sp-study-card sp-study-card-daily-only">
      <div class="sp-daily-premium">
        <div class="sp-daily-head">
          <div><h2 class="sp-daily-title">Günlük çalışma ilerlemesi</h2></div>
        </div>
        <div class="sp-goal-segments" role="group" aria-label="Günlük hedef yoğunluğu">
          <button type="button" data-goal-preset="20" class="${goalPreset === 'light' ? 'active' : ''}">Hafif</button>
          <button type="button" data-goal-preset="40" class="${goalPreset === 'balanced' ? 'active' : ''}">Dengeli</button>
          <button type="button" data-goal-preset="60" class="${goalPreset === 'intense' ? 'active' : ''}">Yoğun</button>
        </div>
        <div class="sp-goal-bottom">
          <div class="sp-goal-number"><strong>${stats.dailyGoal}</strong><span>soru / gün</span></div>
          <button class="sp-customize" id="profileCustomizeGoalButton" type="button">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h10m4 0h2M4 17h3m4 0h9M14 4v6m-7 4v6"/></svg>
            <span>Özelleştir</span>
          </button>
        </div>
      </div>
    </section>

    <section class="sp-tools-card">
      <div class="sp-tools-row sp-tools-row-reminder">
        <span class="sp-round-icon red">${svg('clock')}</span>
        <label class="sp-reminder-copy" for="notifReminderTimeInput">
          <strong>Hatırlatma saati</strong>
          <input type="time" id="notifReminderTimeInput" lang="tr-TR" value="${escapeHtml(prefs.reminderTime || '20:00')}" aria-label="Hatırlatma saati">
        </label>
        <button class="sp-switch${prefs.dailyReminder ? ' on' : ''}" type="button" data-notif-pref="dailyReminder" role="switch" aria-checked="${prefs.dailyReminder ? 'true' : 'false'}" aria-label="Günlük hatırlatma"><i></i></button>
      </div>

      <div class="sp-tools-divider" aria-hidden="true"></div>

      <div class="sp-tools-row sp-tools-row-focus">
        <span class="sp-round-icon navy">${focusIcon}</span>
        <div class="sp-focus-copy">
          <strong>Odak modu</strong>
          <small>Dikkatini dağıtan bildirimleri sınırla.</small>
        </div>
        <button class="sp-switch" id="profileFocusModeButton" type="button" role="switch" aria-checked="false" aria-label="Odak modu"><i></i></button>
      </div>
    </section>

    <button class="sp-statistics-entry" id="openStatisticsButton" type="button">
      <span class="sp-statistics-entry-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24">
          <path d="M5 19V11"></path>
          <path d="M12 19V5"></path>
          <path d="M19 19V9"></path>
        </svg>
      </span>
      <span class="sp-statistics-entry-copy">
        <strong>İstatistiklerim</strong>
        <small>Performansını ve çalışma eğilimlerini görüntüle</small>
      </span>
      <span class="sp-statistics-entry-arrow">›</span>
    </button>

    <button class="sp-study-preferences-entry" id="studyPreferencesButton" type="button">
      <span class="sp-study-preferences-icon">${studyPreferencesIcon}</span>
      <span class="sp-study-preferences-copy">
        <strong>Çalışma tercihlerim</strong>
        <small>Çalışma rotanı ve aralarını yönet</small>
      </span>
      <span class="sp-study-preferences-arrow">›</span>
    </button>

    <section class="sp-menu-card">
      <button class="sp-list-row sp-main-row" id="openAchievementsButton" type="button">
        ${svg('trophy')}<span>Başarılarım</span><b>›</b>
      </button>
      <button class="sp-list-row sp-main-row" id="appearanceSettingsButton" type="button">
        ${aaIcon}<span>Görünüm ve yazı boyutu</span><b>›</b>
      </button>
      <button class="sp-list-row sp-main-row" id="dataAccountButton" type="button">
        ${userIcon}<span>Hesap ve Verilerim</span><small class="sp-sync-state"><i></i>Eşitlendi</small><b>›</b>
      </button>
    </section>

    <button class="sp-signout-card" id="profileSignOutButton" type="button">
      <span class="sp-signout-card-icon">${logoutIcon}</span>
      <span class="sp-signout-card-copy">
        <strong>Çıkış yap</strong>
        <small>Bu cihazdaki oturumunu güvenli şekilde kapat</small>
      </span>
      <span class="sp-signout-card-arrow">›</span>
    </button>
  </section>`;
}




function studyPreferencesView() {
  const priority = studyPrefs.repeatPriority || 'personal';
  const paused = isStudyPaused();
  const options = [
    {value:'personal',title:'Sana Özel',desc:'Zayıf ve eksik konularına göre',icon:'sparkles'},
    {value:'weak',title:'Zayıf Konular',desc:'En çok yanlış yaptığın alanlar',icon:'chart'},
    {value:'recent',title:'Son Çalışılan',desc:'Kaldığın konudan devam et',icon:'clock'},
    {value:'random',title:'Rastgele Karma',desc:'Tüm konulardan dengeli seçim',icon:'shuffle'}
  ];
  return `<section class="screen content-screen sp-subscreen study-preferences-page">
    <header class="sp-page-head sp-subpage-head">
      <button class="sp-back" id="studyPrefsBackButton" type="button">${svg('back')}</button>
      <h1>Çalışma tercihlerim</h1>
    </header>

    <section class="study-pref-intro">
      <span class="study-pref-intro-icon">${svg('compass')}</span>
      <div><strong>Çalışma rotanı kişiselleştir</strong><small>Bugünkü rotanı ve çalışma planının durumunu belirle.</small></div>
    </section>

    <section class="study-pref-card">
      <div class="study-pref-card-head"><div><strong>Bugünkü Rota nasıl hazırlansın?</strong></div><span class="study-pref-current">${escapeHtml(getRepeatPriorityLabel(priority))}</span></div>
      <div class="study-priority-list">
        ${options.map(o => `<button type="button" class="study-priority-option${priority===o.value?' active':''}" data-repeat-priority="${o.value}">
          <span class="study-priority-icon">${svg(o.icon)}</span>
          <span class="study-priority-copy"><strong>${escapeHtml(o.title)}</strong><small>${escapeHtml(o.desc)}</small></span><i></i>
        </button>`).join('')}
      </div>
    </section>

    <section class="study-pref-card">
      <div class="study-pref-card-head"><div><span>ÇALIŞMAYA ARA VER</span><strong>${paused?'Planın şu anda duraklatıldı':'Planını geçici olarak duraklat'}</strong></div>${paused?'<span class="study-pause-badge">Duraklatıldı</span>':''}</div>
      ${paused ? `
        <div class="study-pause-active"><span class="study-pause-active-icon">${svg('pause')}</span><div><strong>${escapeHtml(formatStudyPauseDate())}</strong><small>Günlük rota ve çalışma hatırlatmaları bu süre boyunca durur.</small></div></div>
        <button type="button" class="study-resume-button" id="studyResumeButton">Çalışmaya devam et</button>
      ` : `
        <p class="study-pause-desc">Ara verdiğinde ilerleme verilerin silinmez. Günlük rota ve çalışma hatırlatmaları geçici olarak durur.</p>
        <div class="study-pause-presets">
          <button type="button" data-pause-days="1"><strong>1 gün</strong><small>Kısa mola</small></button>
          <button type="button" data-pause-days="3"><strong>3 gün</strong><small>Mini ara</small></button>
          <button type="button" data-pause-days="7"><strong>1 hafta</strong><small>Uzun ara</small></button>
        </div>
        <div class="study-custom-pause"><label for="studyPauseDateInput"><span>Özel tarih</span><input type="date" id="studyPauseDateInput"></label><button type="button" id="studyPauseDateButton">Uygula</button></div>
      `}
    </section>
  </section>`;
}

function appearanceSettingsView() {
  const textSize = uiPrefs.textSize || 'standard';
  const density = uiPrefs.density || 'standard';
  const layoutIcon = `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16M9 10h12"/></svg>`;

  return `<section class="screen content-screen sp-subscreen appearance-page">
    <header class="sp-page-head sp-subpage-head">
      <button class="sp-back" id="appearanceBackButton" type="button" aria-label="Profile dön">${svg('back')}</button>
      <h1>Görünüm ve yazı boyutu</h1>
    </header>

    <section class="appearance-preview-card">
      <span class="appearance-preview-eyebrow">ÖNİZLEME</span>
      <strong>Okumayı kendine göre ayarla</strong>
      <p>Seçimlerin bu cihazda saklanır ve uygulamaya anında uygulanır.</p>
      <div class="appearance-preview-sample">
        <b>Aa</b>
        <div><strong>Örnek soru metni</strong><small>Metin boyutu ve ekran yoğunluğu seçimine göre değişir.</small></div>
      </div>
    </section>

    <section class="appearance-setting-card">
      <div class="appearance-setting-head">
        <span class="appearance-setting-icon">Aa</span>
        <div><strong>Yazı boyutu</strong><small>Metinlerin okunabilirliğini ayarla.</small></div>
      </div>
      <div class="appearance-segment" role="group" aria-label="Yazı boyutu">
        <button type="button" data-text-size="small" class="${textSize === 'small' ? 'active' : ''}"><span class="size-small">Aa</span><small>Küçük</small></button>
        <button type="button" data-text-size="standard" class="${textSize === 'standard' ? 'active' : ''}"><span class="size-standard">Aa</span><small>Standart</small></button>
        <button type="button" data-text-size="large" class="${textSize === 'large' ? 'active' : ''}"><span class="size-large">Aa</span><small>Büyük</small></button>
      </div>
    </section>

    <section class="appearance-setting-card">
      <div class="appearance-setting-head">
        <span class="appearance-setting-icon">${layoutIcon}</span>
        <div><strong>Arayüz yoğunluğu</strong><small>Kartların yüksekliğini, iç boşluklarını ve ekran başına düşen içerik miktarını ayarla.</small></div>
      </div>
      <div class="appearance-density-list">
        <button type="button" data-ui-density="comfortable" class="${density === 'comfortable' ? 'active' : ''}">
          <span><b>Rahat</b><small>Daha ferah kartlar ve geniş boşluklar</small></span><i></i>
        </button>
        <button type="button" data-ui-density="standard" class="${density === 'standard' ? 'active' : ''}">
          <span><b>Standart</b><small>Önerilen varsayılan görünüm</small></span><i></i>
        </button>
        <button type="button" data-ui-density="compact" class="${density === 'compact' ? 'active' : ''}">
          <span><b>Kompakt</b><small>Ekranda daha fazla içerik gösterir</small></span><i></i>
        </button>
      </div>
    </section>
  </section>`;
}

function dataAccountView() {
  const user = window.currentUser;
  const email = user?.email || 'E-posta bilgisi yok';
  const fullName = user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'Kullanıcı';
  const isPremium = window.currentUserIsPremium === true;
  const subscriptionLabel = isPremium ? 'Premium' : 'Free';
  const subscriptionText = isPremium ? 'Premium erişimin aktif.' : 'Şu anda ücretsiz planı kullanıyorsun.';
  const isResetConfirm = accountConfirmAction === 'reset';
  const isDeleteConfirm = accountConfirmAction === 'delete';

  const userIcon = `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="7" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>`;
  const cloudIcon = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 18h10a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.2 8.1 5 5 0 0 0 7 18Z"/><path d="m9 14 2 2 4-4"/></svg>`;
  const databaseIcon = `<svg viewBox="0 0 24 24" aria-hidden="true"><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/></svg>`;
  const trashIcon = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="m6 7 1 14h10l1-14"/><path d="M10 11v6m4-6v6"/></svg>`;
  const starIcon = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9L12 3Z"/></svg>`;

  const confirmOverlay = isResetConfirm ? `
    <div class="account-confirm-overlay" id="accountConfirmOverlay" role="dialog" aria-modal="true">
      <div class="account-confirm-card">
        <span class="account-confirm-icon warning">${databaseIcon}</span>
        <h2>İlerleme verilerini temizle?</h2>
        <p>Soru çözüm geçmişin, yanlışların, deneme sonuçların, seri ve rozet ilerlemen ile kart tekrarların sıfırlanacak. <strong>Kadron, günlük hedefin ve bildirim tercihlerinin korunacak.</strong></p>
        <div class="account-confirm-actions">
          <button type="button" class="account-confirm-cancel" id="accountConfirmCancelButton">Vazgeç</button>
          <button type="button" class="account-confirm-danger" id="accountResetConfirmButton">Verileri temizle</button>
        </div>
      </div>
    </div>` : isDeleteConfirm ? `
    <div class="account-confirm-overlay" id="accountConfirmOverlay" role="dialog" aria-modal="true">
      <div class="account-confirm-card delete">
        <span class="account-confirm-icon danger">${trashIcon}</span>
        <h2>Hesabını kalıcı olarak sil?</h2>
        <p>Hesabın ve ilişkili çalışma verilerin kalıcı olarak silinecek. Bu işlem <strong>geri alınamaz.</strong></p>
        <label class="account-delete-confirm-label">Devam etmek için <b>SİL</b> yaz
          <input id="accountDeleteConfirmInput" type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="SİL">
        </label>
        <p class="account-action-error" id="accountDeleteError" aria-live="polite"></p>
        <div class="account-confirm-actions">
          <button type="button" class="account-confirm-cancel" id="accountConfirmCancelButton">Vazgeç</button>
          <button type="button" class="account-confirm-danger" id="accountDeleteConfirmButton" disabled>Hesabımı sil</button>
        </div>
      </div>
    </div>` : '';

  return `<section class="screen content-screen sp-subscreen data-account-page">
    <header class="sp-page-head sp-subpage-head">
      <button class="sp-back" id="dataAccountBackButton" type="button" aria-label="Profile dön">${svg('back')}</button>
      <h1>Hesap ve Verilerim</h1>
    </header>

    <section class="account-user-card">
      <div class="account-user-mark">${userIcon}</div>
      <div class="account-user-copy"><strong>${escapeHtml(fullName)}</strong><span>${escapeHtml(email)}</span></div>
      <span class="account-sync-pill"><i></i>Eşitlendi</span>
    </section>

    <section class="account-section-card account-subscription-card">
      <div class="account-section-head">
        <span class="account-section-icon subscription">${starIcon}</span>
        <div><strong>Abonelik</strong><small>Mevcut planın ve erişim durumun.</small></div>
      </div>
      <div class="account-subscription-row">
        <div class="account-subscription-copy">
          <span>Plan</span><strong>${subscriptionLabel}</strong><small>${subscriptionText}</small>
        </div>
        <span class="account-plan-badge${isPremium ? ' premium' : ''}">${subscriptionLabel}</span>
      </div>
    </section>

    <section class="account-section-card">
      <div class="account-section-head">
        <span class="account-section-icon blue">${cloudIcon}</span>
        <div><strong>Veri ve senkronizasyon</strong><small>Çalışma ilerlemen hesabınla eşitlenir.</small></div>
      </div>
      <button class="account-action-row" id="accountResetProgressButton" type="button">
        <span class="account-action-icon">${databaseIcon}</span>
        <span class="account-action-copy"><strong>İlerleme verilerini temizle</strong><small>Soru geçmişini ve çalışma ilerlemeni sıfırla</small></span><b>›</b>
      </button>
    </section>

    <section class="account-danger-card">
      <span class="account-danger-eyebrow">TEHLİKELİ BÖLGE</span>
      <button class="account-action-row danger" id="accountDeleteButton" type="button">
        <span class="account-action-icon">${trashIcon}</span>
        <span class="account-action-copy"><strong>Hesabımı sil</strong><small>Hesabını ve ilişkili verilerini kalıcı olarak sil</small></span><b>›</b>
      </button>
    </section>
    ${confirmOverlay}
  </section>`;
}

function profileEditView() {
  const user = window.currentUser;
  const fullName = user?.user_metadata?.full_name || user?.email?.split('@')[0] || '';
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  const firstName = parts.shift() || '';
  const lastName = parts.join(' ');

  return `<section class="screen content-screen sp-subscreen profile-edit-page">
    <header class="sp-page-head sp-subpage-head">
      <button class="sp-back" id="profileEditBackButton" type="button" aria-label="Profile dön">${svg('back')}</button>
      <h1>Profilimi düzenle</h1>
    </header>

    <section class="sp-form-card">
      <div class="sp-form-head">
        <span>${svg('idcard')}</span>
        <div><strong>Kişisel bilgiler</strong><small>Ad ve soyadın profilinde görüntülenir.</small></div>
      </div>
      <label class="sp-field-label">Ad
        <input id="profileFirstNameInput" class="sp-text-input" type="text" autocomplete="given-name" value="${escapeHtml(firstName)}" maxlength="60">
      </label>
      <label class="sp-field-label">Soyad
        <input id="profileLastNameInput" class="sp-text-input" type="text" autocomplete="family-name" value="${escapeHtml(lastName)}" maxlength="60">
      </label>
    </section>

    <section class="sp-form-card">
      <div class="sp-form-head">
        <span>${svg('lock')}</span>
        <div><strong>Şifre değiştir</strong><small>Şifreni değiştirmek istemiyorsan alanları boş bırak.</small></div>
      </div>
      <label class="sp-field-label">Yeni şifre
        <input id="profileNewPasswordInput" class="sp-text-input" type="password" autocomplete="new-password" minlength="8" placeholder="En az 8 karakter">
      </label>
      <label class="sp-field-label">Yeni şifre tekrar
        <input id="profileNewPasswordConfirmInput" class="sp-text-input" type="password" autocomplete="new-password" minlength="8" placeholder="Şifreni tekrar yaz">
      </label>
    </section>

    <p class="sp-form-error" id="profileEditError" aria-live="polite"></p>
    <button class="sp-primary-action" id="profileEditSaveButton" type="button">Değişiklikleri kaydet</button>
  </section>`;
}

function goalSettingsView() {
  const goal = Number(progress.dailyGoal || DEFAULT_DAILY_GOAL);
  return `<section class="screen content-screen sp-subscreen goal-settings-page">
    <header class="sp-page-head sp-subpage-head">
      <button class="sp-back" id="goalSettingsBackButton" type="button" aria-label="Profile dön">${svg('back')}</button>
      <h1>Günlük hedef</h1>
    </header>

    <section class="goal-custom-hero">
      <span class="goal-custom-icon">${svg('target')}</span>
      <div><small>GÜNLÜK ÇALIŞMA</small><strong>Temponu kendin belirle</strong><p>Hedefin ilerleme halkasını ve günlük çalışma planını belirler.</p></div>
    </section>

    <section class="sp-form-card goal-custom-card">
      <strong class="goal-custom-title">Hazır tempolar</strong>
      <div class="goal-custom-presets">
        <button type="button" data-custom-goal="20"><b>20</b><span>Hafif</span></button>
        <button type="button" data-custom-goal="40"><b>40</b><span>Dengeli</span></button>
        <button type="button" data-custom-goal="60"><b>60</b><span>Yoğun</span></button>
      </div>

      <div class="goal-custom-value">
        <button id="goalMinusButton" type="button" aria-label="Hedefi azalt">−</button>
        <label><input id="customDailyGoalInput" type="number" inputmode="numeric" min="${DAILY_GOAL_MIN}" max="${DAILY_GOAL_MAX}" value="${goal}"><span>soru / gün</span></label>
        <button id="goalPlusButton" type="button" aria-label="Hedefi artır">+</button>
      </div>
      <small class="goal-custom-note">1 ile 500 soru arasında bir hedef seçebilirsin.</small>
    </section>

    <p class="sp-form-error" id="goalSettingsError" aria-live="polite"></p>
    <button class="sp-primary-action" id="goalSettingsSaveButton" type="button">Hedefi kaydet</button>
  </section>`;
}


function getStatisticsLast7Days() {
  const labels = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const rows = [];
  for (let offset = 6; offset >= 0; offset -= 1) {
    const date = new Date(today);
    date.setDate(today.getDate() - offset);
    rows.push({
      key: dateKey(date),
      label: labels[date.getDay()],
      count: Number(progress.dailyAnswers?.[dateKey(date)] || 0),
      isToday: offset === 0
    });
  }
  return rows;
}


function getStatisticsRangeRows(range = 'week') {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const countForDate = date => Number(progress.dailyAnswers?.[dateKey(date)] || 0);
  const trDay = ['Paz','Pzt','Sal','Çar','Per','Cum','Cmt'];
  const monthShort = ['Oca','Şub','Mar','Nis','May','Haz','Tem','Ağu','Eyl','Eki','Kas','Ara'];

  if (range === 'day') {
    return [{
      key: dateKey(today),
      label: 'Bugün',
      count: countForDate(today),
      isToday: true
    }];
  }

  if (range === 'week') {
    const rows = [];
    for (let offset = 6; offset >= 0; offset -= 1) {
      const date = new Date(today);
      date.setDate(today.getDate() - offset);
      rows.push({
        key: dateKey(date),
        label: trDay[date.getDay()],
        count: countForDate(date),
        isToday: offset === 0
      });
    }
    return rows;
  }

  if (range === 'month') {
    // 30 günü 6 adet 5 günlük blok halinde göster: okunaklı ve gerçek veri.
    const rows = [];
    for (let block = 5; block >= 0; block -= 1) {
      let total = 0;
      let firstDate = null;
      let lastDate = null;
      for (let inner = 0; inner < 5; inner += 1) {
        const offset = block * 5 + inner;
        const date = new Date(today);
        date.setDate(today.getDate() - offset);
        total += countForDate(date);
        if (!lastDate) lastDate = new Date(date);
        firstDate = new Date(date);
      }
      rows.push({
        key: `m-${block}`,
        label: `${firstDate.getDate()}–${lastDate.getDate()}`,
        count: total,
        isToday: block === 0
      });
    }
    return rows;
  }

  // Yıllık: içinde bulunduğumuz yılın ay toplamları.
  const year = today.getFullYear();
  const rows = [];
  for (let month = 0; month < 12; month += 1) {
    let total = 0;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    for (let day = 1; day <= daysInMonth; day += 1) {
      const date = new Date(year, month, day);
      if (date > today) break;
      total += countForDate(date);
    }
    rows.push({
      key: `y-${month}`,
      label: monthShort[month],
      count: total,
      isToday: month === today.getMonth()
    });
  }
  return rows;
}

function getStatisticsRangeLabel(range) {
  return ({
    day: 'Gün',
    week: 'Hafta',
    month: 'Son 30 gün',
    year: 'Yıllık'
  })[range] || 'Hafta';
}

function renderStatisticsDropdown(id, label, options, openKey) {
  const isOpen = statisticsUi.openMenu === openKey;
  return `<div class="stats-dropdown${isOpen ? ' open' : ''}">
    <button class="stats-dropdown-trigger" id="${id}" type="button" aria-expanded="${isOpen ? 'true' : 'false'}">
      <span>${escapeHtml(label)}</span>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 9 5 5 5-5"></path></svg>
    </button>
    <div class="stats-dropdown-menu">
      ${options.map(option => `<button type="button" data-stats-option="${escapeHtml(openKey)}" data-value="${escapeHtml(option.value)}" class="${option.active ? 'active' : ''}">
        <span>${escapeHtml(option.label)}</span>
        ${option.active ? '<b>✓</b>' : ''}
      </button>`).join('')}
    </div>
  </div>`;
}

function getStatisticsDocumentRows(limit = 5) {
  const tests = Array.isArray(progress.completedTests) ? progress.completedTests : [];
  const docs = new Map();

  getActiveDocuments().forEach(entry => {
    docs.set(entry.item.id, {
      id: entry.item.id,
      title: entry.item.title,
      categoryKey: entry.categoryKey
    });
  });

  const grouped = new Map();
  tests.forEach(test => {
    if (!test?.documentId || !Number.isFinite(Number(test.total)) || Number(test.total) <= 0) return;
    const doc = docs.get(test.documentId);
    if (!doc) return;
    const existing = grouped.get(test.documentId) || {
      id: test.documentId,
      title: doc.title,
      categoryKey: doc.categoryKey,
      correct: 0,
      total: 0,
      sessions: 0
    };
    existing.correct += Math.max(0, Number(test.score) || 0);
    existing.total += Math.max(0, Number(test.total) || 0);
    existing.sessions += 1;
    grouped.set(test.documentId, existing);
  });

  return [...grouped.values()]
    .map(row => ({
      ...row,
      accuracy: row.total ? Math.round((row.correct / row.total) * 100) : 0
    }))
    .sort((a, b) => b.total - a.total || b.accuracy - a.accuracy)
    .slice(0, limit);
}


function getStatisticsOverview(range = 'all') {
  const now = new Date();
  let start = null;

  if (range === 'today') {
    start = new Date(now);
    start.setHours(0, 0, 0, 0);
  } else if (range === 'week') {
    start = new Date(now);
    start.setDate(now.getDate() - 6);
    start.setHours(0, 0, 0, 0);
  } else if (range === 'month') {
    start = new Date(now);
    start.setDate(now.getDate() - 29);
    start.setHours(0, 0, 0, 0);
  }

  const tests = (Array.isArray(progress.completedTests) ? progress.completedTests : []).filter(test => {
    if (!start) return true;
    const completedAt = new Date(test?.completedAt || 0);
    return Number.isFinite(completedAt.getTime()) && completedAt >= start && completedAt <= now;
  });

  // Tek veri kaynağı: completedTests.
  // Yeni kayıtlarda answered gerçek cevaplanan soru sayısıdır.
  // Eski kayıtlarda answered yoksa geriye dönük uyumluluk için total kullanılır.
  let total = 0;
  let correct = 0;
  let mocks = 0;

  tests.forEach(test => {
    const answered = Math.max(0, Number(test.answered ?? test.total) || 0);
    const score = Math.min(answered, Math.max(0, Number(test.score) || 0));
    total += answered;
    correct += score;
    if (EXAM_KINDS.includes(test.kind)) mocks += 1;
  });

  return {
    total,
    correct,
    wrong: Math.max(0, total - correct),
    mocks
  };
}

function getStatisticsOverviewLabel(range) {
  return ({ today:'Bugün', week:'Haftalık', month:'Son 30 gün', all:'Bugüne kadar' })[range] || 'Bugüne kadar';
}

function statisticsView() {
  const stats = getStats();
  const overviewRange = statisticsUi.overviewRange || 'all';
  const overviewStats = getStatisticsOverview(overviewRange);
  const total = overviewStats.total;
  const correct = overviewStats.correct;
  const wrong = overviewStats.wrong;
  const accuracy = total ? Math.round((correct / total) * 100) : 0;
  const mocks = overviewStats.mocks;
  const range = statisticsUi.range || 'week';
  const days = getStatisticsRangeRows(range);
  const maxDay = Math.max(1, ...days.map(day => day.count));
  const rawDocRows = getStatisticsDocumentRows(12);
  const subjectMetric = statisticsUi.subjectMetric || 'correct';
  const docRows = rawDocRows
    .map(row => ({
      ...row,
      metricValue: subjectMetric === 'wrong' ? Math.max(0, 100 - row.accuracy) : row.accuracy
    }))
    .sort((a, b) => b.metricValue - a.metricValue || b.total - a.total)
    .slice(0, 5);

  const formatNumber = value => Number(value || 0).toLocaleString('tr-TR');

  const overviewDropdown = renderStatisticsDropdown(
    'statisticsOverviewRangeButton',
    getStatisticsOverviewLabel(overviewRange),
    [
      { value:'today', label:'Bugün', active:overviewRange === 'today' },
      { value:'week', label:'Haftalık', active:overviewRange === 'week' },
      { value:'month', label:'Son 30 gün', active:overviewRange === 'month' },
      { value:'all', label:'Bugüne kadar', active:overviewRange === 'all' }
    ],
    'overview'
  );

  const rangeDropdown = renderStatisticsDropdown(
    'statisticsRangeButton',
    getStatisticsRangeLabel(range),
    [
      { value:'day', label:'Gün', active:range === 'day' },
      { value:'week', label:'Hafta', active:range === 'week' },
      { value:'month', label:'Son 30 gün', active:range === 'month' },
      { value:'year', label:'Yıllık', active:range === 'year' }
    ],
    'range'
  );

  const subjectDropdown = renderStatisticsDropdown(
    'statisticsSubjectMetricButton',
    subjectMetric === 'wrong' ? 'Yanlış oranı' : 'Doğru oranı',
    [
      { value:'correct', label:'Doğru oranı', active:subjectMetric === 'correct' },
      { value:'wrong', label:'Yanlış oranı', active:subjectMetric === 'wrong' }
    ],
    'subject'
  );

  return `<section class="screen content-screen statistics-page sp-subscreen">
    <header class="sp-page-head sp-subpage-head statistics-head">
      <button class="sp-back" id="statisticsBackButton" type="button" aria-label="Profile dön">${svg('back')}</button>
      <h1>İstatistiklerim</h1>
    </header>

    <section class="stats-overview-card">
      <div class="stats-card-heading">
        <div>
          <span class="stats-eyebrow">GENEL PERFORMANS</span>
          <strong>Çalışma özeti</strong>
        </div>
        ${overviewDropdown}
      </div>

      <div class="stats-overview-grid">
        <div class="stats-donut-wrap">
          <div class="stats-donut" style="--accuracy:${accuracy};--wrong:${Math.max(0, 100 - accuracy)}">
            <div class="stats-donut-inner">
              <strong>%${accuracy}</strong>
              <span>Doğru oranı</span>
            </div>
          </div>
          <div class="stats-donut-legend">
            <span><i class="is-correct"></i> Doğru %${accuracy}</span>
            <span><i class="is-wrong"></i> Yanlış %${Math.max(0, 100 - accuracy)}</span>
          </div>
        </div>

        <div class="stats-metric-grid">
          <article class="stats-metric metric-total">
            <span class="stats-metric-icon">${svg('book')}</span>
            <div><small>Toplam çözüm</small><strong>${formatNumber(total)}</strong></div>
          </article>
          <article class="stats-metric metric-correct">
            <span class="stats-metric-icon">${svg('check')}</span>
            <div><small>Doğru</small><strong>${formatNumber(correct)}</strong></div>
          </article>
          <article class="stats-metric metric-wrong">
            <span class="stats-metric-icon">×</span>
            <div><small>Yanlış</small><strong>${formatNumber(wrong)}</strong></div>
          </article>
          <article class="stats-metric metric-mock">
            <span class="stats-metric-icon">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M8 3h6l4 4v14H6V3h2Z"></path>
                <path d="M14 3v5h5"></path>
                <path d="M9 12h6"></path>
                <path d="M9 16h6"></path>
              </svg>
            </span>
            <div><small>Deneme</small><strong>${formatNumber(mocks)}</strong></div>
          </article>
        </div>
      </div>
    </section>

    <section class="stats-chart-card">
      <div class="stats-card-heading compact">
        <div>
          <span class="stats-eyebrow">${escapeHtml(getStatisticsRangeLabel(range).toUpperCase())}</span>
          <strong>Soru çözme performansı</strong>
        </div>
        ${rangeDropdown}
      </div>

      <div class="stats-bars stats-bars-${escapeHtml(range)}">
        ${days.map(day => {
          const height = day.count ? Math.max(14, Math.round((day.count / maxDay) * 100)) : 6;
          return `<div class="stats-bar-col${day.isToday ? ' today' : ''}">
            <strong>${formatNumber(day.count)}</strong>
            <div class="stats-bar-track"><i style="height:${height}%"></i></div>
            <span>${escapeHtml(day.label)}</span>
          </div>`;
        }).join('')}
      </div>
    </section>

    <section class="stats-subject-card">
      <div class="stats-card-heading compact">
        <div>
          <span class="stats-eyebrow">ÇÖZÜLEN TESTLER</span>
          <strong>Ders bazlı performans</strong>
        </div>
        ${subjectDropdown}
      </div>

      <div class="stats-subject-list">
        ${docRows.length ? docRows.map((row, index) => {
          const shownValue = row.metricValue;
          const detailCorrect = Math.max(0, Number(row.correct) || 0);
          const detailWrong = Math.max(0, Number(row.total) - detailCorrect);
          return `<article class="stats-subject-row">
            <span class="stats-subject-rank">${String(index + 1).padStart(2, '0')}</span>
            <div class="stats-subject-copy">
              <div class="stats-subject-title">
                <strong>${escapeHtml(row.title)}</strong>
                <span>%${shownValue}</span>
              </div>
              <div class="stats-subject-progress ${subjectMetric === 'wrong' ? 'wrong' : ''}"><i style="width:${shownValue}%"></i></div>
              <small>${subjectMetric === 'wrong'
                ? `${formatNumber(detailWrong)} yanlış / ${formatNumber(row.total)} soru · ${formatNumber(row.sessions)} oturum`
                : `${formatNumber(detailCorrect)} doğru / ${formatNumber(row.total)} soru · ${formatNumber(row.sessions)} oturum`
              }</small>
            </div>
          </article>`;
        }).join('') : `<div class="stats-empty">
          <span>${svg('chart')}</span>
          <strong>Henüz yeterli test verisi yok</strong>
          <small>Konu testlerini tamamladıkça ders bazlı performansın burada oluşacak.</small>
        </div>`}
      </div>
    </section>
  </section>`;
}

function achievementsView() {
  const stats = getStats();
  const badges = getBadges(stats);
  const unlockedCount = badges.filter(badge => badge.unlocked).length;
  return `<section class="screen content-screen achievements-page">
    <header class="sp-page-head sp-subpage-head">
      <button class="sp-back" id="achievementsBackButton" type="button" aria-label="Profile dön">${svg('back')}</button>
      <h1>Başarılarım</h1>
    </header>

    <section class="ach-summary ach-summary-premium">
      <div class="ach-summary-copy">
        <span class="ach-summary-eyebrow">BAŞARI DURUMU</span>
        <strong>${unlockedCount} / ${badges.length} <small>rozet</small></strong>
        <p>Hedeflerine ilerledikçe koleksiyonun büyür.</p>
        <div class="ach-summary-progress"><i style="width:${Math.round((unlockedCount / Math.max(1, badges.length)) * 100)}%"></i></div>
      </div>
      <div class="ach-summary-icon"><span>${svg('trophy')}</span></div>
    </section>

    <section class="ach-card">
      <div class="ach-card-head ach-card-head-premium">
        <div><strong>Rozetlerim</strong><small>Çalışma alışkanlığın büyüdükçe yeni rozetler açılır.</small></div>
        <span>${unlockedCount} rozet kazanıldı</span>
      </div>
      <div class="ach-grid">
        ${badges.map(badge => `<article class="ach-badge${badge.unlocked ? ' unlocked' : ' locked'}">
          <div class="ach-badge-img"><img src="${badge.image}" alt="${escapeHtml(badge.label)}" loading="eager"></div>
          <strong>${escapeHtml(badge.label)}</strong>
          <small>${badge.unlocked ? 'Kazanıldı' : `${badge.value} / ${badge.target} ${escapeHtml(badge.unit)}`}</small>
          <div class="ach-progress"><i style="width:${Math.min(100, Math.round((badge.value / badge.target) * 100))}%"></i></div>
        </article>`).join('')}
      </div>
    </section>
  </section>`;
}

// A separate navigation surface keeps content out of the status-bar area.
function syncPageNavigation() {
  const nav=document.getElementById('pageNavigation');
  if(!nav || nav.hidden)return;
  const heading=app.querySelector('.sp-subpage-head h1, .bank-v2-heading, .cards-dashboard-heading, .mistakes-ref-heading, .sp-profile-card');
  const collapsed=heading ? heading.getBoundingClientRect().bottom <= nav.getBoundingClientRect().bottom + 4 : scrollArea.scrollTop>28;
  nav.classList.toggle('is-scrolled',collapsed);
}
function updatePageNavigation() {
  const phone=scrollArea.closest('.phone');
  if(!phone)return;
  let nav=document.getElementById('pageNavigation');
  if(!nav){
    nav=document.createElement('nav'); nav.id='pageNavigation'; nav.className='page-navigation'; nav.setAttribute('aria-label','Sayfa gezinmesi');
    nav.innerHTML=`<div class="page-navigation-row"><button type="button" class="page-navigation-back" aria-label="Geri dön">${svg('back')}</button><span class="page-navigation-title"></span><span class="page-navigation-spacer" aria-hidden="true"></span></div>`;
    phone.appendChild(nav);
    nav.querySelector('button').addEventListener('click',()=>app.querySelector('.sp-subpage-head .sp-back')?.click());
    scrollArea.addEventListener('scroll',syncPageNavigation,{passive:true});
    window.addEventListener('resize',syncPageNavigation);
  }
  const subhead=app.querySelector('.sp-subpage-head');
  const mainTitles={bank:'Deneme Sınavları',cards:'Kartlarım',mistakes:'Yanlışlarım',profile:'Profil'};
  const title=subhead?.querySelector('h1')?.textContent || mainTitles[state.view];
  const active=Boolean(title);
  nav.hidden=!active; phone.classList.toggle('has-page-navigation',active);
  phone.classList.toggle('native-ios-navigation',window.Capacitor?.getPlatform?.()==='ios');
  if(!active)return;
  nav.querySelector('.page-navigation-title').textContent=title;
  nav.querySelector('button').hidden=!subhead?.querySelector('.sp-back');
  nav.classList.toggle('has-back',Boolean(subhead?.querySelector('.sp-back')));
  nav.classList.remove('always-title');
  subhead?.classList.add('page-navigation-source');
  syncPageNavigation();
  requestAnimationFrame(syncPageNavigation);
}

function render() {
  const views = { home: homeView, bank: bankView, mistakes: mistakesView, cards: cardsView, profile: profileView, statistics: statisticsView, achievements: achievementsView, 'profile-edit': profileEditView, 'goal-settings': goalSettingsView, 'data-account': dataAccountView, appearance: appearanceSettingsView, 'study-preferences': studyPreferencesView };
  const appHeader = document.querySelector('.app-header');
  if (appHeader) appHeader.classList.toggle('hidden', ['cards', 'bank', 'mistakes', 'profile', 'statistics', 'achievements', 'profile-edit', 'goal-settings', 'data-account', 'appearance', 'study-preferences'].includes(state.view));
  app.innerHTML = (views[state.view] || homeView)();
  bindViewEvents();
  updatePageNavigation();
  updateHeader();
  requestAnimationFrame(applyTextScaleToCurrentUi);
}

function bindViewEvents() {
  const showAllExamsButton = document.getElementById('showAllExamsButton');
  showAllExamsButton?.addEventListener('click', () => {
    state.showAllCompletedExams = !state.showAllCompletedExams;
    const top = scrollArea.scrollTop;
    render();
    scrollArea.scrollTop = top;
  });
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

  // Profil v2 etkileşimleri
  document.getElementById('editProfileButton')?.addEventListener('click', () => {
    profileReturnScrollTop = scrollArea.scrollTop;
    state.view = 'profile-edit';
    setNav('profile');
    render();
    scrollArea.scrollTop = 0;
  });

  document.getElementById('profileChangeRoleButton')?.addEventListener('click', () => {
    openRoleGate(true, progress.selectedRole, 'change');
  });

  app.querySelectorAll('[data-goal-preset]').forEach(button => {
    button.addEventListener('click', () => setDailyGoal(button.dataset.goalPreset));
  });

  document.getElementById('profileCustomizeGoalButton')?.addEventListener('click', () => {
    profileReturnScrollTop = scrollArea.scrollTop;
    state.view = 'goal-settings';
    setNav('profile');
    render();
    scrollArea.scrollTop = 0;
  });

  document.getElementById('profileFocusModeButton')?.addEventListener('click', event => {
    const button = event.currentTarget;
    const next = button.getAttribute('aria-checked') !== 'true';
    button.setAttribute('aria-checked', String(next));
    button.classList.toggle('on', next);
    showToast(next ? 'Odak modu açıldı.' : 'Odak modu kapatıldı.');
  });

  document.getElementById('openStatisticsButton')?.addEventListener('click', () => {
    profileReturnScrollTop = scrollArea.scrollTop;
    state.view = 'statistics';
    setNav('profile');
    render();
    scrollArea.scrollTop = 0;
  });
  document.getElementById('statisticsBackButton')?.addEventListener('click', () => {
    state.view = 'profile';
    setNav('profile');
    render();
    restoreProfilePosition();
  });

  document.getElementById('statisticsOverviewRangeButton')?.addEventListener('click', event => {
    event.stopPropagation();
    statisticsUi.openMenu = statisticsUi.openMenu === 'overview' ? null : 'overview';
    render();
  });

  document.getElementById('statisticsRangeButton')?.addEventListener('click', event => {
    event.stopPropagation();
    statisticsUi.openMenu = statisticsUi.openMenu === 'range' ? null : 'range';
    render();
  });

  document.getElementById('statisticsSubjectMetricButton')?.addEventListener('click', event => {
    event.stopPropagation();
    statisticsUi.openMenu = statisticsUi.openMenu === 'subject' ? null : 'subject';
    render();
  });

  app.querySelectorAll('[data-stats-option="overview"]').forEach(button => {
    button.addEventListener('click', event => {
      event.stopPropagation();
      const value = button.dataset.value || 'all';
      statisticsUi.overviewRange = ['today', 'week', 'month', 'all'].includes(value) ? value : 'all';
      statisticsUi.openMenu = null;
      render();
    });
  });

  app.querySelectorAll('[data-stats-option="range"]').forEach(button => {
    button.addEventListener('click', event => {
      event.stopPropagation();
      statisticsUi.range = button.dataset.value || 'week';
      statisticsUi.openMenu = null;
      render();
    });
  });

  app.querySelectorAll('[data-stats-option="subject"]').forEach(button => {
    button.addEventListener('click', event => {
      event.stopPropagation();
      statisticsUi.subjectMetric = button.dataset.value === 'wrong' ? 'wrong' : 'correct';
      statisticsUi.openMenu = null;
      render();
    });
  });


  document.getElementById('studyPreferencesButton')?.addEventListener('click', () => {
    profileReturnScrollTop = scrollArea.scrollTop;
    state.view = 'study-preferences';
    setNav('profile');
    render();
    scrollArea.scrollTop = 0;
  });
  document.getElementById('appearanceSettingsButton')?.addEventListener('click', () => {
    profileReturnScrollTop = scrollArea.scrollTop;
    state.view = 'appearance';
    setNav('profile');
    render();
    scrollArea.scrollTop = 0;
  });

  document.getElementById('dataAccountButton')?.addEventListener('click', () => {
    profileReturnScrollTop = scrollArea.scrollTop;
    accountConfirmAction = null;
    state.view = 'data-account';
    setNav('profile');
    render();
    scrollArea.scrollTop = 0;
  });

  document.getElementById('profileSignOutButton')?.addEventListener('click', async event => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      await flushProgressSync();
      await window.signOut();
    } catch (error) {
      console.error('Çıkış yapılamadı:', error);
      button.disabled = false;
      showToast('Çıkış yapılamadı. Lütfen tekrar dene.');
    }
  });

  document.getElementById('studyPrefsBackButton')?.addEventListener('click', () => {
    const returnTop = profileReturnScrollTop;
    state.view = 'profile';
    setNav('profile');
    render();
    requestAnimationFrame(() => {
      scrollArea.scrollTop = returnTop;
    });
  });
  app.querySelectorAll('[data-repeat-priority]').forEach(button => button.addEventListener('click', () => {
    setStudyRepeatPriority(button.dataset.repeatPriority);
    showToast(`Çalışma tercihin: ${getRepeatPriorityLabel()}`);
    const top = scrollArea.scrollTop;
    render();
    scrollArea.scrollTop = top;
  }));
  app.querySelectorAll('[data-pause-days]').forEach(button => button.addEventListener('click', () => {
    if (!setStudyPauseDays(button.dataset.pauseDays)) return;
    showToast('Çalışma planın duraklatıldı.');
    render();
  }));
  document.getElementById('studyPauseDateButton')?.addEventListener('click', () => {
    const input = document.getElementById('studyPauseDateInput');
    if (!input?.value) return showToast('Lütfen bir tarih seç.');
    if (!setStudyPauseUntil(new Date(`${input.value}T12:00:00`))) return showToast('Bugünden önce bir tarih seçemezsin.');
    showToast('Çalışma planın duraklatıldı.'); render();
  });
  document.getElementById('studyResumeButton')?.addEventListener('click', () => {
    resumeStudyPlan(); showToast('Çalışma planın yeniden aktif.'); render();
  });

  document.getElementById('appearanceBackButton')?.addEventListener('click', () => {
    state.view = 'profile';
    setNav('profile');
    render();
    restoreProfilePosition();
  });

  app.querySelectorAll('[data-text-size]').forEach(button => {
    button.addEventListener('click', () => {
      uiPrefs.textSize = button.dataset.textSize || 'standard';
      saveUiPrefs();
      render();
    });
  });

  app.querySelectorAll('[data-ui-density]').forEach(button => {
    button.addEventListener('click', () => {
      uiPrefs.density = button.dataset.uiDensity || 'standard';
      saveUiPrefs();
      render();
    });
  });

  document.getElementById('dataAccountBackButton')?.addEventListener('click', () => {
    accountConfirmAction = null;
    state.view = 'profile';
    setNav('profile');
    render();
    restoreProfilePosition();
  });

  document.getElementById('accountResetProgressButton')?.addEventListener('click', () => {
    accountConfirmAction = 'reset';
    render();
  });

  document.getElementById('accountDeleteButton')?.addEventListener('click', () => {
    accountConfirmAction = 'delete';
    render();
    setTimeout(() => document.getElementById('accountDeleteConfirmInput')?.focus({ preventScroll: true }), 60);
  });

  document.getElementById('accountConfirmCancelButton')?.addEventListener('click', () => {
    accountConfirmAction = null;
    window.NativeUX?.hideKeyboard?.();
    render();
  });

  document.getElementById('accountConfirmOverlay')?.addEventListener('click', event => {
    if (event.target?.id !== 'accountConfirmOverlay') return;
    accountConfirmAction = null;
    window.NativeUX?.hideKeyboard?.();
    render();
  });

  document.getElementById('accountResetConfirmButton')?.addEventListener('click', async event => {
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = 'Temizleniyor…';
    accountConfirmAction = null;
    await resetProgress({ skipConfirm: true });
    state.view = 'data-account';
    setNav('profile');
    render();
    scrollArea.scrollTop = 0;
  });

  const deleteConfirmInput = document.getElementById('accountDeleteConfirmInput');
  const deleteConfirmButton = document.getElementById('accountDeleteConfirmButton');
  deleteConfirmInput?.addEventListener('input', () => {
    const confirmed = deleteConfirmInput.value.trim().toLocaleUpperCase('tr-TR') === 'SİL';
    if (deleteConfirmButton) deleteConfirmButton.disabled = !confirmed;
  });

  deleteConfirmButton?.addEventListener('click', async () => {
    const errorEl = document.getElementById('accountDeleteError');
    if (deleteConfirmInput?.value.trim().toLocaleUpperCase('tr-TR') !== 'SİL') return;
    deleteConfirmButton.disabled = true;
    deleteConfirmButton.textContent = 'Siliniyor…';
    if (errorEl) errorEl.textContent = '';

    try {
      await flushProgressSync();
      const { data, error } = await supabaseClient.functions.invoke('delete-account', {
        body: { confirmation: 'delete-own-account' }
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || 'Hesap silinemedi.');

      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(PROGRESS_DEVICE_ID_STORAGE_KEY);
      try { await supabaseClient.auth.signOut({ scope: 'local' }); } catch (_) {}
      window.currentUser = null;
      window.location.replace('login.html');
    } catch (error) {
      console.error('Hesap silinemedi:', error);
      if (errorEl) errorEl.textContent = error?.message || 'Hesap silinemedi. Lütfen tekrar dene.';
      deleteConfirmButton.disabled = false;
      deleteConfirmButton.textContent = 'Hesabımı sil';
    }
  });

  document.getElementById('openAchievementsButton')?.addEventListener('click', () => {
    profileReturnScrollTop = scrollArea.scrollTop;
    state.view = 'achievements';
    setNav('profile');
    render();
    scrollArea.scrollTop = 0;
  });
  document.getElementById('achievementsBackButton')?.addEventListener('click', () => {
    state.view = 'profile';
    setNav('profile');
    render();
    restoreProfilePosition();
  });

  document.getElementById('profileEditBackButton')?.addEventListener('click', () => {
    window.NativeUX?.setKeyboardScrollDisabled?.(false);
    window.NativeUX?.hideKeyboard?.();
    state.view = 'profile'; setNav('profile'); render(); restoreProfilePosition();
  });
  const profileEditInputs = [...app.querySelectorAll('.profile-edit-page .sp-text-input')];
  profileEditInputs.forEach(input => {
    input.addEventListener('pointerdown', event => {
      // Kullanıcının mevcut kaydırma konumunu kilitle. iOS, farklı input'a
      // odaklanırken WKWebView'i kendi kendine yukarı/aşağı taşımaya çalışabiliyor.
      const topBeforeFocus = scrollArea.scrollTop;
      profileEditFocusScrollTop = topBeforeFocus;

      if (document.activeElement !== input) {
        // Native scroll'u yalnız focus/keyboard animasyonu boyunca geçici kapat.
        // Sonrasında kullanıcı yine elle kaydırabilir.
        window.NativeUX?.freezeKeyboardScroll?.(520);

        // Tarayıcının varsayılan "focused element'i görünür yap" kaydırmasını
        // engelle; focus kullanıcı gesture'ı içinde verildiği için klavye açılır.
        event.preventDefault();
        try {
          input.focus({ preventScroll: true });
        } catch (_) {
          input.focus();
        }

        // iOS sürümüne göre otomatik pan farklı anda gelebiliyor. Aynı konumu
        // birkaç frame boyunca geri yazarak hiçbir görünür zıplamaya izin verme.
        const restore = () => restoreProfileEditScrollPosition(topBeforeFocus);
        restore();
        requestAnimationFrame(restore);
        setTimeout(restore, 50);
        setTimeout(restore, 140);
        setTimeout(restore, 280);
        setTimeout(restore, 500);
      }
    }, { passive: false });

    input.addEventListener('focus', () => {
      const top = Number.isFinite(profileEditFocusScrollTop)
        ? profileEditFocusScrollTop
        : scrollArea.scrollTop;
      requestAnimationFrame(() => restoreProfileEditScrollPosition(top));
      setTimeout(() => restoreProfileEditScrollPosition(top), 80);
      setTimeout(() => restoreProfileEditScrollPosition(top), 220);
    });

    input.addEventListener('blur', () => {
      profileEditFocusScrollTop = null;
    });
  });

  document.getElementById('profileEditSaveButton')?.addEventListener('click', async () => {
    const firstName = document.getElementById('profileFirstNameInput')?.value.trim() || '';
    const lastName = document.getElementById('profileLastNameInput')?.value.trim() || '';
    const password = document.getElementById('profileNewPasswordInput')?.value || '';
    const passwordConfirm = document.getElementById('profileNewPasswordConfirmInput')?.value || '';
    const errorEl = document.getElementById('profileEditError');
    const saveButton = document.getElementById('profileEditSaveButton');
    if (errorEl) errorEl.textContent = '';

    if (firstName.length < 2 || lastName.length < 2) {
      if (errorEl) errorEl.textContent = 'Ad ve soyad alanlarını doldur.';
      return;
    }
    if (password && password.length < 8) {
      if (errorEl) errorEl.textContent = 'Yeni şifre en az 8 karakter olmalı.';
      return;
    }
    if (password !== passwordConfirm) {
      if (errorEl) errorEl.textContent = 'Yeni şifreler eşleşmiyor.';
      return;
    }

    const fullName = `${firstName} ${lastName}`.replace(/\s+/g, ' ').trim();
    saveButton.disabled = true;
    saveButton.textContent = 'Kaydediliyor…';
    try {
      const existingMetadata = window.currentUser?.user_metadata || {};
      const { data: nameData, error: nameError } = await supabaseClient.auth.updateUser({
        data: { ...existingMetadata, full_name: fullName }
      });
      if (nameError) throw nameError;
      if (nameData?.user) window.currentUser = nameData.user;

      if (password) {
        const { data: passwordData, error: passwordError } = await supabaseClient.auth.updateUser({ password });
        if (passwordError) throw passwordError;
        if (passwordData?.user) window.currentUser = passwordData.user;
      }

      showToast(password ? 'Profilin ve şifren güncellendi.' : 'Profilin güncellendi.');
      window.NativeUX?.setKeyboardScrollDisabled?.(false);
      window.NativeUX?.hideKeyboard?.();
      state.view = 'profile';
      setNav('profile');
      render();
      scrollArea.scrollTop = 0;
    } catch (error) {
      console.error('Profil güncellenemedi:', error);
      if (errorEl) errorEl.textContent = error?.message || 'Profil güncellenemedi.';
      saveButton.disabled = false;
      saveButton.textContent = 'Değişiklikleri kaydet';
    }
  });

  document.getElementById('goalSettingsBackButton')?.addEventListener('click', () => {
    state.view = 'profile'; setNav('profile'); render(); restoreProfilePosition();
  });
  const customGoalInput = document.getElementById('customDailyGoalInput');
  const clampCustomGoal = value => Math.max(DAILY_GOAL_MIN, Math.min(DAILY_GOAL_MAX, Math.round(Number(value) || DEFAULT_DAILY_GOAL)));
  app.querySelectorAll('[data-custom-goal]').forEach(button => {
    button.addEventListener('click', () => {
      if (customGoalInput) customGoalInput.value = button.dataset.customGoal;
      app.querySelectorAll('[data-custom-goal]').forEach(item => item.classList.toggle('active', item === button));
    });
  });
  document.getElementById('goalMinusButton')?.addEventListener('click', () => {
    if (customGoalInput) customGoalInput.value = clampCustomGoal(Number(customGoalInput.value) - 5);
  });
  document.getElementById('goalPlusButton')?.addEventListener('click', () => {
    if (customGoalInput) customGoalInput.value = clampCustomGoal(Number(customGoalInput.value) + 5);
  });
  document.getElementById('goalSettingsSaveButton')?.addEventListener('click', () => {
    const input = document.getElementById('customDailyGoalInput');
    const errorEl = document.getElementById('goalSettingsError');
    const value = Number(input?.value);
    if (!Number.isFinite(value) || value < DAILY_GOAL_MIN || value > DAILY_GOAL_MAX) {
      if (errorEl) errorEl.textContent = `Hedef ${DAILY_GOAL_MIN}-${DAILY_GOAL_MAX} arasında olmalı.`;
      return;
    }
    if (setDailyGoal(value)) {
      state.view = 'profile';
      setNav('profile');
      render();
      scrollArea.scrollTop = 0;
    }
  });

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

async function resetProgress(options = {}) {
  const skipConfirm = options?.skipConfirm === true;
  // O-10 (2026-09-15): Sıfırlama artık bir "dönem" (resetAt) başlatır.
  // Birleştirmede bu tarihten önceki çalışma verisi (sayaçlar, yanlışlar,
  // işaretler, testler) başka cihazlardan veya buluttan geri gelmez.
  // Kart (Leitner) ilerlemesi de sunucudan silinir. Kadro, günlük hedef ve
  // bildirim tercihleri korunur.
  if (!skipConfirm && !window.confirm('Tüm çalışma ilerlemen (bu cihazda ve hesabında; kart tekrarları dahil) sıfırlansın mı? Bu işlem geri alınamaz.')) return;
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
  if (isStudyPaused()) {
    showToast(`Çalışma planın ${formatStudyPauseDate().toLocaleLowerCase('tr-TR')}.`);
    return;
  }
  routeSettings.mode = getRepeatPriorityMode();
  document.querySelectorAll('#modeGrid .mode-option').forEach(button => {
    button.classList.toggle('selected', button.dataset.mode === routeSettings.mode);
  });
  if (summaryMode) summaryMode.textContent = routeSettings.mode;
  updateRouteSummary();
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
  const timed = routeSettings.time === 'Süreli';

  if (routeDurationFilter) routeDurationFilter.hidden = !timed;
  if (routeDurationValue) routeDurationValue.textContent = `${routeSettings.durationMinutes} dakika`;

  if (!timed) {
    summaryDuration.textContent = 'Süresiz';
    if (routeDurationMenu) routeDurationMenu.hidden = true;
    routeDurationButton?.setAttribute('aria-expanded', 'false');
  } else {
    summaryDuration.textContent = `${routeSettings.durationMinutes} dakika`;
  }

  document.querySelectorAll('[data-route-duration]').forEach(button => {
    button.classList.toggle('selected', Number(button.dataset.routeDuration) === routeSettings.durationMinutes);
  });
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
      if (!routeSettings.durationCustomized) {
        routeSettings.durationMinutes = routeSettings.questions;
      }
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

  routeDurationButton?.addEventListener('click', () => {
    if (routeSettings.time !== 'Süreli' || !routeDurationMenu) return;
    const willOpen = routeDurationMenu.hidden;
    routeDurationMenu.hidden = !willOpen;
    routeDurationButton.setAttribute('aria-expanded', String(willOpen));
  });

  document.querySelectorAll('[data-route-duration]').forEach(button => {
    button.addEventListener('click', () => {
      routeSettings.durationMinutes = Number(button.dataset.routeDuration) || routeSettings.questions;
      routeSettings.durationCustomized = true;
      routeDurationMenu.hidden = true;
      routeDurationButton?.setAttribute('aria-expanded', 'false');
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

// PERF: index artık her tuş vuruşunda değil, katalog referansı değiştiğinde
// (yani yeni veri geldiğinde) yeniden kuruluyor ve önbelleğe alınıyor.
// Karşılaştırma anahtarı (searchKey) da burada bir kez hesaplanıp saklanıyor,
// böylece runSearch() her seferinde toLocaleLowerCase() tekrarlamıyor.
let searchIndexCache = null;
let searchIndexCacheCatalogue = null;

function collectSearchIndex() {
  if (searchIndexCache && searchIndexCacheCatalogue === state.catalogue) return searchIndexCache;
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
  index.forEach(entry => { entry.searchKey = entry.title.toLocaleLowerCase('tr-TR'); });
  searchIndexCache = index;
  searchIndexCacheCatalogue = state.catalogue;
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
  const results = collectSearchIndex().filter(entry => entry.searchKey.includes(needle)).slice(0, 30);
  searchResultsList.innerHTML = results.length ? results.map((result, index) => `
    <article class="topic-item" data-search-index="${index}" role="button" tabindex="0">
      <div class="topic-number">${svg(result.icon)}</div>
      <div class="topic-copy"><h4>${escapeHtml(result.title)}</h4><p>${escapeHtml(result.context || result.categoryTitle)}</p></div>
      <div class="topic-arrow">${svg('arrow')}</div>
    </article>`).join('') : '<div class="empty-inline">Sonuç bulunamadı.</div>';
  searchResultsList.querySelectorAll('[data-search-index]').forEach(element => {
    const open = () => openSearchResult(results[Number(element.dataset.searchIndex)]);
    element.addEventListener('click', open);
    element.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); } });
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

document.addEventListener('pointerdown', event => {
  const focused = document.activeElement;
  if (!focused?.matches('input, textarea, [contenteditable="true"]')) return;
  if (event.target.closest('input, textarea, select, [contenteditable="true"], label, button, a, [role="button"]')) return;
  focused.blur();
  window.NativeUX?.hideKeyboard?.();
}, {passive:true});
openSearchButton?.addEventListener('click', openSearchSheet);
closeSearchSheetButton?.addEventListener('click', closeSearchSheet);
// PERF: her tuş vuruşunda değil, yazma durduktan ~200ms sonra arıyoruz.
let searchDebounceTimer = null;
const SEARCH_DEBOUNCE_MS = 200;
searchInput?.addEventListener('input', () => {
  clearTimeout(searchDebounceTimer);
  const value = searchInput.value;
  searchDebounceTimer = setTimeout(() => runSearch(value), SEARCH_DEBOUNCE_MS);
});

// Keep the actual DOM (including handlers and input state) for back navigation.
const topicViewCache = new Map();
let currentTopicView = null;
let topicViewScope = '';
let topicViewDepth = 0;
const topicHeaderIds = ['topicSheetTitle','topicSheetSubtitle','topicEyebrow','topicHeadingIcon','topicProgressPercent','topicProgressBar','topicProgressCount'];
function resetTopicViewCache() {
  topicViewCache.clear(); currentTopicView=null; topicViewDepth=0;
  topicViewScope=studySessionScope();
}
function captureTopicView() {
  const view=currentTopicView;
  if(!view?.ready || !view.nodes?.every(node=>node.parentNode===topicList))return;
  view.nodes=Array.from(topicList.childNodes);
  view.breadcrumb=Array.from(topicBreadcrumbWrap.childNodes);
  view.classes=topicSheet.className; view.tone=topicSheet.dataset.categoryTone;
  view.header=topicHeaderIds.map(id=>{const el=document.getElementById(id);return {id,html:el.innerHTML,style:el.style.cssText,classes:el.className};});
  view.scroll=[topicList,...topicList.querySelectorAll('*')].filter(el=>el===topicList||el.scrollTop||el.scrollLeft).map(el=>({el,top:el.scrollTop,left:el.scrollLeft}));
  topicViewCache.set(view.key,view);
  // Retain only a bounded set of recent screens in memory.
  while(topicViewCache.size>12)topicViewCache.delete(topicViewCache.keys().next().value);
}
function suspendTopicView() { captureTopicView();currentTopicView=null;topicViewDepth=3; }
function animateTopicContent(back) {
  if(!topicSheet.classList.contains('open') || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)return;
  topicList.getAnimations?.().forEach(animation=>animation.cancel());
  topicList.animate?.([{transform:`translateX(${back?-20:20}px)`,opacity:.85},{transform:'translateX(0)',opacity:1}],{duration:180,easing:'cubic-bezier(.2,.7,.2,1)'});
}
function navigateTopicView(kind,item,categoryKey,renderFresh,filter=null) {
  if(topicViewScope!==studySessionScope())resetTopicViewCache();
  const key=JSON.stringify([kind,categoryKey,item?.id||'']);
  const depth=kind==='category'?0:kind==='hub'?1:2;
  const back=depth<topicViewDepth;
  captureTopicView();
  state.activeCategoryKey=categoryKey;state.activeDocument=item||null;
  const cached=topicViewCache.get(key);
  topicViewDepth=depth;
  if(cached){
    currentTopicView=cached;
    topicSheet.className=cached.classes;
    // Cached content views must not inherit the full-bleed quiz shell.
    topicSheet.classList.remove('quiz-active','card-study-active');
    if(cached.tone)topicSheet.dataset.categoryTone=cached.tone;else delete topicSheet.dataset.categoryTone;
    cached.header.forEach(saved=>{const el=document.getElementById(saved.id);el.innerHTML=saved.html;el.style.cssText=saved.style;el.className=saved.classes;});
    topicBreadcrumbWrap.replaceChildren(...cached.breadcrumb);
    topicList.replaceChildren(...cached.nodes);
    topicList.firstElementChild?.refreshTopicView?.(filter);
    cached.scroll.forEach(({el,top,left})=>{el.scrollTop=top;el.scrollLeft=left;});
    animateTopicContent(back);
    return;
  }
  const view={key,ready:false};currentTopicView=view;
  const finish=()=>{
    if(currentTopicView!==view)return;
    view.ready=true;view.nodes=Array.from(topicList.childNodes);
    topicList.scrollTop=0;captureTopicView();animateTopicContent(back);
  };
  if(kind!=='sections')topicSheet.classList.remove('section-selection');
  const result=renderFresh();
  if(result?.then)return result.then(finish);
  finish();
}
function renderCategoryLevel(categoryKey) {
  return navigateTopicView('category',null,categoryKey,()=>renderCategoryLevelFresh(categoryKey));
}
function renderStudyModeHub(item,categoryKey,initialFilter=null) {
  if(!pauseStudyAttempts(true))return;
  return navigateTopicView('hub',item,categoryKey,()=>renderStudyModeHubFresh(item,categoryKey,initialFilter||'all'),initialFilter);
}
function renderSections(item,categoryKey) {
  return navigateTopicView('sections',item,categoryKey,()=>renderSectionsFresh(item,categoryKey));
}
function renderSummary(item,categoryKey) {
  return navigateTopicView('summary',item,categoryKey,()=>renderSummaryFresh(item,categoryKey));
}

function resetSheetClasses() {
  topicSheet.classList.remove('document-flow', 'quiz-active', 'card-study-active', 'category-glass', 'section-selection');
  delete topicSheet.dataset.categoryTone;
}

function openTopicSheet(categoryKey) {
  const category = getCategory(categoryKey);
  if (!category) return showToast('Kategori bulunamadı.');
  clearInterval(timerInterval);
  timerInterval = null;
  closeAllSheets(topicSheet);
  state.activeCategoryKey = categoryKey;
  state.activeDocument = null;
  resetTopicViewCache();
  state.navStack = [{ kind: 'category', categoryKey }];
  topicSheet.classList.add('open');
  topicSheet.setAttribute('aria-hidden', 'false');
  topicBackdrop.classList.add('open');
  renderCategoryLevel(categoryKey);
}

function closeTopicSheet() {
  if(state.quiz?.studyFinishing){showToast('Sonuç hazırlanıyor, lütfen bekle.');return;}
  if(!pauseStudyAttempts(true))return;
  suspendTopicView();
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

function applyCategoryProgressTone(categoryKey) {
  const tone = ({
    'general-legislation': 'navy',
    'general-culture': 'blue',
    'meb-legislation': 'red'
  })[categoryKey] || 'navy';
  topicSheet.dataset.categoryTone = tone;
}

function setSheetProgress(label, percentage, completedLabel = 'tamamlandı', completedCount = null, totalCount = null) {
  topicProgressPercent.textContent = `%${percentage || 0}`;
  topicProgressBar.style.width = `${percentage}%`;
  if (completedCount !== null && totalCount !== null) {
    topicProgressCount.textContent = `${completedCount} / ${totalCount} soru ${completedLabel}`;
  } else {
    topicProgressCount.textContent = percentage ? `%${percentage} ${completedLabel}` : label;
  }
}

function renderCategoryLevelFresh(categoryKey) {
  const category = getCategory(categoryKey);
  if (!category) return;
  resetSheetClasses();
  applyCategoryProgressTone(categoryKey);
  topicSheet.classList.add('category-glass');
  const meta = categoryCardMeta(categoryKey);
  applySheetHeader({ title: category.title, subtitle: categoryKey === 'general-culture' ? String(category.subtitle || '').replace(/Coğrafya\s*,?\s*/gi, '').replace(/,\s*,/g, ',') : category.subtitle, eyebrow: 'KONU KATEGORİSİ', icon: meta.icon, iconClass: meta.iconClass });
  topicBreadcrumbWrap.innerHTML = '';
  const categoryCompletion = getCategoryCompletion(categoryKey);
  const progressPercent = categoryCompletion.percentage;
  const totalQuestions = categoryCompletion.total;
  const completedQuestions = categoryCompletion.completed;
  setSheetProgress('Henüz çalışılmadı', progressPercent, 'tamamlandı', totalQuestions ? completedQuestions : null, totalQuestions ? totalQuestions : null);
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
    element.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); } });
  });
  topicSheet.scrollTop = 0;
  const categoryRows=Array.from(topicList.querySelectorAll('[data-topic-index]'));
  const refreshCategory=()=>{
    categoryRows.forEach((row,index)=>{row.querySelector('.topic-copy p').textContent=statLine(items[index]);row.classList.toggle('completed',items[index].type==='document'&&getDocumentProgress(items[index])===100);});
    if(categoryRows[0]?.parentNode===topicList){const value=getCategoryCompletion(categoryKey);setSheetProgress('Henüz çalışılmadı',value.percentage,'tamamlandı',value.total?value.completed:null,value.total?value.total:null);}
  };
  if(topicList.firstElementChild)topicList.firstElementChild.refreshTopicView=refreshCategory;
  refreshVisibleQuestionCounts(items,refreshCategory);
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


// Four-mode study hub — artwork embedded so no separate image folder is needed.
const STUDY_HUB_ART = {"sections":"data:image/webp;base64,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","random":"data:image/webp;base64,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","truefalse":"data:image/webp;base64,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","summary":"data:image/webp;base64,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"};

// One durable record per practice attempt. Account/role/reset scoped; no server sync.
function studySessionScope() {
  return ['sinavrotasi-attempt-v2', progress.userId || 'guest', progress.selectedRole || '', progress.resetAt || '0'].map(encodeURIComponent).join(':') + ':';
}
function studySessionId() { return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36)+'-'+Math.random().toString(36).slice(2); }
function readStudySession(id) {
  try { const value=JSON.parse(localStorage.getItem(studySessionScope()+id)||'null');return value?.version===2 && value.id===id ? value : null; } catch (_) { return null; }
}
function studySessionsFor(item) {
  const records=[]; const prefix=studySessionScope();
  try { for(let i=0;i<localStorage.length;i++){const key=localStorage.key(i);if(!key?.startsWith(prefix))continue;const entry=readStudySession(key.slice(prefix.length));if(entry?.documentId===item.id)records.push(entry);} } catch (_) {}
  // Existing finished tests remain visible; a practice visit alone is not history.
  for(const test of progress.completedTests||[]){
    if(test.documentId!==item.id || !['section','random'].includes(test.kind))continue;
    const total=Number(test.total)||0,answered=Number(test.answered)||0,correct=Number(test.score)||0;
    const existing=records.find(entry=>entry.id===test.id);
    const summary={version:2,id:test.id,documentId:item.id,type:test.kind,title:test.kind==='section'?test.title:'Rastgele Test',status:'completed',
      total,answered,correct,wrong:Math.max(0,answered-correct),blank:Math.max(0,total-answered),completedAt:test.completedAt,updatedAt:test.completedAt};
    if(existing){if(existing.status!=='completed')Object.assign(existing,summary);}else records.push(summary);
  }
  return records.sort((a,b)=>(b.updatedAt||'').localeCompare(a.updatedAt||''));
}
function writeStudySession(entry, scope) {
  if(scope!==studySessionScope())return false;
  try {
    const old=readStudySession(entry.id);
    if(old?.status==='completed')return true; // Finished attempts never become pending again.
    localStorage.setItem(scope+entry.id,JSON.stringify(entry));
    return true;
  } catch (_) {
    if(!state.studySaveWarning){state.studySaveWarning=true;showToast('Çalışma kaydedilemedi. Cihaz depolama alanını kontrol et; çıkarsan ilerleme kaybolabilir.');}
    return false;
  }
}
function isSavedPractice(quiz) { return Boolean(quiz?.documentItem?.id && ['section','random'].includes(quiz.kind)); }
function studyAttemptMeta(session, type) {
  if(!session.studySessionId){session.studySessionId=studySessionId();session.studyScope=studySessionScope();session.studyStartedAt=new Date().toISOString();}
  return {version:2,id:session.studySessionId,documentId:session.documentItem.id,categoryKey:session.categoryKey||session.questions[0]?.categoryKey||state.activeCategoryKey,
    type,title:type==='section'?(session.section?.title||session.title):type==='random'?'Rastgele Test':'Doğru / Yanlış Serisi',
    sectionId:session.section?.id||null,startedAt:session.studyStartedAt,updatedAt:new Date().toISOString(),total:session.questions.length};
}
function saveQuizAttempt(quiz=state.quiz, completed=false) {
  if(!isSavedPractice(quiz) || quiz.studyReview)return true;
  const entry=studyAttemptMeta(quiz,quiz.kind);
  if(quiz.studyScope!==studySessionScope())return false;
  completed=completed||Boolean(quiz.completionRecorded);
  if(!completed && readStudySession(entry.id)?.status==='completed')return true;
  entry.answered=quiz.questions.filter(q=>q.userSelected!==null&&q.userSelected!==undefined).length;
  entry.status=completed?'completed':'started';entry.index=quiz.index;
  if(completed){entry.completedAt=entry.updatedAt;entry.correct=quizScore(quiz);entry.wrong=entry.answered-entry.correct;entry.blank=entry.total-entry.answered;}
  else entry.snapshot={questions:quiz.questions,section:quiz.section?{id:quiz.section.id,title:quiz.section.title,articleRange:quiz.section.articleRange,generated:quiz.section.generated}:null,
    kind:quiz.kind,sessionId:quiz.sessionId,title:quiz.title,subtitle:quiz.subtitle,isTimed:quiz.isTimed,timeLeft:quiz.timeLeft,index:quiz.index,revealed:quiz.revealed,completionRecorded:false};
  return writeStudySession(entry,quiz.studyScope);
}
function saveTfAttempt(tf=state.tfQuiz, completed=false) {
  if(!tf?.documentItem?.id || !tf.questions?.length)return true;
  const entry=studyAttemptMeta(tf,'truefalse');
  entry.answered=tf.answers.filter(Boolean).length;entry.index=tf.index;
  const done=completed||entry.answered===entry.total;
  entry.status=done?'completed':'started';
  if(done){entry.completedAt=entry.updatedAt;entry.correct=tf.score;entry.wrong=entry.answered-tf.score;entry.blank=entry.total-entry.answered;}
  else entry.snapshot={questions:tf.questions,answers:tf.answers,score:tf.score,index:tf.index};
  return writeStudySession(entry,tf.studyScope);
}
function checkpointStudyAttempt(){const quizSaved=saveQuizAttempt();const tfSaved=saveTfAttempt();return quizSaved&&tfSaved;}
function pauseStudyAttempts(clear=false) {
  // Drop another account/role's in-memory view without rewriting its stored record.
  const scope=studySessionScope();
  if(state.quiz?.studyScope && state.quiz.studyScope!==scope){clearInterval(timerInterval);timerInterval=null;state.quiz=null;}
  if(state.tfQuiz?.studyScope && state.tfQuiz.studyScope!==scope)state.tfQuiz=null;
  const saved=checkpointStudyAttempt();
  if(clear&&!saved)return false;
  if(isSavedPractice(state.quiz)){clearInterval(timerInterval);timerInterval=null;state.quiz.backgroundedAt=null;if(clear)state.quiz=null;}
  if(clear)state.tfQuiz=null;
  return saved;
}
function studyAttemptLabel(entry){return entry.type==='section'?'Bölüm testi':entry.type==='random'?'Rastgele test':'Doğru / yanlış';}
function studyAttemptCards(entries) {
  return entries.map(entry=>{
    const date=new Date(entry.completedAt||entry.updatedAt).toLocaleString('tr-TR',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'});
    const done=entry.status==='completed';const total=Number(entry.total)||0,answered=Number(entry.answered)||0;
    const ratio=total?Math.min(100,Math.round(answered/total*100)):0;
    return `<article class="study-attempt-card ${done?'is-complete':''}"><div class="study-attempt-heading"><span>${studyAttemptLabel(entry)}</span><time>${escapeHtml(date)}</time></div><h4>${escapeHtml(entry.title)}</h4>
      ${done?`<div class="study-attempt-results"><span><b>${Number(entry.correct)||0}</b> Doğru</span><span><b>${Number(entry.wrong)||0}</b> Yanlış</span><span><b>${Number(entry.blank)||0}</b> Boş</span></div><p>${total} soruluk çalışma tamamlandı.</p>`:
      `<p>${answered} / ${total} soru cevaplandı · ${Math.min((Number(entry.index)||0)+1,total)}. sorudasın</p><div class="study-attempt-track"><span style="width:${ratio}%"></span></div><button type="button" data-resume-study="${escapeHtml(entry.id)}">Kaldığın yerden devam et <span aria-hidden="true">›</span></button>`}</article>`;
  }).join('');
}
function resumeStudyAttempt(id,item,categoryKey,returnView=null) {
  const entry=readStudySession(id);
  if(!entry || entry.documentId!==item.id || entry.categoryKey!==categoryKey || entry.status!=='started' || !entry.snapshot?.questions?.length){showToast('Bu çalışma artık devam edilebilir durumda değil.');return;}
  if(['section','truefalse'].includes(entry.type)&&!requirePremiumOrWarn())return;
  if(entry.type==='section'){
    const allowed=(items)=>items.some(section=>(!section.kadrolar||!progress.selectedRole||section.kadrolar.includes(progress.selectedRole))&&(section.id===entry.sectionId||allowed(section.children||[])));
    if(!(entry.snapshot.section?.generated && !(item.children||[]).length && entry.sectionId?.startsWith(item.id+':practice:')) && !allowed(item.children||[])){showToast('Bu bölüm seçili kadron için kullanılamıyor.');return;}
  }
  if(!pauseStudyAttempts(true))return;
  suspendTopicView();
  const snapshot=entry.snapshot;
  const session={...snapshot,documentItem:item,categoryKey,studySessionId:entry.id,studyScope:studySessionScope(),studyStartedAt:entry.startedAt,
    returnView:returnView || (()=>renderStudyModeHub(item,categoryKey,'started'))};
  session.index=Math.max(0,Math.min(Number(session.index)||0,session.questions.length-1));
  topicSheet.classList.add('open','quiz-active');topicSheet.classList.remove('document-flow','category-glass','card-study-active');
  topicSheet.setAttribute('aria-hidden','false');topicBackdrop.classList.add('open');
  if(entry.type==='truefalse'){state.tfQuiz=session;renderTrueFalse();}
  else {
    // Reuse this exact server session and question order; never request another random test.
    session.sourceQuestions=session.questions.map(({userSelected,answerRecorded,...question})=>question);
    session.backgroundedAt=null;state.quiz=session;renderQuiz();
    if(session.isTimed&&session.timeLeft<=0)finishQuizAfterTimeout();
  }
}
function suspendPracticeClock(){pauseStudyAttempts(false);}
document.addEventListener('visibilitychange',()=>{
  if(document.visibilityState==='hidden')suspendPracticeClock();
  else if(isSavedPractice(state.quiz)&&!state.quiz.completionRecorded&&topicSheet.classList.contains('quiz-active')&&state.quiz.timeLeft>0)startQuizTimer();
});
window.addEventListener('pagehide',suspendPracticeClock);
document.addEventListener('nativeux:pause',suspendPracticeClock);
document.addEventListener('nativeux:resume',()=>{if(isSavedPractice(state.quiz)&&!state.quiz.completionRecorded&&topicSheet.classList.contains('quiz-active')&&state.quiz.timeLeft>0)startQuizTimer();});

function renderDocumentHub(documentItem, categoryKey) {
  renderStudyModeHub(documentItem, categoryKey);
}
function renderTopicPlan(item, categoryKey) {
  renderStudyModeHub(item, categoryKey);
}
function renderStudyModeHubFresh(item, categoryKey, initialFilter = 'all') {
  if(!pauseStudyAttempts(true))return;
  state.activeDocument = item;
  state.activeCategoryKey = categoryKey;
  topicSheet.classList.remove('category-glass', 'quiz-active', 'card-study-active');
  topicSheet.classList.add('document-flow');
  applySheetHeader({ title:item.title, subtitle:statLine(item), eyebrow:'', icon:categoryCardMeta(categoryKey).icon, iconClass:categoryCardMeta(categoryKey).iconClass });
  renderBreadcrumb(getCategory(categoryKey).title, () => renderCategoryLevel(categoryKey));
  const percentage = Math.min(100, Math.max(0, Number(getDocumentProgress(item)) || 0));
  setSheetProgress('Henüz çalışılmadı', percentage);
  const count = Number.isFinite(Number(item.questionCount)) && item.questionCount !== null ? Math.max(0, Number(item.questionCount)) : null;
  const countText = count === null ? '—' : String(count);
  const hasQuestions = Boolean(item.questionFile || Number(item.questionCount) > 0);
  const role = progress.selectedRole;
  const hasSections = Boolean((item.children || []).some(section => !role || !section.kadrolar || section.kadrolar.includes(role)));
  const modes = [
    { id:'sections', title:'Madde Madde Çalış', description:'Bölüm seç, çalışmaya başla.', enabled:hasSections || (!(item.children || []).length && hasQuestions), count:countText },
    { id:'random', title:'Rastgele 20 Soru', description:'Konunun tamamından 20 soru.', enabled:hasQuestions, count:count === null ? '20' : String(Math.min(20,count)) },
    { id:'truefalse', title:'Doğru / Yanlış', description:'20 kartla bilgini pekiştir.', enabled:hasQuestions, count:'20’ye kadar' },
    { id:'summary', title:'Özet ve Kritik Noktalar', description:'Hazırlanıyor', enabled:true, count:countText }
  ];
  let attempts = studySessionsFor(item);
  const started = attempts.filter(entry => entry.status === 'started').length;
  const completed = attempts.filter(entry => entry.status === 'completed').length;
  topicList.innerHTML = `<div class="study-mode-hub">
    <header class="study-hub-header">
      <button type="button" class="study-hub-book" aria-label="Ana konuya geri dön" title="Ana konuya geri dön">${svg('back')}<span>Geri</span></button>
      <div class="study-hub-heading"><h3>${escapeHtml(item.title)}</h3><p>${countText} soru <span>•</span> %${percentage} ilerleme</p>
      <div class="study-hub-progress"><div class="study-hub-track" role="progressbar" aria-label="Konu ilerlemesi" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percentage}"><span style="width:${percentage}%"></span></div><strong>%${percentage}</strong></div></div>
    </header>
    <div class="study-hub-tabs" role="group" aria-label="Çalışma durumuna göre filtrele">
      <button type="button" data-hub-filter="all" aria-pressed="true">Tümü (4)</button>
      <button type="button" data-hub-filter="started" aria-pressed="false">Devam Eden (${started})</button>
      <button type="button" data-hub-filter="completed" aria-pressed="false">Tamamlanan (${completed})</button>
    </div>
    <div class="study-hub-grid">${modes.map(mode => `<button type="button" class="study-hub-card${mode.enabled ? '' : ' is-unavailable'}" data-document-mode="${mode.id}" ${mode.enabled ? '' : 'disabled'}>
      <img class="study-hub-art" src="${STUDY_HUB_ART[mode.id]}" alt="" width="334" height="252" decoding="async" draggable="false">
      <span class="study-hub-card-title">${mode.title}</span><span class="study-hub-card-description">${mode.description}</span>
      <span class="study-hub-card-footer"><span><b>${mode.count}</b> soru</span><span class="study-hub-arrow" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m9 5 7 7-7 7"/></svg></span></span>
      ${mode.enabled ? '' : '<span class="study-hub-unavailable">İçerik hazırlanıyor</span>'}
    </button>`).join('')}</div>
    <div class="study-attempt-list" hidden></div>
    <p class="study-hub-empty" role="status" hidden>Bu filtreye uygun çalışma modu bulunamadı.</p>
  </div>`;
  const hub = topicList.querySelector('.study-mode-hub');
  let selectedFilter = initialFilter;
  const filterCards = () => {
    const all=selectedFilter==='all';
    const grid=hub.querySelector('.study-hub-grid');
    grid.hidden=!all;
    const list=hub.querySelector('.study-attempt-list');
    list.hidden=all;
    hub.querySelectorAll('[data-hub-filter]').forEach(tab=>tab.setAttribute('aria-pressed',String(tab.dataset.hubFilter===selectedFilter)));
    let visible=0;
    if(all){
      hub.querySelectorAll('[data-document-mode]').forEach(card=>{card.hidden=false;visible++;});
    }else{
      const entries=attempts.filter(entry=>entry.status===selectedFilter);
      visible=entries.length;
      list.innerHTML=studyAttemptCards(entries);
      list.querySelectorAll('[data-resume-study]').forEach(button=>button.addEventListener('click',()=>resumeStudyAttempt(button.dataset.resumeStudy,item,categoryKey)));
    }
    const empty=hub.querySelector('.study-hub-empty');
    empty.hidden=visible>0;
    empty.textContent=selectedFilter==='started'?'Yarım kalan test ve serilerin burada görünecek.':selectedFilter==='completed'?'Tamamladığın bölüm testleri ve seriler burada görünecek.':'Çalışma modu bulunamadı.';
  };
  hub.querySelector('.study-hub-book').addEventListener('click', () => { haptic(14); renderCategoryLevel(categoryKey); });
  hub.querySelectorAll('[data-hub-filter]').forEach(button => button.addEventListener('click', () => {
    selectedFilter = button.dataset.hubFilter;
    hub.querySelectorAll('[data-hub-filter]').forEach(tab => tab.setAttribute('aria-pressed', String(tab === button)));
    filterCards();
  }));
  hub.querySelectorAll('[data-document-mode]').forEach(button => button.addEventListener('click', () => {
    if (button.disabled) return;
    haptic(18);
    const mode = button.dataset.documentMode;
    if (mode === 'sections') renderSections(item, categoryKey);
    if (mode === 'random') openRandomQuiz(item, categoryKey);
    if (mode === 'summary') renderSummary(item, categoryKey);
    if (mode === 'truefalse') openTrueFalseMode(item, categoryKey);
  }));
  filterCards();
  topicSheet.scrollTop = 0;
  topicList.scrollTop = 0;
  hub.refreshTopicView = (filter=null) => {
    if(filter)selectedFilter=filter;
    attempts=studySessionsFor(item);
    hub.querySelector('[data-hub-filter="started"]').textContent=`Devam Eden (${attempts.filter(e=>e.status==='started').length})`;
    hub.querySelector('[data-hub-filter="completed"]').textContent=`Tamamlanan (${attempts.filter(e=>e.status==='completed').length})`;
    const count=Number(item.questionCount);
    const pct=Math.min(100,Math.max(0,Number(getDocumentProgress(item))||0));
    hub.querySelector('.study-hub-heading p').textContent=`${Number.isFinite(count)?count:'—'} soru • %${pct} ilerleme`;
    hub.querySelector('.study-hub-track').setAttribute('aria-valuenow',pct);
    hub.querySelector('.study-hub-track>span').style.width=pct+'%';
    hub.querySelector('.study-hub-progress>strong').textContent='%'+pct;
    if(Number.isFinite(count))hub.querySelectorAll('[data-document-mode]').forEach(card=>{if(card.dataset.documentMode!=='truefalse')card.querySelector('.study-hub-card-footer b').textContent=card.dataset.documentMode==='random'?Math.min(20,count):count;});
    filterCards();
  };
  refreshVisibleQuestionCounts([item],()=>hub.refreshTopicView());
}

function availableStudySections(item) {
  const role=progress.selectedRole;
  return (item.children || []).filter(section=>!role || !section.kadrolar || section.kadrolar.includes(role));
}
// Preserve named sections when a flat question file carries section metadata.
// Unlabelled banks keep stable 20-question IDs; never invent law article ranges.
function practiceSectionsFromBank(item, bank) {
  const named = bank.length && bank.every(q => String(q.sectionTitle || q.section?.title || '').trim());
  if (named) {
    const groups = new Map();
    bank.forEach(q => {
      const title = String(q.sectionTitle || q.section.title).trim();
      const range = String(q.articleRange || q.section?.articleRange || '').trim();
      const key = JSON.stringify([q.sectionId || q.section?.id || title, range]);
      if (!groups.has(key)) groups.set(key, {id: `${item.id}:practice:named:${encodeURIComponent(key)}`, title, articleRange: range === '0' ? '' : range, questionIds: [], generated: true});
      groups.get(key).questionIds.push(q.id);
    });
    return Array.from(groups.values(), section => ({...section, questionCount: section.questionIds.length}));
  }
  const sections = Array.from({length: Math.ceil(bank.length / 20)}, (_, index) => ({
    id: `${item.id}:practice:${index + 1}`, title: item.title,
    questionCount: Math.min(20, bank.length - index * 20),
    questionIds: bank.slice(index * 20, index * 20 + 20).map(q => q.id), generated: true
  }));
  const titleKey = String(item.title || '').toLocaleLowerCase('tr-TR');
  if (titleKey.includes('liderlik') && titleKey.includes('organizasyon') && bank.length === 201 && sections.length === 11) {
    sections[9].questionIds.push(...sections[10].questionIds);
    sections[9].questionCount = sections[9].questionIds.length;
    sections.pop();
  }
  return sections;
}
function sectionMetadata(section) {
  const range = String(section.articleRange || '').trim();
  const parts = [];
  if (range && range !== '0') parts.push(/^\d/.test(range) ? `Madde ${range}` : range);
  else if ((section.children || []).length) parts.push(`${section.children.length} madde`);
  const count = section.questionCount;
  parts.push(`${count != null && Number.isFinite(Number(count)) ? Number(count) : '—'} soru`);
  return parts.join(' · ');
}
function sectionAttemptState(item, section) {
  const entries = studySessionsFor(item).filter(entry => entry.type === 'section' && entry.sectionId === section.id);
  const pending = entries.filter(entry => entry.status === 'started').sort((a,b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))[0];
  return {pending, completed: Boolean(progress.completedSections[section.id] || entries.some(entry => entry.status === 'completed'))};
}
function sectionStateMarkup(value) {
  if (value.pending) {
    const total = Math.max(1, Number(value.pending.total) || 1);
    const answered = Math.min(total, Math.max(0, Number(value.pending.answered) || 0));
    return `<span class="section-resume-count">${answered}/${total}</span><span class="section-mini-track"><i style="width:${answered / total * 100}%"></i></span>`;
  }
  return value.completed ? `<span class="section-done" aria-label="Tamamlandı">${svg('check')}</span>` : '<span class="section-unstarted" aria-label="Başlanmadı"></span>';
}
async function renderSectionsFresh(documentItem, categoryKey) {
  topicSheet.classList.remove('category-glass');
  topicSheet.classList.add('document-flow', 'section-selection');
  applySheetHeader({ title: '', subtitle: '', eyebrow: '', icon: 'gavel', iconClass: categoryCardMeta(categoryKey).iconClass });
  renderBreadcrumb(documentItem.title, () => renderDocumentHub(documentItem, categoryKey));
  setSheetProgress('Henüz çalışılmadı', getDocumentProgress(documentItem));
  // NOT (2026-09-06 düzeltme): bölümler (documentItem.children) daha önce
  // kadroya göre hiç süzülmüyordu — getCategoryItems() üst-düzey konuları
  // doğru süzüyordu ama TEK bir belgenin İÇİNDEKİ bölümler bu filtreden hiç
  // geçmiyordu. Sonuç: örn. Memur, "MEB Yönetmelikleri" belgesini açınca
  // sadece Şef'e ait olması gereken bölümleri (Disiplin Amirleri, İmza
  // Yetkileri) de görüyordu.
  const role = progress.selectedRole;
  const pendingView = document.createElement('div');
  pendingView.className = 'empty-inline';
  pendingView.textContent = 'Bölümler yükleniyor…';
  topicList.replaceChildren(pendingView);
  try {
    const current = await ContentRepo.fetchStudyDocument(documentItem.id);
    if (!topicList.contains(pendingView)) return;
    if (role && current.kadrolar && !current.kadrolar.includes(role)) {
      pendingView.textContent = 'Bu konu seçili kadron için kullanılamıyor.';
      return;
    }
    Object.assign(documentItem, current, {children: current.children || []});
    state.questionBanks.delete(documentItem.id);
    renderBreadcrumb(documentItem.title, () => renderDocumentHub(documentItem, categoryKey));
  } catch (error) {
    if (topicList.contains(pendingView)) pendingView.textContent = error.message || 'Bölümler yüklenemedi. Geri dönüp yeniden dene.';
    return;
  }
  let sections = availableStudySections(documentItem);
  if (!(documentItem.children || []).length) {
    if (!requirePremiumOrWarn()) { renderDocumentHub(documentItem, categoryKey); return; }
    const loading = document.createElement('div'); loading.className='empty-inline'; loading.textContent='Bölümler yükleniyor…';
    topicList.replaceChildren(loading);
    try {
      const bank=await loadQuestionBank(documentItem);
      if(!topicList.contains(loading)) return;
      sections=practiceSectionsFromBank(documentItem, bank);
    } catch(error) { if(topicList.contains(loading)) loading.textContent=error.message||'Sorular yüklenemedi. Geri dönüp yeniden dene.'; return; }
  }
  topicList.innerHTML = `<div class="document-section-list">${sections.map((section, index) => {
    const value = sectionAttemptState(documentItem, section);
    const completed = value.completed;
    const sectionMeta = sectionMetadata(section);
    return `<article class="document-section-item ${completed ? 'completed' : ''}" data-section-index="${index}" role="button" tabindex="0"><span class="document-section-number">${String(index + 1).padStart(2, '0')}</span><div class="document-section-copy"><h4>${escapeHtml(section.title)}</h4><p>${escapeHtml(sectionMeta)}</p></div><span class="document-section-state">${sectionStateMarkup(value)}</span><span class="document-section-arrow">›</span></article>`;
  }).join('')}</div>`;
  topicList.querySelectorAll('[data-section-index]').forEach(element => {
    const open = () => {
      const section = sections[Number(element.dataset.sectionIndex)];
      const {pending} = sectionAttemptState(documentItem, section);
      if (pending) resumeStudyAttempt(pending.id, documentItem, categoryKey, () => renderSections(documentItem, categoryKey));
      else openSectionQuiz(documentItem, section, categoryKey);
    };
    element.addEventListener('click', open);
    element.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); } });
  });
  topicSheet.scrollTop = 0;
  if(!sections.length) topicList.innerHTML='<p class="empty-inline">Bu kadro için erişilebilir bölüm sorusu bulunamadı.</p>';
  const sectionRows=Array.from(topicList.querySelectorAll('[data-section-index]'));
  const refreshSections=()=>{
    sectionRows.forEach((row,index)=>{const value=sectionAttemptState(documentItem,sections[index]);row.classList.toggle('completed',value.completed);row.classList.toggle('in-progress',Boolean(value.pending));row.querySelector('.document-section-state').innerHTML=sectionStateMarkup(value);});
    setSheetProgress('Henüz çalışılmadı',getDocumentProgress(documentItem));
  };
  if(topicList.firstElementChild)topicList.firstElementChild.refreshTopicView=refreshSections;
  refreshSections();
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
  const targets = (sections || []).filter(section => !section.generated);
  if (!targets.length) return;
  const rows=Array.from(topicList.querySelectorAll('[data-section-index]'));
  const results = await Promise.allSettled(targets.map(async section => {
    const count = await ContentRepo.fetchQuestionCountByTopicId(section.id);
    return { section, count };
  }));
  results.forEach(result => {
    if (result.status !== 'fulfilled') { console.warn('Bölüm soru sayısı alınamadı:', result.reason); return; }
    const { section, count } = result.value;
    section.questionCount = count;
    const index = sections.indexOf(section);
    const row = rows[index]?.querySelector('p');
    if (row) row.textContent = sectionMetadata(section);
  });
}

async function renderSummaryFresh(documentItem, categoryKey) {
  topicSheet.classList.remove('category-glass');
  topicSheet.classList.add('document-flow');
  applySheetHeader({ title: 'Özet ve Kritik Noktalar', subtitle: documentItem.title, eyebrow: '', icon: categoryCardMeta(categoryKey).icon, iconClass: categoryCardMeta(categoryKey).iconClass });
  renderBreadcrumb(documentItem.title, () => renderDocumentHub(documentItem, categoryKey));
  setSheetProgress('Henüz çalışılmadı', getDocumentProgress(documentItem));
  topicList.innerHTML = '<div class="empty-inline" role="status">Hazırlanıyor</div>';
  topicSheet.scrollTop = 0;
  topicList.scrollTop = 0;
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

    // ID-based fallback includes descendant sections even without source_file.
    const questions = await ContentRepo.fetchQuestionsByTopicId(documentItem.id);
    
    state.questionBanks.set(documentItem.id, questions);
    return questions;
  } catch (error) {
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
    const sectionIds=new Set();
    const collect=entry=>{ if(progress.selectedRole && entry.kadrolar && !entry.kadrolar.includes(progress.selectedRole)) return; sectionIds.add(entry.id); (entry.children||[]).forEach(collect); }; collect(section);
    const questionIds=section.generated ? new Set(section.questionIds) : null;
    const questions = bank.filter(question => questionIds ? questionIds.has(question.id) : sectionIds.has(question.topicId));
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

    if(!pauseStudyAttempts(true))return;
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
  suspendTopicView();
  const tf = state.tfQuiz;
  if (!tf) return;
  saveTfAttempt(tf);

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
    if(!saveTfAttempt(tf))return;
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

  const answer = (userSaidCorrect, replay = false) => {
    if(!replay && tf.answers[tf.index])return;
    const wasRight = userSaidCorrect === q.isCorrectShown;
    if(!replay){tf.answers[tf.index]={correct:wasRight,selected:userSaidCorrect};if(wasRight)tf.score++;}
    // Doğru/Yanlış modu, ana quiz ile aynı kalıcı ilerleme ve yanlış havuzuna
    // SADECE kartta doğru cevap gösterildiğinde (q.isCorrectShown) yazar.
    // Neden: kartta yanlış bir şık gösterilip kullanıcı onu yanlışlıkla
    // "doğru" işaretlerse, bu kullanıcının konuyu bilmediğini değil, sadece
    // o tek distractor'ı doğru cevapla karıştırdığını gösterir — ÇS quiz'deki
    // "yanlış şık işaretleme" ile aynı güvenilirlikte bir sinyal değildir.
    // Bu yüzden sadece doğru-cevap-gösterilen kartlardaki performans kalıcı
    // "wrongQuestions" / Zayıf Konular havuzuna yansıtılır; oturum içi D/Y
    // skoru (tf.score) her iki durumda da normal şekilde tutulmaya devam eder.
    if (!replay && q.sourceQuestion && q.isCorrectShown) {
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
    if(!replay)haptic(wasRight ? 14 : [12, 40, 12]);
    saveTfAttempt(tf);

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
  const previous=tf.answers[tf.index];
  if(previous)answer(previous.selected ?? (previous.correct ? q.isCorrectShown : !q.isCorrectShown),true);
}

function renderTrueFalseResult() {
  const tf = state.tfQuiz;
  if(!tf)return;
  saveTfAttempt(tf,true);
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
    returnView: closeTopicSheet,
    customTimeSeconds: routeSettings.time === 'Süreli' ? routeSettings.durationMinutes * 60 : null
  });
}

function startQuiz({ questions, documentItem = null, section = null, kind, sessionId = null, title, subtitle, returnView, customTimeSeconds = null }) {
  if(!pauseStudyAttempts(true))return;
  suspendTopicView();
  clearInterval(timerInterval);
  timerInterval = null;

  const isTimed = customTimeSeconds !== null ? true : (kind === 'notification' ? false : (routeSettings.time === 'Süreli' || kind !== 'route'));
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
    recordUniqueTopicQuestion(question);
  }
  saveProgress();
  saveQuizAttempt();
}
function quizScore(quiz) {
  return quiz.questions.filter(question => question.userSelected === question.answerIndex).length;
}

function closeQuizFinishModal() {
  document.getElementById('quizFinishModal')?.remove();
}

function openQuizFinishModal() {
  const quiz = state.quiz;
  if (!quiz) return;

  closeQuizFinishModal();

  const answeredCount = quiz.questions.filter(q => q.userSelected !== null && q.userSelected !== undefined).length;
  const remaining = Math.max(0, quiz.questions.length - answeredCount);
  const modal = document.createElement('div');
  modal.className = 'quiz-finish-modal-overlay';
  modal.id = 'quizFinishModal';
  modal.innerHTML = `
    <div class="quiz-finish-modal" role="dialog" aria-modal="true" aria-labelledby="quizFinishModalTitle">
      <div class="quiz-finish-modal-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24">
          <path d="M6 3h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"></path>
          <path d="m8 12 2.2 2.2L16 8.5"></path>
        </svg>
      </div>

      <span class="quiz-finish-modal-eyebrow">BÖLÜMÜ BİTİR</span>
      <h2 id="quizFinishModalTitle">${remaining > 0 ? 'Bölümü şimdi bitirmek istiyor musun?' : 'Bölümü bitirmek istiyor musun?'}</h2>
      <p>${remaining > 0
        ? `Henüz cevaplamadığın <strong>${remaining} soru</strong> var. Bu sorular boş bırakılmış olarak değerlendirilecek.`
        : 'Tüm soruları cevapladın. Sonuç ekranına geçebilirsin.'
      }</p>

      <div class="quiz-finish-modal-summary">
        <div><span>Cevaplanan</span><strong>${answeredCount}</strong></div>
        <i></i>
        <div><span>Boş</span><strong class="${remaining > 0 ? 'is-warning' : ''}">${remaining}</strong></div>
        <i></i>
        <div><span>Toplam</span><strong>${quiz.questions.length}</strong></div>
      </div>

      <div class="quiz-finish-modal-actions">
        <button type="button" class="quiz-finish-cancel" id="quizFinishModalCancel">Devam et</button>
        <button type="button" class="quiz-finish-confirm" id="quizFinishModalConfirm">Bölümü bitir</button>
      </div>
    </div>
  `;

  topicSheet.appendChild(modal);

  const close = () => closeQuizFinishModal();
  document.getElementById('quizFinishModalCancel')?.addEventListener('click', close);
  modal.addEventListener('click', event => {
    if (event.target === modal) close();
  });

  document.getElementById('quizFinishModalConfirm')?.addEventListener('click', () => {
    close();
    document.getElementById('quizNavOverlay')?.classList.remove('open');
    finalizeQuestionAnswer(quiz.questions[quiz.index]);
    if (DEFERRED_REVEAL_KINDS.includes(quiz.kind) && !quiz.revealed) {
      revealDeferredQuizAndFinish();
    } else {
      renderQuizResult();
    }
  });
}


function renderQuiz() {
  saveQuizAttempt();
  closeQuizFinishModal();
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
            <button type="button" class="topbar-action topbar-finish" id="quizFinishEarlyButton" aria-label="Bölümü Bitir">Bitir</button>
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
    if(quiz.timeLeft % 5 === 0)saveQuizAttempt(quiz);
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

// Fit the report sheet into the visible area for both overlay and resizing keyboards.
function updateReportKeyboardViewport() {
  const overlay = document.getElementById('reportModalOverlay');
  if (!overlay?.classList.contains('open')) return;
  const vv = window.visualViewport;
  const nativeHeight = Math.max(0, parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--native-keyboard-height')) || parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--keyboard-height')) || 0);
  const viewportBottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
  const keyboardBottom = Math.min(viewportBottom, window.innerHeight - nativeHeight);
  const overlap = Math.max(0, overlay.getBoundingClientRect().bottom - keyboardBottom);
  overlay.style.setProperty('--report-keyboard-overlap', `${overlap}px`);
}
window.addEventListener('resize', updateReportKeyboardViewport);
window.visualViewport?.addEventListener('resize', updateReportKeyboardViewport);
window.visualViewport?.addEventListener('scroll', updateReportKeyboardViewport);
document.addEventListener('nativeux:keyboardchange', updateReportKeyboardViewport);

function reportQuestion(question, rerender) {
  const doRerender = typeof rerender === 'function' ? rerender : renderQuiz;
  const overlay = document.getElementById('reportModalOverlay');
  if (!overlay) return;

  const isReported = Boolean(progress.reportedQuestions[question.id]);
  document.getElementById('reportModalNewContent').style.display = isReported ? 'none' : 'block';
  document.getElementById('reportModalUndoContent').style.display = isReported ? 'block' : 'none';
  if (!isReported) document.getElementById('reportModalNote').value = '';

  overlay.classList.add('open');

  updateReportKeyboardViewport();
  const closeModal = () => {
    if (overlay.contains(document.activeElement)) document.activeElement.blur();
    window.NativeUX?.hideKeyboard?.();
    overlay.classList.remove('open');
  };
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
  if(state.quiz?.studyFinishing){showToast('Sonuç hazırlanıyor, lütfen bekle.');return;}
  clearInterval(timerInterval);
  timerInterval = null;
  const quiz = state.quiz;
  if (!quiz) return;
  finalizeQuestionAnswer(quiz.questions[quiz.index]);
  if(!saveQuizAttempt(quiz))return;
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
    openQuizFinishModal();
  });
}

function recordQuizCompletion(quiz) {
  if (quiz.completionRecorded) return;
  quiz.completionRecorded = true;
  if(quiz.studySessionId && progress.completedTests.some(test=>test.id===quiz.studySessionId))return;
  // D-07 (2026-09-15): Hiç cevap verilmeden bitirilen test "tamamlandı"
  // sayılmaz (bölüm ilerlemesini ve deneme rozetlerini şişirmesin).
  const answeredCount = quiz.questions.filter(question => question.userSelected !== null && question.userSelected !== undefined).length;
  if (answeredCount === 0) return;
  const score = quizScore(quiz);
  progress.completedTests.push({
    id: quiz.studySessionId || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    title: quiz.title,
    kind: quiz.kind,
    documentId: quiz.documentItem?.id || null,
    sectionId: quiz.section?.id || null,
    score,
    answered: answeredCount,
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
  const quiz=state.quiz;
  if(!quiz)return;
  if(quiz.revealed){quiz.questions.forEach(question=>{if(question.userSelected!==null&&question.userSelected!==undefined)recordAnswer(question,question.userSelected);});return renderQuizResult();}
  if(quiz.studyFinishing)return;
  quiz.studyFinishing=true;
  clearInterval(timerInterval);timerInterval=null;
  saveQuizAttempt(quiz);
  try {
    if(quiz.kind==='random'){
      showToast('Sonuçlar hazırlanıyor…');
      const reveal=await ContentRepo.revealQuizSession(quiz.sessionId);
      if(state.quiz!==quiz || (quiz.studyScope && quiz.studyScope!==studySessionScope()))return;
      const byId=new Map(reveal.map(row=>[row.id,row]));
      if(quiz.questions.some(q=>!byId.has(q.id)))throw new Error('Eksik cevap anahtarı');
      quiz.questions.forEach(q=>{const info=byId.get(q.id);q.answerIndex=info.answerIndex;q.explanation=info.explanation;});
    }
    quiz.revealed=true;
    quiz.questions.forEach(question=>{if(question.userSelected!==null && question.userSelected!==undefined)recordAnswer(question,question.userSelected);});
    renderQuizResult();
  }catch(error){
    saveQuizAttempt(quiz);
    showToast('Sonuç alınamadı. Çalışman Devam Eden bölümünde korunuyor; bağlantını kontrol edip yeniden bitirmeyi dene.');
  }finally{quiz.studyFinishing=false;}
}

function renderQuizResult() {
  clearInterval(timerInterval);
  timerInterval = null;
  const quiz = state.quiz;
  if (!quiz) return;
  recordQuizCompletion(quiz);
  saveQuizAttempt(quiz,true);
  const score = quizScore(quiz);
  const total = quiz.questions.length;
  const percentage = total ? Math.round((score / total) * 100) : 0;
  logEvent('quiz_completed', { kind: quiz.kind || 'standard', score, total, pct: percentage });
  topicSheet.classList.remove('quiz-active');
  topicSheet.classList.remove('category-glass');
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
  if (notifSheet?.classList.contains('open')) { closeAllSheets(); return true; }
  if (topicSheet.classList.contains('open')) {
    // Gerçek (zamanlı/notlu) bir sınav hâlâ sürüyorsa yanlışlıkla çıkışı
    // engellemek için onay iste. Pratik testlerde (route/section/random) ve
    // sonuç ekranında ekstra sürtünme yok — görünür geri tuşuyla aynı davranış.
    if (state.quiz && EXAM_KINDS.includes(state.quiz.kind) && !state.quiz.completionRecorded) {
      if (!window.confirm('Sınavdan çıkmak istediğine emin misin? İlerlemen kaydedilmeyecek.')) return true;

    }
    if (state.quiz) { exitQuizToReturnView(); return true; }
    if(state.tfQuiz){document.getElementById('tfClose')?.click();if(state.tfQuiz)closeTopicSheet();return true;}
    const sheetBackButton = document.getElementById('sheetBackButton');
    if (sheetBackButton) { sheetBackButton.click(); return true; }
    closeTopicSheet();
    return true;
  }
  if (routeSheet.classList.contains('open')) { closeRouteSheet(); return true; }
  if (state.view === 'study-preferences') {
    const returnTop = profileReturnScrollTop;
    state.view = 'profile';
    setNav('profile');
    render();
    requestAnimationFrame(() => {
      scrollArea.scrollTop = returnTop;
    });
    return true;
  }
  if (['statistics', 'achievements', 'profile-edit', 'goal-settings', 'data-account', 'appearance'].includes(state.view)) {
    state.view = 'profile';
    setNav('profile');
    render();
    restoreProfilePosition();
    return true;
  }
  if (state.view !== 'home') { go('home'); return true; }
  return false;
}
document.addEventListener('nativeux:backbutton', event => {
  if (handleHardwareBack()) event.preventDefault();
});

// Native Android delivers its system back gesture through nativeux:backbutton.
// iOS uses the left-edge gesture below, routed to the same back handler.
let edgeBackGesture=null;
let edgeBackSuppressClickUntil=0;
function clearEdgeBackGesture() {
  edgeBackGesture=null;
  document.querySelector('.phone')?.classList.remove('edge-back-ready');
}
function edgeBackStart(event) {
  if(window.Capacitor?.getPlatform?.()==='android' || event.touches.length!==1)return;
  if(roleGate?.getAttribute('aria-hidden')==='false' || state.quiz?.studyFinishing)return;
  if(document.querySelector('.quiz-finish-modal-overlay.open'))return;
  const phone=document.querySelector('.phone');if(!phone)return;
  const touch=event.touches[0],rect=phone.getBoundingClientRect();
  if(touch.clientX<rect.left || touch.clientX>rect.left+24)return;
  if(event.target.closest('input,textarea,select,[contenteditable="true"],[data-no-swipe-back]'))return;
  const openSheet=allSheets.some(sheet=>sheet.classList.contains('open'));
  if(!openSheet&&state.view==='home')return;
  edgeBackGesture={x:touch.clientX,y:touch.clientY,dx:0,dy:0,started:performance.now(),phone,
    origin:openSheet?topicList.firstElementChild:app.firstElementChild,openSheet,view:state.view,locked:false};
}
function edgeBackMove(event) {
  const g=edgeBackGesture;if(!g)return;
  if(event.touches.length!==1){clearEdgeBackGesture();return;}
  g.dx=event.touches[0].clientX-g.x;g.dy=event.touches[0].clientY-g.y;
  if(!g.locked){
    if(Math.abs(g.dy)>12&&Math.abs(g.dy)>Math.abs(g.dx)){clearEdgeBackGesture();return;}
    if(g.dx < -10){clearEdgeBackGesture();return;}
    if(g.dx>14&&g.dx>Math.abs(g.dy)*1.5)g.locked=true;
  }
  if(g.locked){if(event.cancelable)event.preventDefault();g.phone.classList.toggle('edge-back-ready',g.dx>=64);}
}
function edgeBackEnd() {
  const g=edgeBackGesture;clearEdgeBackGesture();if(!g?.locked)return;
  const same=g.view===state.view && g.origin===(g.openSheet?topicList.firstElementChild:app.firstElementChild);
  if(same&&g.dx>=64&&g.dx>Math.abs(g.dy)*1.5&&performance.now()-g.started<1800)handleHardwareBack();
  edgeBackSuppressClickUntil=Date.now()+400;
}
document.addEventListener('touchstart',edgeBackStart,{passive:true});
document.addEventListener('touchmove',edgeBackMove,{passive:false});
document.addEventListener('touchend',edgeBackEnd,{passive:true});
document.addEventListener('touchcancel',clearEdgeBackGesture,{passive:true});
document.addEventListener('click',event=>{if(Date.now()<edgeBackSuppressClickUntil){event.preventDefault();event.stopImmediatePropagation();}},true);

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
let roleGateMode = 'initial';

function renderRoleGate(selectedRole = null) {
  roleGateList.innerHTML = ROLES.map(role => `
    <button class="role-gate-item${role.key === selectedRole ? ' selected' : ''}" data-role-key="${role.key}" type="button">
      <span class="role-gate-item-icon">${svg(ROLE_ICONS[role.key] || 'book')}</span>
      <strong>${escapeHtml(role.label)}</strong>
      <span class="role-gate-item-arrow">${role.key === selectedRole ? svg('check') : svg('arrow')}</span>
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

function openRoleGate(allowClose = false, selectedRole = null, mode = 'initial') {
  roleGateMode = mode;
  pendingRoleSelection = selectedRole || null;
  renderRoleGate(selectedRole);
  roleGateContinue.disabled = !pendingRoleSelection;
  roleGateContinue.classList.toggle('enabled', Boolean(pendingRoleSelection));
  const closeBtn = document.getElementById('roleGateClose');
  if (closeBtn) closeBtn.style.display = allowClose ? 'flex' : 'none';
  const title = roleGate?.querySelector('h1');
  const desc = roleGate?.querySelector('p');
  if (title) title.textContent = mode === 'change' ? 'Kadronu Değiştir' : 'Hedefini Seç';
  if (desc) desc.textContent = mode === 'change'
    ? 'Yanlış seçtiğin hedef kadroyu buradan değiştirebilirsin.'
    : 'Sana uygun çalışma planını hazırlayalım.';
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
    showToast(`Kadro değiştirilemedi. Mevcut kadro: ${label}.`);
    roleGateContinue.disabled = false;
    roleGateContinue.classList.add('enabled');
    return;
  }

  window.currentUserRole = savedRole;
  window.currentUserRoleError = false;
  progress.selectedRole = savedRole;
  window.SRProgressSync.touchField(progress, 'selectedRole');
  saveProgress({ rerender: false });

  closeRoleGate();

  if (roleGateMode === 'change') {
    // Kadroya bağlı tüm içerik/istatistik önbelleklerini temizle. Eski kadronun
    // soru sayısı veya konu havuzu ekranda kalmasın.
    state.catalogue = null;
    state.catalogueError = '';
    state.flashcardDecks = null;
    state.questionBanks.clear();
    state.activeCategoryKey = null;
    state.activeDocument = null;
    state.totalQuestionCount = 0;
    state.totalDueFlashcards = 0;
    state.dueFlashcardsCache = null;
    state.dueFlashcardsPromise = null;
    cardDecks.clear();

    state.view = 'profile';
    setNav('profile');
    render();
    scrollArea.scrollTop = 0;

    showToast('Hedef kadron güncellendi. İçerikler yenileniyor…');
    await loadCatalogue();
  } else {
    initializeApp();
  }
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

// ================= UYGULAMA İÇİ BİLDİRİMLER =================
// Bildirdiğin bir soru admin tarafından "Çözüldü" yapılınca veritabanı
// (resolve_question_feedback RPC'si) kullanıcı için notifications tablosuna
// bir satır ekler. RLS: kullanıcı yalnızca kendi bildirimlerini okuyabilir ve
// yalnızca read_at alanını güncelleyebilir.
let notifications = [];
let notifRefreshPromise = null;
let notifFilter = 'all';

function formatNotifDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
}

function updateNotifBadge() {
  const unread = notifications.filter(item => !item.read_at).length;
  if (notifBadge) {
    notifBadge.hidden = unread === 0;
    notifBadge.textContent = unread > 9 ? '9+' : String(unread);
  }
  if (openNotifButton) {
    openNotifButton.setAttribute('aria-label', unread ? `Bildirimler, ${unread} okunmamış` : 'Bildirimler');
  }
  if (notifClearButton) notifClearButton.hidden = notifications.length === 0;
}

function notifDay(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { key: 'unknown', label: 'Bildirimler', date: '' };
  const key = date.toLocaleDateString('sv-SE');
  const today = new Date();
  const yesterday = new Date(); yesterday.setDate(today.getDate() - 1);
  const label = key === today.toLocaleDateString('sv-SE') ? 'Bugün'
    : key === yesterday.toLocaleDateString('sv-SE') ? 'Dün' : formatNotifDate(value);
  return { key, label, date: formatNotifDate(value) };
}

const LEGACY_NOTIFICATION_PREFIX = 'Bildirimin incelendi ve soru güncellendi. Katkın için teşekkürler.';

function notificationAdminReply(item) {
  let reply = String(item?.body || '').trim();
  if (reply.startsWith(LEGACY_NOTIFICATION_PREFIX)) {
    reply = reply.slice(LEGACY_NOTIFICATION_PREFIX.length).trim();
  }
  return reply || 'Admin yanıtı bulunamadı.';
}

function notifIcon(title) {
  const text = String(title || '').toLocaleLowerCase('tr-TR');
  const kind = /düzelt|çözül|güncellen/.test(text) ? 'fixed' : /inceleme|kontrol/.test(text) ? 'review' : 'general';
  const paths = kind === 'fixed'
    ? '<path d="M14 6a5 5 0 0 0-6 6L3 17a2.1 2.1 0 0 0 3 3l5-5a5 5 0 0 0 6-6l-3 3-3-3 3-3Z"/>'
    : kind === 'review' ? '<rect x="6" y="3" width="12" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h4"/>' : '<path d="m5 12 4 4L19 6"/>';
  return `<span class="notif-symbol ${kind}" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${paths}</svg></span>`;
}

function renderNotifList() {
  if (!notifList) return;
  const scrollTop = notifList.scrollTop;
  updateNotifBadge();
  const unread = notifications.filter(item => !item.read_at).length;
  document.getElementById('notifAllCount').textContent = notifications.length;
  document.getElementById('notifUnreadCount').textContent = unread;
  notifSheet.querySelectorAll('[data-notif-filter]').forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.notifFilter === notifFilter));
  });
  const visible = notifications.filter(item => notifFilter !== 'unread' || !item.read_at)
    .slice().sort((a, b) => (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0));
  if (!visible.length) {
    notifList.innerHTML = `<div class="notif-empty">${notifIcon('')}<h4>${notifFilter === 'unread' ? 'Hepsi tamam!' : 'Henüz bildirimin yok'}</h4><p>${notifFilter === 'unread' ? 'Okunmamış bildirimin bulunmuyor.' : 'Yeni bildirimlerin burada görünecek.'}</p></div>`;
    return;
  }
  let lastDay = '';
  notifList.innerHTML = visible.map(item => {
    const day = notifDay(item.created_at);
    const heading = lastDay !== day.key ? `<div class="notif-day"><h4>${escapeHtml(day.label)}</h4>${day.label !== day.date ? `<span>${escapeHtml(day.date)}</span>` : ''}</div>` : '';
    lastDay = day.key;
    const date = new Date(item.created_at);
    const time = Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
    const reply = notificationAdminReply(item);
    const hasQuestion = Boolean(item.question_id || item.tf_question_id);
    return `${heading}<article class="notif-message${item.read_at ? '' : ' unread'}" data-notif-id="${escapeHtml(item.id)}" ${item.read_at ? '' : 'role="button" tabindex="0"'} aria-label="${escapeHtml(reply)}${item.read_at ? '' : ', okundu olarak işaretle'}">
      ${notifIcon(item.title)}
      <div class="notif-message-copy">
        <p class="notif-admin-reply">${escapeHtml(reply)}</p>
        <div class="notif-message-footer">
          <span class="notif-time"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>${escapeHtml(time)}</span>
          ${hasQuestion ? `<button type="button" class="notif-question-link" data-notif-question="${escapeHtml(item.id)}">Soruya Git <span aria-hidden="true">›</span></button>` : ''}
        </div>
      </div>
    </article>`;
  }).join('');
  notifList.scrollTop = scrollTop;
  notifList.querySelectorAll('[data-notif-id].unread').forEach(element => {
    const open = event => {
      if (event?.target?.closest?.('[data-notif-question]')) return;
      markNotificationRead(element.dataset.notifId);
    };
    element.addEventListener('click', open);
    element.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(event); } });
  });
  notifList.querySelectorAll('[data-notif-question]').forEach(button => {
    button.addEventListener('click', event => {
      event.stopPropagation();
      openNotificationQuestion(button.dataset.notifQuestion);
    });
  });
}

notifSheet?.querySelectorAll('[data-notif-filter]').forEach(button => {
  button.addEventListener('click', () => {
    notifFilter = button.dataset.notifFilter;
    notifList.scrollTop = 0;
    renderNotifList();
  });
});

function refreshNotifications() {
  if (!window.currentUser?.id || typeof supabaseClient === 'undefined') return Promise.resolve();
  if (notifRefreshPromise) return notifRefreshPromise;
  notifRefreshPromise = (async () => {
    try {
      const { data, error } = await supabaseClient
        .from('notifications')
        .select('id, user_id, type, title, body, question_id, tf_question_id, feedback_id, created_at, read_at')
        .order('created_at', { ascending: false })
        .limit(30);
      if (error) throw error;
      notifications = data || [];
      renderNotifList();
    } catch (err) {
      // Bildirimler ikincil bir özellik: hata uygulamayı bölmesin.
      console.error('Bildirimler alınamadı:', err);
    } finally {
      notifRefreshPromise = null;
    }
  })();
  return notifRefreshPromise;
}

async function markNotificationRead(id) {
  const item = notifications.find(entry => String(entry.id) === String(id));
  if (!item || item.read_at) return;
  const previous = item.read_at;
  item.read_at = new Date().toISOString();
  renderNotifList();
  const { error } = await supabaseClient
    .from('notifications')
    .update({ read_at: item.read_at })
    .eq('id', item.id)
    .is('read_at', null);
  if (error) {
    console.error('Bildirim okundu işaretlenemedi:', error);
    item.read_at = previous;
    renderNotifList();
  }
}

async function clearNotifications() {
  if (!notifications.length || !window.currentUser?.id) return;
  const previous = notifications.slice();
  notifications = [];
  renderNotifList();
  if (notifClearButton) notifClearButton.disabled = true;

  const { error } = await supabaseClient
    .from('notifications')
    .delete()
    .eq('user_id', window.currentUser.id);

  if (notifClearButton) notifClearButton.disabled = false;
  if (error) {
    console.error('Bildirimler temizlenemedi:', error);
    notifications = previous;
    renderNotifList();
    showToast('Bildirimler temizlenemedi, tekrar dene.');
    return;
  }
  showToast('Bildirimler temizlendi.');
}

function findNotificationQuestionContext(topicId) {
  if (!topicId || !state.catalogue) return null;
  const wanted = String(topicId);
  const containsTopic = node => {
    if (!node) return false;
    if (String(node.id) === wanted) return true;
    return (node.children || []).some(containsTopic);
  };
  for (const [categoryKey] of getCategories()) {
    for (const item of getCategoryItems(categoryKey)) {
      if (containsTopic(item)) return { categoryKey, documentItem: item };
    }
  }
  return null;
}

async function openNotificationQuestion(notificationId) {
  const item = notifications.find(entry => String(entry.id) === String(notificationId));
  if (!item) return;
  await markNotificationRead(item.id);
  if (!requirePremiumOrWarn()) return;

  try {
    if (item.question_id) {
      const { data: row, error } = await supabaseClient
        .from('questions')
        .select('id, topic_id, prompt, options, answer_index, explanation')
        .eq('id', item.question_id)
        .maybeSingle();
      if (error) throw error;
      if (!row) throw new Error('Soru artık erişilebilir değil.');

      const context = findNotificationQuestionContext(row.topic_id);
      const documentItem = context?.documentItem || null;
      const categoryKey = context?.categoryKey || null;
      const question = {
        id: row.id,
        prompt: row.prompt,
        options: row.options,
        answerIndex: row.answer_index,
        explanation: row.explanation,
        topicId: row.topic_id,
        documentId: documentItem?.id || null,
        documentTitle: documentItem?.title || 'Bildirdiğin soru',
        categoryKey
      };

      closeAllSheets(topicSheet);
      topicSheet.classList.add('open', 'quiz-active');
      topicSheet.setAttribute('aria-hidden', 'false');
      topicBackdrop.classList.add('open');
      startQuiz({
        questions: [question],
        documentItem,
        kind: 'notification',
        title: documentItem?.title || 'Bildirdiğin Soru',
        subtitle: 'Bildiriminle ilgili soru',
        returnView: () => documentItem && categoryKey ? renderDocumentHub(documentItem, categoryKey) : closeTopicSheet()
      });
      return;
    }

    if (item.tf_question_id) {
      const { data: row, error } = await supabaseClient
        .from('tf_pool')
        .select('id, statement, is_true, correction, explanation, topic_id')
        .eq('id', item.tf_question_id)
        .maybeSingle();
      if (error) throw error;
      if (!row) throw new Error('Soru artık erişilebilir değil.');

      const context = findNotificationQuestionContext(row.topic_id);
      const documentItem = context?.documentItem || null;
      const categoryKey = context?.categoryKey || null;
      state.tfQuiz = {
        questions: [{
          id: row.id,
          feedbackQuestionId: `tf_${row.id}`,
          prompt: '',
          displayAnswer: row.statement,
          isCorrectShown: row.is_true,
          correctAnswer: row.is_true ? row.statement : (row.correction || row.statement),
          categoryKey,
          sourceQuestion: null
        }],
        index: 0,
        score: 0,
        answers: [],
        documentItem,
        categoryKey,
        returnView: () => documentItem && categoryKey ? renderDocumentHub(documentItem, categoryKey) : closeTopicSheet()
      };
      closeAllSheets(topicSheet);
      topicSheet.classList.add('open', 'quiz-active');
      topicSheet.classList.remove('document-flow', 'card-study-active');
      topicSheet.setAttribute('aria-hidden', 'false');
      topicBackdrop.classList.add('open');
      renderTrueFalse();
    }
  } catch (error) {
    console.error('Bildirimdeki soru açılamadı:', error);
    showToast(error?.message || 'Soru açılamadı.');
  }
}

let notificationRealtimeChannel = null;
function subscribeNotificationsRealtime() {
  const userId = window.currentUser?.id;
  if (!userId || typeof supabaseClient === 'undefined' || typeof supabaseClient.channel !== 'function') return;

  if (notificationRealtimeChannel) {
    try { supabaseClient.removeChannel(notificationRealtimeChannel); } catch (_) {}
    notificationRealtimeChannel = null;
  }

  notificationRealtimeChannel = supabaseClient
    .channel(`user-notifications-${userId}`)
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'notifications',
      filter: `user_id=eq.${userId}`
    }, payload => {
      const row = payload?.new;
      if (!row?.id) return;
      const index = notifications.findIndex(entry => String(entry.id) === String(row.id));
      if (index >= 0) notifications[index] = { ...notifications[index], ...row };
      else notifications.unshift(row);
      renderNotifList();
      haptic(8);
    })
    .subscribe(status => {
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        console.warn('Bildirim Realtime bağlantısı:', status);
      }
    });
}

function openNotifSheet() {
  if (!closeAllSheets(notifSheet)) return;
  renderNotifList();
  refreshNotifications();
}

openNotifButton?.addEventListener('click', openNotifSheet);
closeNotifSheetButton?.addEventListener('click', () => closeAllSheets());
notifClearButton?.addEventListener('click', clearNotifications);
// Uygulama arka plandan öne gelince yeni bildirim var mı diye bak.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') refreshNotifications();
});

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
    refreshNotifications();
    subscribeNotificationsRealtime();

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
