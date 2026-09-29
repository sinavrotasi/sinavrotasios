// ================= SınavRotası — Admin Paneli =================
// Bağımsız sayfa: app.js'e dokunmaz, aynı supabaseClient.js'i paylaşır.
// Erişim: sadece profiles.is_admin = true olan kullanıcılar (RLS zaten
// veritabanı seviyesinde yazmayı engelliyor; buradaki kontrol sadece UX içindir).

const KADRO_LABELS = { memur: 'Memur', sef: 'Şef', sayman: 'Sayman', 'sube-mudur': 'Şube Müdürü' };
function kadroLabel(k) { return KADRO_LABELS[k] || k; }

let activeTab = 'questions';           // 'questions' | 'tfPool' | 'topics' | 'feedback' | 'users' | 'settings'

// ---- Sorular sekmesi state'i ----
let currentTopicId = null;
let currentTopicTitle = '';
let topicsById = {};                    // id -> topic row
let childrenByParent = {};              // parent_id -> [topic row]
let categoriesCache = [];
let actualQuestionCounts = {};          // topic_id -> questions tablosundaki gerçek soru sayısı
let collapsedTopicIds = new Set();      // ağaç her yeniden çizildiğinde daralt/genişlet durumunun kaybolmaması için
let topicOptionsFlat = [];              // [{id,title,depth}] — modal <select> için ağaç sırasıyla
let editingQuestionId = null;

// ---- Sorular: toplu seçim state'i ----
let selectMode = false;
let selectedQuestionIds = new Set();
let currentQuestionsCache = [];         // o an ekranda listelenen sorular (dışa aktarma/toplu işlemler için)

// ---- D/Y Havuzu (tf_pool) sekmesi state'i ----
// Manuel Havuz'un aksine kadro değil KONU bazlı — çünkü app.js'teki gerçek
// D/Y modülü bir kadroya değil doğrudan bir konuya/dokümana bağlanıyor.
let currentTfPoolTopicId = null;
let currentTfPoolTopicTitle = '';
let tfPoolRowsCache = [];
let tfPoolCounts = {};          // topic_id -> bu konuya DOĞRUDAN bağlı ifade sayısı (Sorular sekmesindeki gibi alt konuları toplamıyor, v1 basitleştirmesi)
let tfPoolSelectMode = false;
let selectedTfPoolIds = new Set();
let editingTfPoolId = null;

// ---- Konular sekmesi state'i ----
const TOPIC_TYPE_LABELS = { topic: 'Konu', document: 'Kanun / Belge', section: 'Bölüm', exam_topic: 'Sınav Konusu' };
let manageCategoryId = null;            // Konular sekmesinde seçili kategori
let manageParentId = null;              // null => kategori kökü
let editingTopicId = null;
let newTopicParentId = null;            // "+ Ekle" tıklandığında hedef parent
let newTopicCategoryId = null;
let editingCategoryId = null;

// ---- Bildirimler sekmesi state'i ----
let feedbackStatusFilter = 'open';      // 'open' | 'resolved' | 'retracted' | 'all'
let feedbackRowsCache = [];

// ---- Kullanıcılar sekmesi state'i ----
let userSearchQuery = '';
let userRowsCache = [];
let currentAdminUserId = null;

// ---- Toast bildirimleri (alert() yerine) ----
const adminToastEl = document.getElementById('adminToast');
function showToast(message, isError = false) {
  if (!adminToastEl) { window.alert(message); return; } // güvenlik ağı: element yoksa eski davranışa düş
  adminToastEl.textContent = message;
  adminToastEl.classList.toggle('error', isError);
  adminToastEl.classList.add('show');
  window.clearTimeout(showToast.timeout);
  showToast.timeout = window.setTimeout(() => adminToastEl.classList.remove('show'), 3200);
}

// ========================= 1) Giriş / admin kontrolü =========================
async function boot() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) { window.location.href = 'login.html'; return; }

  currentAdminUserId = session.user.id;

  const { data: profile, error } = await supabaseClient
    .from('profiles').select('is_admin').eq('id', session.user.id).maybeSingle();

  if (error || !profile?.is_admin) {
    document.getElementById('authGate').textContent = 'Bu sayfaya erişim yetkiniz yok.';
    return;
  }

  document.getElementById('adminEmail').textContent = session.user.email || '';
  document.getElementById('authGate').style.display = 'none';
  document.getElementById('adminApp').classList.add('ready');

  initResponsiveSidebar();
  initModalDismissControls();
  document.querySelectorAll('.tabs button').forEach(btn => {
    btn.addEventListener('click', () => {
      switchTab(btn.dataset.tab);
      setSidebarOpen(false);
    });
  });
  initSidebarResize();
  await loadTopics();
  switchTab('questions');
}

// ========================= 1b) Sol paneli sürükleyerek genişletme =========================
function initSidebarResize() {
  const sidebar = document.querySelector('.sidebar');
  const handle = document.getElementById('sidebarResizeHandle');
  if (!sidebar || !handle) return;

  const saved = parseInt(localStorage.getItem('sr_sidebar_width') || '', 10);
  if (saved && saved >= 220 && saved <= 560) sidebar.style.width = saved + 'px';

  let startX = 0, startWidth = 0, dragging = false;

  handle.addEventListener('mousedown', (e) => {
    dragging = true;
    startX = e.clientX;
    startWidth = sidebar.getBoundingClientRect().width;
    handle.classList.add('dragging');
    document.body.classList.add('sidebar-resizing');
    e.preventDefault();
  });

  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const next = Math.min(560, Math.max(220, startWidth + (e.clientX - startX)));
    sidebar.style.width = next + 'px';
  });

  window.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove('dragging');
    document.body.classList.remove('sidebar-resizing');
    localStorage.setItem('sr_sidebar_width', Math.round(sidebar.getBoundingClientRect().width));
  });
}

// ========================= 1c) Mobil menü + erişilebilir modal kapatma =========================
const SIDE_PANEL_TITLES = {
  questions: 'Konu ağacı',
  tfPool: 'Konu ağacı',
  topics: 'Kategori ağacı',
  feedback: 'Bildirim filtreleri',
  users: 'Kullanıcı araçları',
  settings: 'Genel ayarlar'
};

function setSidebarOpen(isOpen) {
  const sidebar = document.getElementById('adminSidebar');
  const toggle = document.getElementById('sidebarToggle');
  const canOpen = window.matchMedia('(max-width: 760px)').matches;
  const next = Boolean(isOpen) && canOpen;
  sidebar?.classList.toggle('is-open', next);
  document.body.classList.toggle('sidebar-open', next);
  toggle?.setAttribute('aria-expanded', String(next));
}

function initResponsiveSidebar() {
  const sidebar = document.getElementById('adminSidebar');
  const toggle = document.getElementById('sidebarToggle');
  const close = document.getElementById('sidebarCloseBtn');
  const backdrop = document.getElementById('sidebarBackdrop');
  if (!sidebar) return;

  toggle?.addEventListener('click', () => setSidebarOpen(!sidebar.classList.contains('is-open')));
  close?.addEventListener('click', () => setSidebarOpen(false));
  backdrop?.addEventListener('click', () => setSidebarOpen(false));
  window.addEventListener('resize', () => {
    if (!window.matchMedia('(max-width: 760px)').matches) setSidebarOpen(false);
  });
}

function initModalDismissControls() {
  const closeHandlers = {
    modalBackdrop: closeQuestionModal,
    bulkModalBackdrop: closeBulkModal,
    tfPoolModalBackdrop: closeTfPoolModal,
    tfPoolBulkModalBackdrop: closeTfPoolBulkModal,
    topicModalBackdrop: closeTopicModal,
    categoryModalBackdrop: closeCategoryModal
  };

  document.querySelectorAll('[data-close-modal]').forEach(button => {
    button.addEventListener('click', () => closeHandlers[button.dataset.closeModal]?.());
  });

  window.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    const openBackdrops = [...document.querySelectorAll('.modal-backdrop.open')];
    const openBackdrop = openBackdrops[openBackdrops.length - 1];
    if (openBackdrop) {
      event.preventDefault();
      closeHandlers[openBackdrop.id]?.();
      return;
    }
    setSidebarOpen(false);
  });
}

function setSidePanelTitle(tab) {
  const title = document.getElementById('sidePanelTitle');
  if (title) title.textContent = SIDE_PANEL_TITLES[tab] || 'Çalışma alanı';
}

function appendResponsiveTable(parent, table) {
  const labels = [...table.querySelectorAll('thead th')].map((cell, index) => cell.textContent.trim() || (index === 0 ? 'Seçim' : 'İşlemler'));
  table.querySelectorAll('tbody tr').forEach(row => {
    [...row.children].forEach((cell, index) => cell.dataset.label = labels[index] || 'Bilgi');
  });
  const wrapper = document.createElement('div');
  wrapper.className = 'table-scroll';
  wrapper.tabIndex = 0;
  wrapper.setAttribute('aria-label', 'Tabloyu yatay kaydırmak için bu alanı kullanın');
  wrapper.appendChild(table);
  parent.appendChild(wrapper);
}

function renderSidePanelNotice(title, description) {
  const panel = document.getElementById('sidePanel');
  if (!panel) return;
  panel.innerHTML = '';
  const notice = document.createElement('div');
  notice.className = 'side-panel-notice';
  const heading = document.createElement('strong');
  heading.textContent = title;
  const copy = document.createElement('p');
  copy.textContent = description;
  notice.append(heading, copy);
  panel.appendChild(notice);
}

document.getElementById('signOutBtn').addEventListener('click', async () => {
  await supabaseClient.auth.signOut();
  window.location.href = 'login.html';
});

// ========================= 2) Sekme geçişi =========================
// A-01 (2026-09-15): "Denemeler" ve "Manuel Havuz" sekmelerinin kullandığı
// denemeler / deneme_questions / manual_deneme_pool tabloları 2026-09-04'te
// kaldırıldı (migration 20260904194030). Sekmeler arayüzden çıkarıldı; eski
// bir bağlantı ya da kod yolu bu sekmeleri açmaya çalışırsa Sorular açılır.
const RETIRED_TABS = new Set(['denemeler', 'manualPool']);

function switchTab(tab) {
  if (RETIRED_TABS.has(tab)) tab = 'questions';
  activeTab = tab;
  setSidePanelTitle(tab);
  document.querySelectorAll('.tabs button').forEach(b => {
    const isActive = b.dataset.tab === tab;
    b.classList.toggle('active', isActive);
    b.setAttribute('aria-current', isActive ? 'page' : 'false');
  });

  if (tab === 'questions') {
    selectMode = false;
    selectedQuestionIds.clear();
    document.getElementById('mainActions').innerHTML =
      '<input type="text" id="questionIdSearch" class="id-search-input" placeholder="Soru ID ile bul…">' +
      '<button class="btn secondary" id="questionIdSearchBtn" type="button">Bul</button>' +
      '<button class="btn secondary" id="selectQuestionsBtn" type="button">Soruları Seç</button>' +
      '<button class="btn secondary" id="bulkQuestionBtn" type="button">+ Toplu Soru Ekle</button>' +
      '<button class="btn" id="newQuestionBtn" type="button">+ Yeni Soru</button>';
    document.getElementById('newQuestionBtn').addEventListener('click', () => openQuestionModal(null));
    document.getElementById('bulkQuestionBtn').addEventListener('click', () => openBulkModal());
    document.getElementById('selectQuestionsBtn').addEventListener('click', () => toggleSelectMode());
    document.getElementById('questionIdSearchBtn').addEventListener('click', () => {
      const val = document.getElementById('questionIdSearch').value.trim();
      if (val) searchQuestionById(val);
    });
    document.getElementById('questionIdSearch').addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const val = e.target.value.trim();
      if (val) searchQuestionById(val);
    });
    renderTopicTree();
    if (currentTopicId) {
      document.getElementById('mainTitle').textContent = currentTopicTitle;
      loadQuestions();
    } else {
      document.getElementById('mainTitle').textContent = 'Bir konu seçin';
      document.getElementById('mainSub').textContent = '';
      document.getElementById('content').innerHTML = '<div class="empty-state">Soldan bir konu seçerek sorularını görüntüleyin.</div>';
    }
  } else if (tab === 'tfPool') {
    tfPoolSelectMode = false;
    selectedTfPoolIds.clear();
    document.getElementById('mainActions').innerHTML =
      '<button class="btn secondary" id="selectTfPoolBtn" type="button">İfadeleri Seç</button>' +
      '<button class="btn secondary" id="bulkTfPoolBtn" type="button">+ Toplu İfade Ekle</button>' +
      '<button class="btn" id="newTfPoolBtn" type="button">+ Yeni İfade</button>';
    document.getElementById('newTfPoolBtn').addEventListener('click', () => openTfPoolModal(null));
    document.getElementById('bulkTfPoolBtn').addEventListener('click', () => openTfPoolBulkModal());
    document.getElementById('selectTfPoolBtn').addEventListener('click', () => toggleTfPoolSelectMode());
    loadTfPoolCounts().then(renderTfPoolTopicTree);
    if (currentTfPoolTopicId) {
      document.getElementById('mainTitle').textContent = currentTfPoolTopicTitle;
      loadTfPool();
    } else {
      document.getElementById('mainTitle').textContent = 'Bir konu seçin';
      document.getElementById('mainSub').textContent = '';
      document.getElementById('content').innerHTML = '<div class="empty-state">Soldan bir konu seçerek o konunun D/Y ifadelerini görüntüleyin.</div>';
    }
  } else if (tab === 'topics') {
    document.getElementById('mainActions').innerHTML =
      '<button class="btn" id="newCategoryBtn" type="button">+ Yeni Kategori</button>';
    document.getElementById('newCategoryBtn').addEventListener('click', () => openCategoryModal(null));
    renderCategorySidebar();
    if (manageCategoryId) {
      renderManageContent();
    } else {
      document.getElementById('mainTitle').textContent = 'Bir kategori seçin';
      document.getElementById('mainSub').textContent = '';
      document.getElementById('content').innerHTML = '<div class="empty-state">Soldan bir kategori seçin, ya da yeni bir kategori oluşturun.</div>';
    }
  } else if (tab === 'feedback') {
    document.getElementById('mainActions').innerHTML = `
      <select id="feedbackStatusSelect" class="btn secondary" style="cursor:pointer;">
        <option value="open">Açık</option>
        <option value="resolved">Çözüldü</option>
        <option value="retracted">Geri Alınan</option>
        <option value="all">Tümü</option>
      </select>`;
    const sel = document.getElementById('feedbackStatusSelect');
    sel.value = feedbackStatusFilter;
    sel.addEventListener('change', (e) => {
      feedbackStatusFilter = e.target.value;
      loadFeedback();
    });
    document.getElementById('mainTitle').textContent = 'Soru Bildirimleri';
    document.getElementById('mainSub').textContent = '';
    document.getElementById('content').innerHTML = '<div class="empty-state">Yükleniyor…</div>';
    renderSidePanelNotice('Bildirim yönetimi', 'Açık kayıtlar varsayılan olarak gösterilir. Durum filtresini üst alandan değiştirebilirsiniz.');
    loadFeedback();
  } else if (tab === 'users') {
    document.getElementById('mainActions').innerHTML =
      '<input type="text" id="userSearchInput" class="id-search-input" placeholder="E-posta ile ara…">' +
      '<button class="btn secondary" id="userSearchBtn" type="button">Ara</button>';
    document.getElementById('userSearchInput').value = userSearchQuery;
    document.getElementById('userSearchBtn').addEventListener('click', () => {
      userSearchQuery = document.getElementById('userSearchInput').value.trim();
      loadUsers();
    });
    document.getElementById('userSearchInput').addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      userSearchQuery = e.target.value.trim();
      loadUsers();
    });
    document.getElementById('mainTitle').textContent = 'Kullanıcılar';
    document.getElementById('mainSub').textContent = '';
    document.getElementById('content').innerHTML = '<div class="empty-state">Yükleniyor…</div>';
    renderSidePanelNotice('Kullanıcı erişimi', 'E-posta ile arayın; premium erişimini bu alandan güvenle yönetin.');
    loadUsers();
  } else if (tab === 'settings') {
    document.getElementById('mainActions').innerHTML = '';
    document.getElementById('mainTitle').textContent = 'Genel Ayarlar';
    document.getElementById('mainSub').textContent = '';
    document.getElementById('content').innerHTML = '<div class="empty-state">Yükleniyor…</div>';
    renderSidePanelNotice('Uygulama geneli ayarlar', 'Bu alandaki değerler tüm kullanıcılar için ortaktır (kullanıcı bazlı değil).');
    loadSettings();
  }
}

// ========================= 3) Konu ağacı (paylaşılan veri) =========================
async function loadTopics() {
  const [{ data: categories, error: catErr }, { data: topics, error: topicErr }, { data: questionRows, error: qErr }] = await Promise.all([
    supabaseClient.from('categories').select('id,title,subtitle,sort_order').order('sort_order'),
    supabaseClient.from('topics').select('id,category_id,parent_id,type,title,document_number,article_range,question_count,kadrolar,sort_order,summary,key_points').order('sort_order'),
    supabaseClient.rpc('get_question_counts')
  ]);

  if (catErr || topicErr || qErr) {
    document.getElementById('sidePanel').innerHTML = `<div class="empty-state">Konular yüklenemedi: ${escapeHtml((catErr || topicErr || qErr).message)}</div>`;
    return;
  }

  // Her topic için gruplu soru sayısını al (tüm satırları çekmek yerine sadece sayımlar gelir)
  actualQuestionCounts = {};
  (questionRows || []).forEach(q => {
    actualQuestionCounts[q.topic_id] = Number(q.count);
  });

  categoriesCache = categories;
  topicsById = {};
  childrenByParent = {};
  const byCategory = {};
  topics.forEach(t => {
    topicsById[t.id] = t;
    if (t.parent_id) {
      (childrenByParent[t.parent_id] = childrenByParent[t.parent_id] || []).push(t);
    } else {
      (byCategory[t.category_id] = byCategory[t.category_id] || []).push(t);
    }
  });

  // Modal <select> için düz, ağaç sıralı liste
  topicOptionsFlat = [];
  categories.forEach(cat => {
    function walk(list, depth) {
      (list || []).forEach(t => {
        topicOptionsFlat.push({ id: t.id, title: t.title, depth });
        walk(childrenByParent[t.id], depth + 1);
      });
    }
    walk(byCategory[cat.id], 0);
  });

  // Her konu için, altındaki tüm alt konuların soru sayılarını da toplayan
  // "toplam" haritayı hesapla. Ağaçtaki rozetler ve Konular sekmesindeki
  // sayılar artık bunu kullanıyor; böylece alt konusu olan bir üst konu da
  // gerçek (kümülatif) soru sayısını gösteriyor.
  computeAggregatedCounts();

  window.__byCategory = byCategory; // renderTopicTree içinde kullanılacak
}

// actualQuestionCounts (sadece o konunun DOĞRUDAN sahip olduğu sorular) üzerinden,
// her konu için kendisi + tüm alt konularının toplamını hesaplar.
let aggregatedQuestionCounts = {};
function computeAggregatedCounts() {
  aggregatedQuestionCounts = {};
  function sumFor(id) {
    if (aggregatedQuestionCounts[id] !== undefined) return aggregatedQuestionCounts[id];
    let total = actualQuestionCounts[id] || 0;
    (childrenByParent[id] || []).forEach(child => { total += sumFor(child.id); });
    aggregatedQuestionCounts[id] = total;
    return total;
  }
  Object.keys(topicsById).forEach(id => sumFor(id));
}

function collectDescendantTopicIds(rootId) {
  const ids = [rootId];
  const stack = [rootId];
  while (stack.length) {
    const cur = stack.pop();
    (childrenByParent[cur] || []).forEach(child => { ids.push(child.id); stack.push(child.id); });
  }
  return ids;
}

function renderTopicTree() {
  const panel = document.getElementById('sidePanel');
  const byCategory = window.__byCategory || {};

  if (!categoriesCache.length) {
    panel.innerHTML = '<div class="empty-state">Henüz kategori yok.</div>';
    return;
  }

  panel.innerHTML = '';
  categoriesCache.forEach(cat => {
    const block = document.createElement('div');
    block.className = 'cat-block';
    const title = document.createElement('div');
    title.className = 'cat-title';
    title.textContent = cat.title;
    block.appendChild(title);

    // Yeni: Ağacı iç içe (nested) oluşturacak recursive fonksiyon
    function buildNode(list, depth, parentContainer) {
      (list || []).forEach(t => {
        const hasChildren = childrenByParent[t.id] && childrenByParent[t.id].length > 0;

        const wrapper = document.createElement('div');
        wrapper.className = `tree-node-wrapper${collapsedTopicIds.has(t.id) ? ' collapsed' : ''}`;

        const node = document.createElement('div');
        node.className = `tree-node depth-${depth}${t.id === currentTopicId ? ' active' : ''}`;
        node.dataset.topicId = t.id;

        // Alt konusu varsa ok işareti, yoksa boşluk ekle
        const iconHtml = hasChildren 
          ? `<span class="toggle-icon">▼</span>` 
          : `<span class="toggle-spacer"></span>`;

        // DÜZELTME: rozet artık sadece bu konuya DOĞRUDAN bağlı soru sayısını değil,
        // altındaki tüm alt konuların soru sayısını da içeren toplamı gösteriyor.
        const displayCount = aggregatedQuestionCounts[t.id] || 0;
        node.innerHTML = `${iconHtml}<span class="node-title">${escapeHtml(t.title)}</span>${displayCount > 0 ? `<span class="qcount">${displayCount}</span>` : ''}`;

        // Tıklama event'i: Ok ikonuna tıklanırsa aç/kapat + o konuyu da aktif hale getir (metne tıklamakla aynı davranış)
        node.addEventListener('click', (e) => {
          if (e.target.classList.contains('toggle-icon')) {
            e.stopPropagation();
            wrapper.classList.toggle('collapsed');
            if (wrapper.classList.contains('collapsed')) collapsedTopicIds.add(t.id);
            else collapsedTopicIds.delete(t.id);
          }
          selectTopic(t.id, t.title);
        });

        wrapper.appendChild(node);

        if (hasChildren) {
          const childrenContainer = document.createElement('div');
          childrenContainer.className = 'tree-children';
          buildNode(childrenByParent[t.id], depth + 1, childrenContainer);
          wrapper.appendChild(childrenContainer);
        }

        parentContainer.appendChild(wrapper);
      });
    }

    buildNode(byCategory[cat.id], 0, block);
    panel.appendChild(block);
  });
}

function selectTopic(topicId, title) {
  currentTopicId = topicId;
  currentTopicTitle = title;
  selectMode = false;
  selectedQuestionIds.clear();
  document.querySelectorAll('.tree-node').forEach(n => n.classList.toggle('active', n.dataset.topicId === topicId));
  document.getElementById('mainTitle').textContent = title;
  loadQuestions();
}

// ---- D/Y Havuzu (tf_pool) için konu ağacı — renderTopicTree/selectTopic'in
// bir kopyası, sadece kendi state'ine (currentTfPoolTopicId, tfPoolCounts)
// ve kendi yükleme fonksiyonuna (loadTfPool) bağlanıyor. Sorular sekmesinin
// davranışına dokunmamak için mevcut fonksiyonlar değiştirilmedi, ayrı
// bir kopya yazıldı. ----
function renderTfPoolTopicTree() {
  const panel = document.getElementById('sidePanel');
  const byCategory = window.__byCategory || {};

  if (!categoriesCache.length) {
    panel.innerHTML = '<div class="empty-state">Henüz kategori yok.</div>';
    return;
  }

  panel.innerHTML = '';
  categoriesCache.forEach(cat => {
    const block = document.createElement('div');
    block.className = 'cat-block';
    const title = document.createElement('div');
    title.className = 'cat-title';
    title.textContent = cat.title;
    block.appendChild(title);

    function buildNode(list, depth, parentContainer) {
      (list || []).forEach(t => {
        const hasChildren = childrenByParent[t.id] && childrenByParent[t.id].length > 0;

        const wrapper = document.createElement('div');
        wrapper.className = `tree-node-wrapper${collapsedTopicIds.has(t.id) ? ' collapsed' : ''}`;

        const node = document.createElement('div');
        node.className = `tree-node depth-${depth}${t.id === currentTfPoolTopicId ? ' active' : ''}`;
        node.dataset.topicId = t.id;

        const iconHtml = hasChildren
          ? `<span class="toggle-icon">▼</span>`
          : `<span class="toggle-spacer"></span>`;

        // NOT: bu rozet Sorular sekmesindekinin aksine SADECE bu konuya
        // doğrudan bağlı ifade sayısı — alt konuları toplamıyor (v1 basitleştirmesi).
        const displayCount = tfPoolCounts[t.id] || 0;
        node.innerHTML = `${iconHtml}<span class="node-title">${escapeHtml(t.title)}</span>${displayCount > 0 ? `<span class="qcount">${displayCount}</span>` : ''}`;

        node.addEventListener('click', (e) => {
          if (e.target.classList.contains('toggle-icon')) {
            e.stopPropagation();
            wrapper.classList.toggle('collapsed');
            if (wrapper.classList.contains('collapsed')) collapsedTopicIds.add(t.id);
            else collapsedTopicIds.delete(t.id);
          }
          selectTopicForTfPool(t.id, t.title);
        });

        wrapper.appendChild(node);

        if (hasChildren) {
          const childrenContainer = document.createElement('div');
          childrenContainer.className = 'tree-children';
          buildNode(childrenByParent[t.id], depth + 1, childrenContainer);
          wrapper.appendChild(childrenContainer);
        }

        parentContainer.appendChild(wrapper);
      });
    }

    buildNode(byCategory[cat.id], 0, block);
    panel.appendChild(block);
  });
}

function selectTopicForTfPool(topicId, title) {
  currentTfPoolTopicId = topicId;
  currentTfPoolTopicTitle = title;
  tfPoolSelectMode = false;
  selectedTfPoolIds.clear();
  document.querySelectorAll('.tree-node').forEach(n => n.classList.toggle('active', n.dataset.topicId === topicId));
  document.getElementById('mainTitle').textContent = title;
  loadTfPool();
}

// tf_pool'daki konu başına ifade sayısını veritabanı tarafında (GROUP BY ile)
// hesaplar. ÖNEMLİ: önceden burada `select('topic_id')` ile TÜM satırlar
// çekilip JS'te sayılıyordu — tf_pool 1000 satırı (PostgREST'in varsayılan
// satır limiti) geçtiğinde bu sorgu sessizce kesiliyor ve sayımlar yanlış
// çıkıyordu (ör. Protokol Kuralları'nda 264 kayıt varken rozette "1"
// görünmesi). get_tf_pool_topic_counts() RPC'si satır limitinden etkilenmez.
async function loadTfPoolCounts() {
  const { data, error } = await supabaseClient.rpc('get_tf_pool_topic_counts');
  if (error) { console.warn('[tfPool] sayım yüklenemedi:', error.message); tfPoolCounts = {}; return; }
  const counts = {};
  (data || []).forEach(row => {
    if (!row.topic_id) return;
    counts[row.topic_id] = row.count;
  });
  tfPoolCounts = counts;
}

// ========================= 4) Sorular listesi =========================
async function loadQuestions() {
  const contentEl = document.getElementById('content');
  contentEl.innerHTML = '<div class="empty-state">Yükleniyor…</div>';

  // DÜZELTME: bir konu seçildiğinde artık sadece o konuya DOĞRUDAN bağlı sorular
  // değil, altındaki tüm alt konulara (bölümlere) ait sorular da gösteriliyor.
  // Önceden alt konusu olan üst konulara tıklandığında liste hep boş görünüyordu,
  // çünkü sorular genelde en alttaki (leaf) alt konulara ekleniyor.
  const topicIds = collectDescendantTopicIds(currentTopicId);

  const { data: questions, error } = await supabaseClient
    .from('questions')
    .select('id,prompt,options,answer_index,explanation,sort_order,topic_id')
    .in('topic_id', topicIds)
    .order('sort_order');

  if (error) {
    contentEl.innerHTML = `<div class="empty-state">Sorular yüklenemedi: ${escapeHtml(error.message)}</div>`;
    return;
  }

  currentQuestionsCache = questions || [];
  // artık var olmayan sorular seçili kalmasın
  const validIds = new Set(currentQuestionsCache.map(q => q.id));
  selectedQuestionIds.forEach(id => { if (!validIds.has(id)) selectedQuestionIds.delete(id); });

  // Sol ağaçtaki rozet, questions tablosuna canlı sorgu atmak yerine bu cache'den
  // beslendiği için, bu konunun alt ağacı için sayıları burada güncelleyip
  // (önce bu alt ağacı sıfırlayıp gerçek dağılımla dolduruyoruz, sonra toplamları
  // yeniden hesaplıyoruz) ağacı yeniden çiziyoruz.
  if (currentTopicId) {
    topicIds.forEach(id => { actualQuestionCounts[id] = 0; });
    currentQuestionsCache.forEach(q => {
      actualQuestionCounts[q.topic_id] = (actualQuestionCounts[q.topic_id] || 0) + 1;
    });
    computeAggregatedCounts();
    renderTopicTree();
  }

  document.getElementById('mainSub').textContent = `${currentQuestionsCache.length} soru`;

  renderQuestionsTable();
}

// Telegram üzerinden gelen soru bildirimlerinde (veya başka bir kaynaktan)
// elde edilen soru ID'siyle direkt o soruyu bulup düzenleme modalını açar.
// Tam ID eşleşmesi bulunamazsa, ID içinde geçen sorular arasında ilk eşleşeni
// açar (parça ID yapıştırılmış olma ihtimaline karşı).
async function searchQuestionById(rawId) {
  const id = rawId.trim();
  const searchBtn = document.getElementById('questionIdSearchBtn');
  if (searchBtn) { searchBtn.disabled = true; searchBtn.textContent = 'Aranıyor…'; }

  const { data: exactMatch, error } = await supabaseClient
    .from('questions')
    .select('id,prompt,options,answer_index,explanation,sort_order,topic_id')
    .eq('id', id)
    .maybeSingle();

  let question = exactMatch;

  if (!question && !error) {
    const { data: partialMatches } = await supabaseClient
      .from('questions')
      .select('id,prompt,options,answer_index,explanation,sort_order,topic_id')
      .ilike('id', `%${id}%`)
      .limit(1);
    question = (partialMatches && partialMatches[0]) || null;
  }

  if (searchBtn) { searchBtn.disabled = false; searchBtn.textContent = 'Bul'; }

  if (error) {
    showToast('Arama sırasında hata oluştu: ' + error.message, true);
    return;
  }
  if (!question) {
    showToast(`"${id}" ile eşleşen bir soru bulunamadı.`, true);
    return;
  }

  const topic = topicsById[question.topic_id];
  const topicTitle = topic ? topic.title : question.topic_id;

  // İlgili konuyu seç, listeyi o bağlamda göster, sonra soruyu doğrudan
  // düzenleme modalında aç.
  selectTopic(question.topic_id, topicTitle);
  openQuestionModal(question);

  const searchInput = document.getElementById('questionIdSearch');
  if (searchInput) searchInput.value = '';
}

function toggleSelectMode() {
  selectMode = !selectMode;
  if (!selectMode) selectedQuestionIds.clear();
  renderQuestionsTable();
}

function renderQuestionsTable() {
  const contentEl = document.getElementById('content');
  const questions = currentQuestionsCache;
  const selectBtn = document.getElementById('selectQuestionsBtn');
  if (selectBtn) {
    selectBtn.textContent = selectMode ? 'Seçimi Bitir' : 'Soruları Seç';
    selectBtn.classList.toggle('secondary', !selectMode);
  }

  if (!questions.length) {
    contentEl.innerHTML = currentTopicId
      ? '<div class="empty-state">Bu konuda henüz soru yok. "Yeni Soru" ile ekleyin.</div>'
      : '<div class="empty-state">Soldan bir konu seçerek sorularını görüntüleyin.</div>';
    return;
  }

  contentEl.innerHTML = '';

  if (selectMode) contentEl.appendChild(buildBulkBar());

  // Seçili konunun doğrudan alt konuları varsa, hangi sorunun hangi alt konuya
  // ait olduğunu görebilmek için tabloya bir "Alt Konu" sütunu ekliyoruz.
  const hasChildTopics = (childrenByParent[currentTopicId] || []).length > 0;

  const table = document.createElement('table');
  table.className = 'q-table';
  table.innerHTML = `
    <thead><tr>
      ${selectMode ? '<th class="q-check"><input type="checkbox" id="selectAllCheck"></th>' : ''}
      <th style="width:${selectMode ? '34%' : '38%'}">Soru</th>
      <th style="width:30%">Şıklar</th>
      ${hasChildTopics ? '<th style="width:14%">Alt Konu</th>' : ''}
      <th></th>
    </tr></thead>
    <tbody></tbody>`;
  const tbody = table.querySelector('tbody');

  questions.forEach(q => {
    const tr = document.createElement('tr');
    tr.classList.toggle('selected', selectedQuestionIds.has(q.id));
    const optionsHtml = (q.options || []).map((opt, i) =>
      `<div class="${i === q.answer_index ? 'correct' : ''}">${i === q.answer_index ? '✓ ' : ''}${escapeHtml(opt)}</div>`
    ).join('');
    const subtopicTitle = hasChildTopics ? ((topicsById[q.topic_id] && topicsById[q.topic_id].title) || '') : '';
    tr.innerHTML = `
      ${selectMode ? `<td class="q-check"><input type="checkbox" class="row-check" ${selectedQuestionIds.has(q.id) ? 'checked' : ''}></td>` : ''}
      <td class="q-prompt">${escapeHtml(q.prompt)}</td>
      <td class="q-options">${optionsHtml}</td>
      ${hasChildTopics ? `<td style="font-size:12px;color:var(--muted);">${escapeHtml(subtopicTitle)}</td>` : ''}
      <td class="row-actions">
        <button type="button" class="edit">Düzenle</button>
        <button type="button" class="del">Sil</button>
      </td>`;
    tr.querySelector('.edit').addEventListener('click', () => openQuestionModal(q));
    tr.querySelector('.del').addEventListener('click', () => deleteQuestion(q.id));
    if (selectMode) {
      tr.querySelector('.row-check').addEventListener('change', (e) => {
        if (e.target.checked) selectedQuestionIds.add(q.id); else selectedQuestionIds.delete(q.id);
        tr.classList.toggle('selected', e.target.checked);
        updateBulkBar();
      });
    }
    tbody.appendChild(tr);
  });

  appendResponsiveTable(contentEl, table);

  if (selectMode) {
    const selectAll = document.getElementById('selectAllCheck');
    selectAll.checked = questions.length > 0 && selectedQuestionIds.size === questions.length;
    selectAll.addEventListener('change', (e) => {
      if (e.target.checked) questions.forEach(q => selectedQuestionIds.add(q.id));
      else selectedQuestionIds.clear();
      renderQuestionsTable();
    });
  }
}

async function deleteQuestion(id) {
  if (!confirm('Bu soruyu silmek istediğinize emin misiniz?')) return;
  const { error } = await supabaseClient.from('questions').delete().eq('id', id);
  if (error) { showToast('Silinemedi: ' + error.message, true); return; }
  loadQuestions();
}

// ========================= 4b) Toplu seçim çubuğu =========================
function buildBulkBar() {
  const bar = document.createElement('div');
  bar.className = 'bulk-bar';
  bar.id = 'bulkBar';
  bar.innerHTML = `
    <label class="select-all"><input type="checkbox" id="bulkBarSelectAll"> Tümünü seç</label>
    <span class="bulk-count" id="bulkCount"></span>
    <div class="bulk-bar-actions">
      <button type="button" class="danger" id="bulkDeleteBtn">Seçileni Sil</button>
      <span class="bulk-sep"></span>
      <button type="button" id="bulkExportExcel">Excel</button>
      <button type="button" id="bulkExportPdf">PDF</button>
      <button type="button" id="bulkExportWord">Word</button>
    </div>`;

  bar.querySelector('#bulkBarSelectAll').addEventListener('change', (e) => {
    if (e.target.checked) currentQuestionsCache.forEach(q => selectedQuestionIds.add(q.id));
    else selectedQuestionIds.clear();
    renderQuestionsTable();
  });
  bar.querySelector('#bulkDeleteBtn').addEventListener('click', bulkDeleteQuestions);
  bar.querySelector('#bulkExportExcel').addEventListener('click', () => exportQuestionsExcel(getExportQuestions()));
  bar.querySelector('#bulkExportPdf').addEventListener('click', () => exportQuestionsPDF(getExportQuestions()));
  bar.querySelector('#bulkExportWord').addEventListener('click', () => exportQuestionsWord(getExportQuestions()));

  queueMicrotask(updateBulkBar);
  return bar;
}

function updateBulkBar() {
  const bar = document.getElementById('bulkBar');
  if (!bar) return;
  const n = selectedQuestionIds.size;
  const total = currentQuestionsCache.length;
  bar.querySelector('#bulkCount').textContent = n > 0 ? `${n} / ${total} seçili` : `Hiçbir soru seçilmedi — dışa aktarma tüm listeyi (${total} soru) kapsar`;
  bar.querySelector('#bulkDeleteBtn').disabled = n === 0;
  const selectAll = bar.querySelector('#bulkBarSelectAll');
  if (selectAll) selectAll.checked = total > 0 && n === total;
}

// Seçili sorular varsa onları, yoksa ekrandaki tüm listeyi döndürür.
function getExportQuestions() {
  if (selectedQuestionIds.size > 0) {
    return currentQuestionsCache.filter(q => selectedQuestionIds.has(q.id));
  }
  return currentQuestionsCache;
}

async function bulkDeleteQuestions() {
  const ids = Array.from(selectedQuestionIds);
  if (!ids.length) return;
  if (!confirm(`${ids.length} soruyu kalıcı olarak silmek istediğinize emin misiniz?`)) return;

  // Çok sayıda ID'yi tek istekte .in() ile göndermek URL'i çok uzatıp
  // "Bad Request" hatasına yol açabiliyor (özellikle Tümünü Seç ile
  // yüzlerce soru seçildiğinde). Bu yüzden parça parça (100'erli) siliyoruz.
  const BATCH_SIZE = 100;
  const saveBtn = document.getElementById('bulkDeleteBtn');
  if (saveBtn) saveBtn.disabled = true;

  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const batch = ids.slice(i, i + BATCH_SIZE);
    const { error } = await supabaseClient.from('questions').delete().in('id', batch);
    if (error) {
      showToast(`Silinemedi (${i} / ${ids.length} sonrası): ` + error.message, true);
      if (saveBtn) saveBtn.disabled = false;
      loadQuestions();
      return;
    }
  }

  if (saveBtn) saveBtn.disabled = false;
  selectedQuestionIds.clear();
  loadQuestions();
}

// ========================= 4c) Dışa aktarma: Excel / PDF / Word =========================
// titleOverride: Sorular sekmesinde çağrılırken verilmez (mevcut davranış: seçili konu
// başlığını kullanır). Manuel Havuz sekmesi kadro adını buraya kendi geçirir — böylece
// aynı Excel/PDF/Word üretim kodu iki sekme arasında da tekrar yazılmadan paylaşılıyor.
function reportBaseName(titleOverride) {
  const topicPart = slugify(titleOverride || currentTopicTitle || 'sorular');
  const datePart = new Date().toISOString().slice(0, 10);
  return `${topicPart}-rapor-${datePart}`;
}

function answerLetter(i) { return ['A', 'B', 'C', 'D', 'E', 'F'][i] || ''; }

function exportQuestionsExcel(questions, titleOverride) {
  if (!questions.length) { showToast('Dışa aktarılacak soru yok.', true); return; }
  const rows = [['No', 'Soru', 'Şık A', 'Şık B', 'Şık C', 'Şık D', 'Şık E', 'Doğru Şık', 'Açıklama']];
  questions.forEach((q, i) => {
    const opts = q.options || [];
    rows.push([
      i + 1,
      q.prompt || '',
      opts[0] || '', opts[1] || '', opts[2] || '', opts[3] || '', opts[4] || '',
      answerLetter(q.answer_index),
      q.explanation || ''
    ]);
  });
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{ wch: 5 }, { wch: 50 }, { wch: 22 }, { wch: 22 }, { wch: 22 }, { wch: 22 }, { wch: 22 }, { wch: 10 }, { wch: 30 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sorular');
  XLSX.writeFile(wb, `${reportBaseName(titleOverride)}.xlsx`);
}

// Rapor için ortak, gizli bir HTML bloğu üretir (PDF ve Word'de aynı görünüm kullanılır).
function buildReportHtml(questions, titleOverride) {
  const title = titleOverride || currentTopicTitle || 'Sorular';
  const dateStr = new Date().toLocaleDateString('tr-TR');
  const items = questions.map((q, i) => {
    const opts = (q.options || []).map((opt, oi) => {
      const isCorrect = oi === q.answer_index;
      return `<div style="padding:3px 0; ${isCorrect ? 'color:#2E6B4C; font-weight:600;' : 'color:#3a3a3a;'}">${isCorrect ? '✓ ' : answerLetter(oi) + ') '}${escapeHtml(opt)}</div>`;
    }).join('');
    const explanation = q.explanation
      ? `<div style="margin-top:6px; font-size:12.5px; color:#6b6b6b;"><b>Açıklama:</b> ${escapeHtml(q.explanation)}</div>` : '';
    return `
      <div style="margin-bottom:18px; padding-bottom:14px; border-bottom:1px solid #ddd;">
        <div style="font-weight:700; font-size:14.5px; margin-bottom:6px;">${i + 1}. ${escapeHtml(q.prompt)}</div>
        <div style="font-size:13px; padding-left:6px;">${opts}</div>
        ${explanation}
      </div>`;
  }).join('');

  return `
    <div style="font-family: Calibri, Arial, sans-serif; color:#201D17; width:720px; padding:24px;">
      <div style="border-bottom:2px solid #A9843F; padding-bottom:10px; margin-bottom:18px;">
        <div style="font-size:19px; font-weight:700;">SınavRotası — Soru Raporu</div>
        <div style="font-size:12.5px; color:#7A7462; margin-top:4px;">${escapeHtml(title)} • ${questions.length} soru • ${dateStr}</div>
      </div>
      ${items}
    </div>`;
}

async function exportQuestionsPDF(questions, titleOverride) {
  if (!questions.length) { showToast('Dışa aktarılacak soru yok.', true); return; }
  if (!window.html2canvas || !window.jspdf) { showToast('PDF kütüphaneleri yüklenemedi. İnternet bağlantınızı kontrol edin.', true); return; }

  const container = document.createElement('div');
  container.style.position = 'fixed';
  container.style.top = '0';
  container.style.left = '-9999px';
  container.style.background = '#ffffff';
  container.innerHTML = buildReportHtml(questions, titleOverride);
  document.body.appendChild(container);

  try {
    const canvas = await html2canvas(container, { scale: 2, backgroundColor: '#ffffff' });
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF('p', 'mm', 'a4');
    const pageWidth = 210, pageHeight = 297, margin = 10;
    const imgWidth = pageWidth - margin * 2;
    const imgHeight = (canvas.height * imgWidth) / canvas.width;
    const usableHeight = pageHeight - margin * 2;

    let heightLeft = imgHeight;
    let position = margin;
    const imgData = canvas.toDataURL('image/png');

    doc.addImage(imgData, 'PNG', margin, position, imgWidth, imgHeight);
    heightLeft -= usableHeight;

    while (heightLeft > 0) {
      position = margin - (imgHeight - heightLeft);
      doc.addPage();
      doc.addImage(imgData, 'PNG', margin, position, imgWidth, imgHeight);
      heightLeft -= usableHeight;
    }

    doc.save(`${reportBaseName(titleOverride)}.pdf`);
  } catch (err) {
    showToast('PDF oluşturulamadı: ' + err.message, true);
  } finally {
    document.body.removeChild(container);
  }
}

function exportQuestionsWord(questions, titleOverride) {
  if (!questions.length) { showToast('Dışa aktarılacak soru yok.', true); return; }
  const bodyHtml = buildReportHtml(questions, titleOverride);
  const html = `<!DOCTYPE html>
    <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
    <head><meta charset="utf-8"><title>SınavRotası Rapor</title></head>
    <body>${bodyHtml}</body></html>`;
  const blob = new Blob(['\ufeff', html], { type: 'application/msword;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${reportBaseName(titleOverride)}.doc`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ========================= 5) Soru ekle/düzenle modalı =========================
const modalBackdrop = document.getElementById('modalBackdrop');
const questionForm = document.getElementById('questionForm');
const formError = document.getElementById('formError');
const fTopicSelect = document.getElementById('fTopic');
const fSubtopicField = document.getElementById('fSubtopicField');
const fSubtopicSelect = document.getElementById('fSubtopic');
const fOptionsContainer = document.getElementById('fOptionsContainer');
const fAddOptionBtn = document.getElementById('fAddOptionBtn');
const MIN_OPTIONS = 2;
const MAX_OPTIONS = 6; // toplu Excel/JSON içe aktarma da en fazla 6 şıka (A-F) kadar destekliyor

document.getElementById('modalCancelBtn').addEventListener('click', closeQuestionModal);
modalBackdrop.addEventListener('click', (e) => { if (e.target === modalBackdrop) closeQuestionModal(); });

// DÜZELTME: "Soru Ekle/Düzenle" modalındaki KONU alanı artık, Toplu Soru Ekle
// modalındakiyle aynı iki kademeli mantığı kullanıyor: fTopic sadece kök konuları
// (her kategorinin üst düzey konu/belgelerini) listeler; kökün alt konuları varsa
// ikinci bir "Alt konu / bölüm" seçimi açılır. Böylece 30+ satırlık tek bir uzun
// flat liste yerine, iki kısa ve sade seçim kutusu gösterilir.
function populateFormTopicRoots(selectedRootId) {
  const byCategory = window.__byCategory || {};
  fTopicSelect.innerHTML = categoriesCache.map(cat => {
    const roots = byCategory[cat.id] || [];
    if (!roots.length) return '';
    const opts = roots.map(t => `<option value="${t.id}">${escapeHtml(t.title)}</option>`).join('');
    return `<optgroup label="${escapeHtml(cat.title)}">${opts}</optgroup>`;
  }).join('');
  if (selectedRootId) fTopicSelect.value = selectedRootId;
}

function populateFormSubtopics(rootId) {
  const children = childrenByParent[rootId] || [];
  if (!children.length) {
    fSubtopicField.style.display = 'none';
    fSubtopicSelect.innerHTML = '';
    return;
  }
  fSubtopicSelect.innerHTML = children.map(t => `<option value="${t.id}">${escapeHtml(t.title)}</option>`).join('');
  fSubtopicField.style.display = '';
}

function selectedFormTopicId() {
  return (fSubtopicField.style.display !== 'none' && fSubtopicSelect.value) ? fSubtopicSelect.value : fTopicSelect.value;
}

fTopicSelect.addEventListener('change', () => populateFormSubtopics(fTopicSelect.value));

// DÜZELTME: Şık sayısı artık sabit 4 değil, dinamik (min 2, max 6). Soru kaçtane
// şıka sahipse düzenlerken o kadar satır gösterilir; yeni soru eklerken varsayılan
// olarak 4 boş satırla başlanır ve "+ Şık Ekle" / satır başındaki "×" ile
// çoğaltılıp azaltılabilir.
function renderOptionRows(options, correctIndex) {
  fOptionsContainer.innerHTML = '';
  options.forEach((val, i) => addOptionRow(val, i === correctIndex));
  refreshOptionLabels();
}

function addOptionRow(value = '', checked = false) {
  const rows = fOptionsContainer.querySelectorAll('.option-row');
  if (rows.length >= MAX_OPTIONS) return;
  const index = rows.length;
  const row = document.createElement('div');
  row.className = 'option-row';
  row.innerHTML = `
    <input type="radio" name="fCorrect" value="${index}" ${checked ? 'checked' : ''}>
    <input type="text" class="fOpt" required placeholder="Şık">
    <button type="button" class="opt-remove" title="Şıkkı kaldır">×</button>
  `;
  row.querySelector('.fOpt').value = value;
  row.querySelector('.opt-remove').addEventListener('click', () => removeOptionRow(row));
  fOptionsContainer.appendChild(row);
  refreshOptionLabels();
}

function removeOptionRow(row) {
  const rows = fOptionsContainer.querySelectorAll('.option-row');
  if (rows.length <= MIN_OPTIONS) return; // en az 2 şık kalmalı
  const wasChecked = row.querySelector('input[type=radio]').checked;
  row.remove();
  refreshOptionLabels();
  if (wasChecked) {
    const first = fOptionsContainer.querySelector('input[type=radio]');
    if (first) first.checked = true;
  }
}

// Satır sırası değiştikçe (ekleme/kaldırma) radio value'larını 0..n-1 olacak
// şekilde yeniden numaralandırır, placeholder'ları A/B/C... ile günceller ve
// "+ Şık Ekle" / "×" butonlarının aktif/pasif durumunu ayarlar.
function refreshOptionLabels() {
  const rows = fOptionsContainer.querySelectorAll('.option-row');
  rows.forEach((row, i) => {
    row.querySelector('input[type=radio]').value = i;
    row.querySelector('.fOpt').placeholder = `${String.fromCharCode(65 + i)} şıkkı`;
    row.querySelector('.opt-remove').disabled = rows.length <= MIN_OPTIONS;
  });
  fAddOptionBtn.disabled = rows.length >= MAX_OPTIONS;
}

fAddOptionBtn.addEventListener('click', () => addOptionRow());

let editingQuestionTopicId = null;       // düzenlenen sorunun kaydedilmeden önceki konusu (A-06)

function openQuestionModal(question) {
  editingQuestionId = question ? question.id : null;
  editingQuestionTopicId = question ? question.topic_id || null : null;
  document.getElementById('modalTitle').textContent = question ? 'Soruyu Düzenle' : 'Yeni Soru';
  formError.classList.remove('show');

  // DÜZELTME: düzenlerken sorunun kendi topic_id'sini kullan, currentTopicId'i değil.
  // Böylece bu modal ileride "tüm sorular" gibi farklı bir listeden çağrılsa bile
  // yanlış konuyu seçili göstermez. Konu bir alt konu (section) ise, önce üst
  // konuyu (kökü) sonra alt konuyu seçili getiriyoruz.
  const targetTopicId = question ? question.topic_id : (currentTopicId || (topicOptionsFlat[0] && topicOptionsFlat[0].id));
  const targetTopic = targetTopicId ? topicsById[targetTopicId] : null;
  const rootId = targetTopic && targetTopic.parent_id ? targetTopic.parent_id : targetTopicId;

  populateFormTopicRoots(rootId);
  populateFormSubtopics(rootId);
  if (targetTopic && targetTopic.parent_id) fSubtopicSelect.value = targetTopic.id;

  document.getElementById('fPrompt').value = question?.prompt || '';
  document.getElementById('fExplanation').value = question?.explanation || '';
  const existingOptions = question?.options?.length ? question.options : ['', '', '', ''];
  const correctIndex = question?.answer_index ?? 0;
  renderOptionRows(existingOptions, correctIndex);

  modalBackdrop.classList.add('open');
  document.getElementById('fPrompt').focus();
}

function closeQuestionModal() {
  modalBackdrop.classList.remove('open');
  questionForm.reset();
  fSubtopicField.style.display = 'none';
  editingQuestionId = null;
}

questionForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  formError.classList.remove('show');

  const topicId = selectedFormTopicId();
  const prompt = document.getElementById('fPrompt').value.trim();
  const options = Array.from(fOptionsContainer.querySelectorAll('.fOpt')).map(el => el.value.trim());
  const explanation = document.getElementById('fExplanation').value.trim();
  const answerIndex = Number(questionForm.querySelector('input[name=fCorrect]:checked').value);

  if (!topicId || !prompt || options.length < MIN_OPTIONS || options.some(o => !o)) {
    formError.textContent = 'Konu, soru metni ve tüm şıklar zorunludur.';
    formError.classList.add('show');
    return;
  }

  const saveBtn = document.getElementById('modalSaveBtn');
  saveBtn.disabled = true;
  saveBtn.textContent = 'Kaydediliyor…';

  let error;
  let affected = [];
  try {
    if (editingQuestionId) {
      const payload = { topic_id: topicId, prompt, options, answer_index: answerIndex, explanation: explanation || null };
      // Konu değiştiyse soruyu yeni konunun sonuna al.
      const previousTopicId = editingQuestionTopicId;
      if (previousTopicId && previousTopicId !== topicId) payload.sort_order = await nextQuestionSortOrder(topicId);
      ({ data: affected, error } = await supabaseClient
        .from('questions')
        .update(payload)
        .eq('id', editingQuestionId)
        .select('id'));
    } else {
      const id = `${topicId}-${Date.now().toString(36)}`;
      const sortOrder = await nextQuestionSortOrder(topicId);
      ({ data: affected, error } = await supabaseClient
        .from('questions')
        .insert({ id, topic_id: topicId, prompt, options, answer_index: answerIndex, explanation: explanation || null, sort_order: sortOrder })
        .select('id'));
    }
  } catch (err) {
    error = err;
  }
  // A-07: RLS reddi hata döndürmeden 0 satır etkileyebilir.
  if (!error && (!affected || affected.length === 0)) {
    error = { message: 'Hiçbir kayıt güncellenmedi (yetki ya da kayıt bulunamadı).' };
  }

  saveBtn.disabled = false;
  saveBtn.textContent = 'Kaydet';

  if (error) {
    formError.textContent = 'Kaydedilemedi: ' + error.message;
    formError.classList.add('show');
    return;
  }

  closeQuestionModal();
  const topic = topicsById[topicId];
  // Kaydedilen soru, o an ekranda açık olan konunun alt ağacına dahilse (aynı
  // konu ya da onun bir alt konusuysa), o konunun bağlamında kal; değilse
  // sorunun asıl ait olduğu konuyu aç. Böylece "Yönetimde Etik" (üst) açıkken
  // bir alt konuya soru eklenirse, ekran üst konuda kalıp yeni soruyu da gösterir.
  if (currentTopicId && collectDescendantTopicIds(currentTopicId).includes(topicId)) {
    loadQuestions();
  } else {
    selectTopic(topicId, topic ? topic.title : currentTopicTitle);
  }
});

// ========================= 5b) Toplu soru ekleme modalı =========================
const bulkModalBackdrop = document.getElementById('bulkModalBackdrop');
const bulkForm = document.getElementById('bulkForm');
const bulkError = document.getElementById('bulkError');
const bTopicSelect = document.getElementById('bTopic');
const bSubtopicField = document.getElementById('bSubtopicField');
const bSubtopicSelect = document.getElementById('bSubtopic');
const bJsonInput = document.getElementById('bJson');
const bFileInput = document.getElementById('bFile');

document.getElementById('bulkModalCancelBtn').addEventListener('click', closeBulkModal);
bulkModalBackdrop.addEventListener('click', (e) => { if (e.target === bulkModalBackdrop) closeBulkModal(); });
document.getElementById('bulkTemplateLink').addEventListener('click', (e) => { e.preventDefault(); downloadBulkTemplate(); });
bTopicSelect.addEventListener('change', () => populateBulkSubtopics(bTopicSelect.value));

// bTopic: sadece kök konular (her kategorinin altındaki üst düzey topic/document'lar), kategoriye göre gruplu.
// bSubtopic: seçilen kök konunun varsa doğrudan alt konuları (bölümler). Yoksa alan gizlenir.
function populateBulkTopicRoots(selectedRootId) {
  const byCategory = window.__byCategory || {};
  bTopicSelect.innerHTML = categoriesCache.map(cat => {
    const roots = byCategory[cat.id] || [];
    if (!roots.length) return '';
    const opts = roots.map(t => `<option value="${t.id}">${escapeHtml(t.title)}</option>`).join('');
    return `<optgroup label="${escapeHtml(cat.title)}">${opts}</optgroup>`;
  }).join('');
  if (selectedRootId) bTopicSelect.value = selectedRootId;
}

function populateBulkSubtopics(rootId) {
  const children = childrenByParent[rootId] || [];
  if (!children.length) {
    bSubtopicField.style.display = 'none';
    bSubtopicSelect.innerHTML = '';
    return;
  }
  bSubtopicSelect.innerHTML = children.map(t => `<option value="${t.id}">${escapeHtml(t.title)}</option>`).join('');
  bSubtopicField.style.display = '';
}

function openBulkModal() {
  bulkError.classList.remove('show');
  bJsonInput.value = '';
  bFileInput.value = '';

  // Şu an seçili konu bir alt bölümse (parent_id var), önce üst konuyu, sonra alt konuyu seçili getir.
  const current = currentTopicId ? topicsById[currentTopicId] : null;
  const rootId = current && current.parent_id ? current.parent_id : currentTopicId;

  populateBulkTopicRoots(rootId);
  populateBulkSubtopics(bTopicSelect.value);
  if (current && current.parent_id) bSubtopicSelect.value = current.id;

  bulkModalBackdrop.classList.add('open');
}

function closeBulkModal() {
  bulkModalBackdrop.classList.remove('open');
  bulkForm.reset();
  bSubtopicField.style.display = 'none';
}

function selectedBulkTopicId() {
  return (bSubtopicField.style.display !== 'none' && bSubtopicSelect.value) ? bSubtopicSelect.value : bTopicSelect.value;
}


// Excel şablonunu tarayıcıda oluşturup indirir (SheetJS).
function downloadBulkTemplate() {
  const rows = [
    ['Soru', 'Şık A', 'Şık B', 'Şık C', 'Şık D', 'Şık E', 'Doğru Şık', 'Açıklama'],
    ['657 sayılı DMK kaç yılında kabul edilmiştir?', '1965', '1970', '1975', '1980', '', 'A', 'Opsiyonel açıklama buraya yazılabilir.']
  ];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{ wch: 50 }, { wch: 20 }, { wch: 20 }, { wch: 20 }, { wch: 20 }, { wch: 20 }, { wch: 10 }, { wch: 30 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sorular');
  XLSX.writeFile(wb, 'soru-sablonu.xlsx');
}

const ANSWER_LETTER_MAP = { A: 0, B: 1, C: 2, D: 3, E: 4, F: 5 };

// A-06 (2026-09-15): Yeni sorulara konu içinde bir sonraki sıra numarası
// verilir. Önceden sort_order hiç atanmıyor, varsayılan 0 kalıyordu; bu hem
// sıralamayı belirsiz yapıyor hem de "ilk N soru" mantıklarını bozuyordu.
async function nextQuestionSortOrder(topicId) {
  const { data, error } = await supabaseClient
    .from('questions')
    .select('sort_order')
    .eq('topic_id', topicId)
    .order('sort_order', { ascending: false })
    .limit(1);
  if (error) throw error;
  const max = Number(data?.[0]?.sort_order);
  return Number.isFinite(max) ? max + 1 : 1;
}

// A-05 (2026-09-15): Excel'de "Doğru Şık" yalnızca harf (A, B, C…) kabul eder.
// Önceden sayılar 0 tabanlı yorumlanıyordu (1 = B); 1-4 yazan biri tüm
// cevapları sessizce bir şık kaydırıyordu.
function answerToIndex(raw, optionCount) {
  const v = String(raw ?? '').trim().toUpperCase();
  if (v === '') return NaN;
  if (v in ANSWER_LETTER_MAP) return ANSWER_LETTER_MAP[v];
  return NaN;
}

// Excel/CSV dosyasını okuyup soru satırlarına çevirir.
// Beklenen sütunlar: Soru, Şık A, Şık B, Şık C, Şık D, Şık E (opsiyonel), Doğru Şık, Açıklama
function excelRowsToQuestions(sheetRows, topicId) {
  if (!sheetRows.length) throw new Error('Excel dosyasında veri satırı bulunamadı.');

  return sheetRows.map((row, i) => {
    const n = i + 2; // 1. satır başlık, veri Excel'de 2. satırdan başlar
    const prompt = String(row['Soru'] || '').trim();
    // NOT: önceden burada boş şıklar .filter() ile diziden tamamen çıkarılıyordu.
    // Bu, ORTADA bir şık boş bırakıldığında (ör. Şık B boş ama Şık C/D dolu)
    // sondaki şıkları öne kaydırıp "Doğru Şık" harfinin işaret ettiği index'i
    // kaydırıyordu — sonuçta yanlış şık sessizce "doğru" olarak kaydediliyordu.
    // Artık sadece SONDAKİ ardışık boşluklar kırpılıyor; aradaki bir boşluk
    // artık kayma yaratmak yerine açıkça hata veriyor.
    let options = ['Şık A', 'Şık B', 'Şık C', 'Şık D', 'Şık E', 'Şık F']
      .map(k => (row[k] != null ? String(row[k]).trim() : ''));
    while (options.length && options[options.length - 1] === '') options.pop();
    const gapIndex = options.findIndex(o => o === '');
    if (gapIndex !== -1) {
      const letters = ['A', 'B', 'C', 'D', 'E', 'F'];
      throw new Error(`Satır ${n}: "Şık ${letters[gapIndex]}" boş ama sonraki şıklar dolu — şıklar arasında boşluk bırakılamaz, A'dan itibaren sırayla doldurun.`);
    }
    const answerIndex = answerToIndex(row['Doğru Şık'], options.length);
    const explanation = row['Açıklama'] ? String(row['Açıklama']).trim() : null;

    if (!prompt) throw new Error(`Satır ${n}: "Soru" sütunu boş olamaz.`);
    if (options.length < 2) throw new Error(`Satır ${n}: en az 2 dolu şık sütunu (Şık A, Şık B, ...) gerekli.`);
    if (!Number.isInteger(answerIndex) || answerIndex < 0 || answerIndex >= options.length) {
      throw new Error(`Satır ${n}: "Doğru Şık" değeri geçersiz — A-${String.fromCharCode(65 + options.length - 1)} arasında bir HARF olmalı (sayı kabul edilmez).`);
    }

    return {
      id: `${topicId}-${Date.now().toString(36)}-${i}-${Math.random().toString(36).slice(2, 6)}`,
      topic_id: topicId,
      prompt,
      options,
      answer_index: answerIndex,
      explanation
    };
  });
}

function readExcelFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: 'array' });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
        resolve(rows);
      } catch (err) {
        reject(new Error('Dosya okunamadı: ' + err.message));
      }
    };
    reader.onerror = () => reject(new Error('Dosya okunamadı.'));
    reader.readAsArrayBuffer(file);
  });
}

// Beklenen JSON formatı (gelişmiş/opsiyonel yol), her eleman:
// { "prompt": "...", "options": ["A","B","C","D"], "answerIndex": 0, "explanation": "..." (opsiyonel) }
function parseBulkQuestionsJson(raw, topicId) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error('Geçersiz JSON: ' + e.message);
  }
  if (!Array.isArray(parsed)) throw new Error('JSON bir dizi ([...]) olmalı.');
  if (!parsed.length) throw new Error('Dizi boş.');

  return parsed.map((q, i) => {
    const n = i + 1;
    if (!q || typeof q !== 'object') throw new Error(`#${n}: geçersiz soru nesnesi.`);
    const prompt = String(q.prompt || '').trim();
    const options = Array.isArray(q.options) ? q.options.map(o => String(o).trim()) : [];
    const answerIndex = Number(q.answerIndex ?? q.answer_index);
    const explanation = q.explanation ? String(q.explanation).trim() : null;

    if (!prompt) throw new Error(`#${n}: "prompt" zorunlu.`);
    if (options.length < 2 || options.some(o => !o)) throw new Error(`#${n}: "options" en az 2 dolu şık içermeli.`);
    if (!Number.isInteger(answerIndex) || answerIndex < 0 || answerIndex >= options.length) {
      throw new Error(`#${n}: "answerIndex" geçerli bir şık indeksi olmalı (0-${options.length - 1}).`);
    }

    return {
      id: `${topicId}-${Date.now().toString(36)}-${i}-${Math.random().toString(36).slice(2, 6)}`,
      topic_id: topicId,
      prompt,
      options,
      answer_index: answerIndex,
      explanation
    };
  });
}

bulkForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  bulkError.classList.remove('show');

  const topicId = selectedBulkTopicId();
  const file = bFileInput.files[0];

  let rows;
  try {
    if (file) {
      const sheetRows = await readExcelFile(file);
      rows = excelRowsToQuestions(sheetRows, topicId);
    } else if (bJsonInput.value.trim()) {
      rows = parseBulkQuestionsJson(bJsonInput.value, topicId);
    } else {
      throw new Error('Bir Excel dosyası seçin veya JSON alanına soruları yapıştırın.');
    }
  } catch (err) {
    bulkError.textContent = err.message;
    bulkError.classList.add('show');
    return;
  }

  const saveBtn = document.getElementById('bulkModalSaveBtn');
  saveBtn.disabled = true;
  saveBtn.textContent = 'Kaydediliyor…';

  let error;
  try {
    const base = await nextQuestionSortOrder(topicId);
    rows.forEach((row, i) => { row.sort_order = base + i; });
    let inserted;
    ({ data: inserted, error } = await supabaseClient.from('questions').insert(rows).select('id'));
    if (!error && (inserted?.length || 0) !== rows.length) {
      error = { message: `Beklenen ${rows.length} sorudan ${inserted?.length || 0} tanesi kaydedildi.` };
    }
  } catch (err) {
    error = err;
  }

  saveBtn.disabled = false;
  saveBtn.textContent = 'Kaydet';

  if (error) {
    bulkError.textContent = 'Kaydedilemedi: ' + error.message;
    bulkError.classList.add('show');
    return;
  }

  const topicLabel = topicsById[topicId] ? topicsById[topicId].title : topicId;
  closeBulkModal();
  if (currentTopicId && collectDescendantTopicIds(currentTopicId).includes(topicId)) loadQuestions();
  else showToast(`${rows.length} soru "${topicLabel}" konusuna eklendi.`);
});



// ========================= 6) Konu başlığı eşleme yardımcıları =========================
// D/Y Havuzu toplu içe aktarmasında "Konu" sütununu konu kimliğine çevirir.
function normalizeTopicTitle(str) {
  return String(str || '').toLocaleLowerCase('tr-TR').replace(/i̇/g, 'i').trim().replace(/\s+/g, ' ');
}

function buildTopicTitleLookup() {
  const map = new Map();
  Object.values(topicsById).forEach(t => {
    const key = normalizeTopicTitle(t.title);
    if (!map.has(key)) map.set(key, t.id); // aynı başlık birden fazla konuda varsa ilk bulunan kullanılır
  });
  return map;
}

// rawTitle boşsa null döner (konu opsiyonel, sorun değil); doluysa eşleşen
// konunun id'sini döner ya da eşleşme yoksa hata fırlatır.
function resolveTopicIdOrThrow(rawTitle, rowLabel, lookup) {
  const trimmed = String(rawTitle || '').trim();
  if (!trimmed) return null;
  const match = lookup.get(normalizeTopicTitle(trimmed));
  if (!match) {
    throw new Error(`${rowLabel}: "Konu" sütunundaki "${trimmed}" ifadesi tanınan hiçbir konu başlığıyla eşleşmedi. Konu ağacınızdaki başlığı harfiyen (büyük/küçük harf fark etmez) kullanın ya da alanı boş bırakın.`);
  }
  return match;
}

// ========================= 7) D/Y Havuzu (tf_pool) sekmesi =========================
// Manuel Havuz'daki desenin (seç/toplu ekle/rapor al) neredeyse birebir
// tekrarı — fark: kadro değil konu bazlı, ve satır şekli prompt/options
// yerine statement/is_true/correction.

async function loadTfPool() {
  const contentEl = document.getElementById('content');
  contentEl.innerHTML = '<div class="empty-state">Yükleniyor…</div>';

  const { data, error } = await supabaseClient
    .from('tf_pool')
    .select('*')
    .eq('topic_id', currentTfPoolTopicId)
    .order('sort_order', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true });

  if (error) {
    contentEl.innerHTML = `<div class="empty-state">Yüklenemedi: ${escapeHtml(error.message)}</div>`;
    return;
  }

  tfPoolRowsCache = data || [];
  const validIds = new Set(tfPoolRowsCache.map(q => q.id));
  selectedTfPoolIds.forEach(id => { if (!validIds.has(id)) selectedTfPoolIds.delete(id); });
  document.getElementById('mainSub').textContent = `${tfPoolRowsCache.length} ifade`;
  renderTfPoolTable();
}

function toggleTfPoolSelectMode() {
  tfPoolSelectMode = !tfPoolSelectMode;
  if (!tfPoolSelectMode) selectedTfPoolIds.clear();
  renderTfPoolTable();
}

function tfPoolTitleForReport() {
  return currentTfPoolTopicTitle ? `${currentTfPoolTopicTitle} — D/Y Havuzu` : 'D/Y Havuzu';
}

function buildTfPoolBulkBar() {
  const bar = document.createElement('div');
  bar.className = 'bulk-bar';
  bar.id = 'tfPoolBulkBar';
  bar.innerHTML = `
    <label class="select-all"><input type="checkbox" id="tfPoolBulkBarSelectAll"> Tümünü seç</label>
    <span class="bulk-count" id="tfPoolBulkCount"></span>
    <div class="bulk-bar-actions">
      <button type="button" class="danger" id="tfPoolBulkDeleteBtn">Seçileni Sil</button>
      <span class="bulk-sep"></span>
      <button type="button" id="tfPoolBulkExportExcel">Excel</button>
      <button type="button" id="tfPoolBulkExportWord">Word</button>
    </div>`;

  bar.querySelector('#tfPoolBulkBarSelectAll').addEventListener('change', (e) => {
    if (e.target.checked) tfPoolRowsCache.forEach(q => selectedTfPoolIds.add(q.id));
    else selectedTfPoolIds.clear();
    renderTfPoolTable();
  });
  bar.querySelector('#tfPoolBulkDeleteBtn').addEventListener('click', bulkDeleteTfPool);
  bar.querySelector('#tfPoolBulkExportExcel').addEventListener('click', () => exportTfPoolExcel(getTfPoolExportRows(), tfPoolTitleForReport()));
  bar.querySelector('#tfPoolBulkExportWord').addEventListener('click', () => exportTfPoolWord(getTfPoolExportRows(), tfPoolTitleForReport()));

  queueMicrotask(updateTfPoolBulkBar);
  return bar;
}

function updateTfPoolBulkBar() {
  const bar = document.getElementById('tfPoolBulkBar');
  if (!bar) return;
  const n = selectedTfPoolIds.size;
  const total = tfPoolRowsCache.length;
  bar.querySelector('#tfPoolBulkCount').textContent = n > 0 ? `${n} / ${total} seçili` : `Hiçbir ifade seçilmedi — dışa aktarma tüm listeyi (${total} ifade) kapsar`;
  bar.querySelector('#tfPoolBulkDeleteBtn').disabled = n === 0;
  const selectAll = bar.querySelector('#tfPoolBulkBarSelectAll');
  if (selectAll) selectAll.checked = total > 0 && n === total;
}

function getTfPoolExportRows() {
  if (selectedTfPoolIds.size > 0) return tfPoolRowsCache.filter(q => selectedTfPoolIds.has(q.id));
  return tfPoolRowsCache;
}

async function bulkDeleteTfPool() {
  const ids = Array.from(selectedTfPoolIds);
  if (!ids.length) return;
  if (!confirm(`${ids.length} ifadeyi D/Y havuzundan kalıcı olarak silmek istediğinize emin misiniz?`)) return;

  const BATCH_SIZE = 100;
  const btn = document.getElementById('tfPoolBulkDeleteBtn');
  if (btn) btn.disabled = true;

  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const batch = ids.slice(i, i + BATCH_SIZE);
    const { error } = await supabaseClient.from('tf_pool').delete().in('id', batch);
    if (error) {
      showToast(`Silinemedi (${i} / ${ids.length} sonrası): ` + error.message, true);
      if (btn) btn.disabled = false;
      loadTfPool();
      return;
    }
  }

  if (btn) btn.disabled = false;
  selectedTfPoolIds.clear();
  loadTfPoolCounts().then(renderTfPoolTopicTree);
  loadTfPool();
}

async function deleteTfPoolItem(id) {
  if (!confirm('Bu ifadeyi silmek istediğinize emin misiniz?')) return;
  const { error } = await supabaseClient.from('tf_pool').delete().eq('id', id);
  if (error) { showToast('Silinemedi: ' + error.message, true); return; }
  loadTfPoolCounts().then(renderTfPoolTopicTree);
  loadTfPool();
}

function renderTfPoolTable() {
  const contentEl = document.getElementById('content');
  const rows = tfPoolRowsCache;
  const selectBtn = document.getElementById('selectTfPoolBtn');
  if (selectBtn) {
    selectBtn.textContent = tfPoolSelectMode ? 'Seçimi Bitir' : 'İfadeleri Seç';
    selectBtn.classList.toggle('secondary', !tfPoolSelectMode);
  }

  if (!rows.length) {
    contentEl.innerHTML = '<div class="empty-state">Bu konuda henüz D/Y ifadesi yok. "+ Yeni İfade" ile ekleyin.</div>';
    return;
  }

  contentEl.innerHTML = '';
  if (tfPoolSelectMode) contentEl.appendChild(buildTfPoolBulkBar());

  const table = document.createElement('table');
  table.className = 'q-table';
  table.innerHTML = `
    <thead><tr>
      ${tfPoolSelectMode ? '<th class="q-check"><input type="checkbox" id="tfPoolSelectAllCheck"></th>' : ''}
      <th style="width:${tfPoolSelectMode ? '44%' : '48%'}">İfade</th>
      <th style="width:10%">Doğru/Yanlış</th>
      <th style="width:26%">Düzeltme / Açıklama</th>
      <th></th>
    </tr></thead>
    <tbody></tbody>`;
  const tbody = table.querySelector('tbody');

  rows.forEach(q => {
    const tr = document.createElement('tr');
    tr.classList.toggle('selected', selectedTfPoolIds.has(q.id));
    const badge = q.is_true
      ? '<span style="color:#166534;font-weight:700;">✓ Doğru</span>'
      : '<span style="color:#991b1b;font-weight:700;">✕ Yanlış</span>';
    const sideText = [q.correction, q.explanation].filter(Boolean).map(escapeHtml).join('<br>');
    tr.innerHTML = `
      ${tfPoolSelectMode ? `<td class="q-check"><input type="checkbox" class="row-check" ${selectedTfPoolIds.has(q.id) ? 'checked' : ''}></td>` : ''}
      <td class="q-prompt">${escapeHtml(q.statement)}</td>
      <td>${badge}</td>
      <td style="font-size:12.5px;color:var(--muted);">${sideText || '—'}</td>
      <td class="row-actions">
        <button type="button" class="edit">Düzenle</button>
        <button type="button" class="del">Sil</button>
      </td>`;
    tr.querySelector('.edit').addEventListener('click', () => openTfPoolModal(q));
    tr.querySelector('.del').addEventListener('click', () => deleteTfPoolItem(q.id));
    if (tfPoolSelectMode) {
      tr.querySelector('.row-check').addEventListener('change', (e) => {
        if (e.target.checked) selectedTfPoolIds.add(q.id); else selectedTfPoolIds.delete(q.id);
        tr.classList.toggle('selected', e.target.checked);
        updateTfPoolBulkBar();
      });
    }
    tbody.appendChild(tr);
  });

  appendResponsiveTable(contentEl, table);

  if (tfPoolSelectMode) {
    const selectAll = document.getElementById('tfPoolSelectAllCheck');
    selectAll.checked = rows.length > 0 && selectedTfPoolIds.size === rows.length;
    selectAll.addEventListener('change', (e) => {
      if (e.target.checked) rows.forEach(q => selectedTfPoolIds.add(q.id));
      else selectedTfPoolIds.clear();
      renderTfPoolTable();
    });
  }
}

// ---- Tekli ekle/düzenle modalı ----
const tfPoolModalBackdrop = document.getElementById('tfPoolModalBackdrop');
const tfPoolForm = document.getElementById('tfPoolForm');
const tfPoolFormError = document.getElementById('tfPoolFormError');
const tpStatementInput = document.getElementById('tpStatement');
const tpCorrectionField = document.getElementById('tpCorrectionField');
const tpCorrectionInput = document.getElementById('tpCorrection');
const tpExplanationInput = document.getElementById('tpExplanation');

document.getElementById('tfPoolModalCancelBtn')?.addEventListener('click', closeTfPoolModal);
tfPoolModalBackdrop?.addEventListener('click', (e) => { if (e.target === tfPoolModalBackdrop) closeTfPoolModal(); });
if (!tfPoolModalBackdrop) console.warn('[tfPool] #tfPoolModalBackdrop bulunamadı — index.html güncel olmayabilir.');

function updateTfPoolCorrectionVisibility() {
  const isTrue = document.querySelector('input[name="tpIsTrue"]:checked').value === 'true';
  tpCorrectionField.style.display = isTrue ? 'none' : '';
}
document.querySelectorAll('input[name="tpIsTrue"]').forEach(r => r.addEventListener('change', updateTfPoolCorrectionVisibility));

function openTfPoolModal(row) {
  editingTfPoolId = row ? row.id : null;
  tfPoolFormError.classList.remove('show');
  document.getElementById('tfPoolModalTitle').textContent = row ? 'İfadeyi Düzenle' : 'Yeni D/Y İfadesi';
  document.getElementById('tfPoolTopicDisplay').textContent = currentTfPoolTopicTitle || '(konu seçilmedi)';
  tpStatementInput.value = row ? row.statement : '';
  document.querySelector(`input[name="tpIsTrue"][value="${row ? row.is_true : 'true'}"]`).checked = true;
  tpCorrectionInput.value = row ? (row.correction || '') : '';
  tpExplanationInput.value = row ? (row.explanation || '') : '';
  updateTfPoolCorrectionVisibility();
  tfPoolModalBackdrop.classList.add('open');
}

function closeTfPoolModal() {
  tfPoolModalBackdrop.classList.remove('open');
  tfPoolForm.reset();
  editingTfPoolId = null;
}

tfPoolForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  tfPoolFormError.classList.remove('show');

  if (!currentTfPoolTopicId) {
    tfPoolFormError.textContent = 'Önce soldan bir konu seçin.';
    tfPoolFormError.classList.add('show');
    return;
  }

  const isTrue = document.querySelector('input[name="tpIsTrue"]:checked').value === 'true';
  const statement = tpStatementInput.value.trim();
  if (!statement) {
    tfPoolFormError.textContent = 'İfade metni zorunlu.';
    tfPoolFormError.classList.add('show');
    return;
  }

  const payload = {
    topic_id: currentTfPoolTopicId,
    statement,
    is_true: isTrue,
    correction: isTrue ? null : (tpCorrectionInput.value.trim() || null),
    explanation: tpExplanationInput.value.trim() || null,
  };

  const saveBtn = document.getElementById('tfPoolModalSaveBtn');
  saveBtn.disabled = true;
  saveBtn.textContent = 'Kaydediliyor…';

  const { error } = editingTfPoolId
    ? await supabaseClient.from('tf_pool').update(payload).eq('id', editingTfPoolId)
    : await supabaseClient.from('tf_pool').insert(payload);

  saveBtn.disabled = false;
  saveBtn.textContent = 'Kaydet';

  if (error) {
    tfPoolFormError.textContent = 'Kaydedilemedi: ' + error.message;
    tfPoolFormError.classList.add('show');
    return;
  }

  closeTfPoolModal();
  loadTfPoolCounts().then(renderTfPoolTopicTree);
  loadTfPool();
});

// ---- Toplu ekle modalı ----
const tfPoolBulkModalBackdrop = document.getElementById('tfPoolBulkModalBackdrop');
const tfPoolBulkForm = document.getElementById('tfPoolBulkForm');
const tfPoolBulkError = document.getElementById('tfPoolBulkError');
const tbJsonInput = document.getElementById('tbJson');
const tbFileInput = document.getElementById('tbFile');

document.getElementById('tfPoolBulkModalCancelBtn')?.addEventListener('click', closeTfPoolBulkModal);
tfPoolBulkModalBackdrop?.addEventListener('click', (e) => { if (e.target === tfPoolBulkModalBackdrop) closeTfPoolBulkModal(); });
document.getElementById('tfPoolBulkTemplateLink')?.addEventListener('click', (e) => { e.preventDefault(); downloadTfPoolBulkTemplate(); });
if (!tfPoolBulkModalBackdrop) console.warn('[tfPool] #tfPoolBulkModalBackdrop bulunamadı — index.html güncel olmayabilir.');

function openTfPoolBulkModal() {
  if (!currentTfPoolTopicId) {
    showToast('Toplu eklemeden önce soldan bir konu seçin (satır bazında "Konu" sütunuyla override edebilirsiniz).', true);
    return;
  }
  tfPoolBulkError.classList.remove('show');
  tbJsonInput.value = '';
  tbFileInput.value = '';
  document.getElementById('tfPoolBulkTopicDisplay').textContent = currentTfPoolTopicTitle;
  tfPoolBulkModalBackdrop.classList.add('open');
}

function closeTfPoolBulkModal() {
  tfPoolBulkModalBackdrop.classList.remove('open');
  tfPoolBulkForm.reset();
}

// "Doğru mu" sütunu/alanı için esnek ayrıştırma: Evet/Hayır, Doğru/Yanlış,
// TRUE/FALSE, 1/0 — hepsini kabul eder, tanınmayan bir değerde hata verir.
function parseIsTrueValue(raw, rowLabel) {
  const v = String(raw ?? '').trim().toLocaleLowerCase('tr-TR');
  if (['evet', 'doğru', 'true', '1', 'dogru'].includes(v)) return true;
  if (['hayır', 'yanlış', 'false', '0', 'hayir', 'yanlis'].includes(v)) return false;
  throw new Error(`${rowLabel}: "Doğru mu" değeri "${raw}" tanınmadı — Evet/Hayır, Doğru/Yanlış, TRUE/FALSE ya da 1/0 kullanın.`);
}

function tfPoolExcelRowsToItems(sheetRows, defaultTopicId) {
  if (!sheetRows.length) throw new Error('Excel dosyasında veri satırı bulunamadı.');
  const topicLookup = buildTopicTitleLookup();

  return sheetRows.map((row, i) => {
    const n = i + 2;
    const statement = String(row['İfade'] || '').trim();
    if (!statement) throw new Error(`Satır ${n}: "İfade" sütunu boş olamaz.`);
    const isTrue = parseIsTrueValue(row['Doğru mu'], `Satır ${n}`);
    const correction = row['Düzeltme'] ? String(row['Düzeltme']).trim() : null;
    const explanation = row['Açıklama'] ? String(row['Açıklama']).trim() : null;
    const topicRaw = row['Konu'];
    const topicId = topicRaw && String(topicRaw).trim()
      ? resolveTopicIdOrThrow(topicRaw, `Satır ${n}`, topicLookup)
      : defaultTopicId;

    return { topic_id: topicId, statement, is_true: isTrue, correction: isTrue ? null : correction, explanation };
  });
}

function tfPoolParseBulkJson(raw, defaultTopicId) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error('Geçersiz JSON: ' + e.message);
  }
  if (!Array.isArray(parsed)) throw new Error('JSON bir dizi ([...]) olmalı.');
  if (!parsed.length) throw new Error('Dizi boş.');
  const topicLookup = buildTopicTitleLookup();

  return parsed.map((q, i) => {
    const n = i + 1;
    if (!q || typeof q !== 'object') throw new Error(`#${n}: geçersiz ifade nesnesi.`);
    const statement = String(q.statement || '').trim();
    if (!statement) throw new Error(`#${n}: "statement" zorunlu.`);
    if (typeof q.isTrue !== 'boolean' && typeof q.is_true !== 'boolean') {
      throw new Error(`#${n}: "isTrue" (true/false) zorunlu.`);
    }
    const isTrue = q.isTrue ?? q.is_true;
    const correction = q.correction ? String(q.correction).trim() : null;
    const explanation = q.explanation ? String(q.explanation).trim() : null;
    const topicId = q.topicTitle && String(q.topicTitle).trim()
      ? resolveTopicIdOrThrow(q.topicTitle, `#${n}`, topicLookup)
      : defaultTopicId;

    return { topic_id: topicId, statement, is_true: isTrue, correction: isTrue ? null : correction, explanation };
  });
}

tfPoolBulkForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  tfPoolBulkError.classList.remove('show');

  const file = tbFileInput.files[0];
  let rows;
  try {
    if (file) {
      const sheetRows = await readExcelFile(file);
      rows = tfPoolExcelRowsToItems(sheetRows, currentTfPoolTopicId);
    } else if (tbJsonInput.value.trim()) {
      rows = tfPoolParseBulkJson(tbJsonInput.value, currentTfPoolTopicId);
    } else {
      throw new Error('Bir Excel dosyası seçin veya JSON alanına ifadeleri yapıştırın.');
    }
  } catch (err) {
    tfPoolBulkError.textContent = err.message;
    tfPoolBulkError.classList.add('show');
    return;
  }

  const saveBtn = document.getElementById('tfPoolBulkModalSaveBtn');
  saveBtn.disabled = true;
  saveBtn.textContent = 'Kaydediliyor…';

  const { error } = await supabaseClient.from('tf_pool').insert(rows);

  saveBtn.disabled = false;
  saveBtn.textContent = 'Kaydet';

  if (error) {
    tfPoolBulkError.textContent = 'Kaydedilemedi: ' + error.message;
    tfPoolBulkError.classList.add('show');
    return;
  }

  closeTfPoolBulkModal();
  loadTfPoolCounts().then(renderTfPoolTopicTree);
  loadTfPool();
});

function downloadTfPoolBulkTemplate() {
  const rows = [
    ['İfade', 'Doğru mu', 'Düzeltme', 'Açıklama', 'Konu'],
    ["657 sayılı Kanun'a göre disiplin cezaları memurun özlük dosyasına işlenir.", 'Doğru', '', '', '657 sayılı Devlet Memurları Kanunu'],
    ['Memurluktan çıkarma cezası dışındaki cezalar için soruşturmaya başlama süresi 60 gündür.', 'Yanlış', 'Süre 30 gündür.', '', '']
  ];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{ wch: 60 }, { wch: 12 }, { wch: 34 }, { wch: 30 }, { wch: 34 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'D-Y İfadeleri');
  XLSX.writeFile(wb, 'dy-havuzu-sablonu.xlsx');
}

// ---- Dışa aktarma (Excel / Word) — tf_pool'un kendi şekline özel, questions
// tablosunun "Şık A/B/C..." formatına uymadığı için exportQuestionsExcel/Word
// yeniden kullanılmadı. ----
function exportTfPoolExcel(rows, titleOverride) {
  if (!rows.length) { showToast('Dışa aktarılacak ifade yok.', true); return; }
  const sheetRows = [['No', 'İfade', 'Doğru mu', 'Düzeltme', 'Açıklama']];
  rows.forEach((q, i) => sheetRows.push([i + 1, q.statement, q.is_true ? 'Doğru' : 'Yanlış', q.correction || '', q.explanation || '']));
  const ws = XLSX.utils.aoa_to_sheet(sheetRows);
  ws['!cols'] = [{ wch: 5 }, { wch: 60 }, { wch: 10 }, { wch: 34 }, { wch: 30 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'D-Y İfadeleri');
  XLSX.writeFile(wb, `${reportBaseName(titleOverride)}.xlsx`);
}

function exportTfPoolWord(rows, titleOverride) {
  if (!rows.length) { showToast('Dışa aktarılacak ifade yok.', true); return; }
  const dateStr = new Date().toLocaleDateString('tr-TR');
  const items = rows.map((q, i) => {
    const statusHtml = q.is_true
      ? '<span style="color:#2E6B4C;font-weight:700;">✓ Doğru</span>'
      : `<span style="color:#B3261E;font-weight:700;">✕ Yanlış</span>${q.correction ? ` — <i>${escapeHtml(q.correction)}</i>` : ''}`;
    const explanation = q.explanation ? `<div style="margin-top:4px;font-size:12.5px;color:#6b6b6b;"><b>Açıklama:</b> ${escapeHtml(q.explanation)}</div>` : '';
    return `
      <div style="margin-bottom:16px;padding-bottom:12px;border-bottom:1px solid #ddd;">
        <div style="font-size:14px;margin-bottom:6px;">${i + 1}. ${escapeHtml(q.statement)}</div>
        <div style="font-size:13px;">${statusHtml}</div>
        ${explanation}
      </div>`;
  }).join('');

  const bodyHtml = `
    <div style="font-family:Calibri, Arial, sans-serif;color:#201D17;width:720px;padding:24px;">
      <div style="border-bottom:2px solid #A9843F;padding-bottom:10px;margin-bottom:18px;">
        <div style="font-size:19px;font-weight:700;">SınavRotası — D/Y Havuzu Raporu</div>
        <div style="font-size:12.5px;color:#7A7462;margin-top:4px;">${escapeHtml(titleOverride || 'D/Y Havuzu')} • ${rows.length} ifade • ${dateStr}</div>
      </div>
      ${items}
    </div>`;
  const html = `<!DOCTYPE html>
    <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
    <head><meta charset="utf-8"><title>SınavRotası D/Y Havuzu Raporu</title></head>
    <body>${bodyHtml}</body></html>`;
  const blob = new Blob(['\ufeff', html], { type: 'application/msword;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${reportBaseName(titleOverride)}.doc`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ========================= 8) Konular sekmesi: kategori + konu ağacı yönetimi =========================
function renderCategorySidebar() {
  const panel = document.getElementById('sidePanel');
  panel.innerHTML = '';

  if (!categoriesCache.length) {
    panel.innerHTML = '<div class="empty-state">Henüz kategori yok. "+ Yeni Kategori" ile oluşturun.</div>';
    return;
  }

  const block = document.createElement('div');
  block.className = 'cat-block';
  categoriesCache.forEach(cat => {
    const node = document.createElement('div');
    node.className = `tree-node${cat.id === manageCategoryId ? ' active' : ''}`;
    node.textContent = cat.title;
    node.addEventListener('click', () => selectManageCategory(cat.id));
    block.appendChild(node);
  });
  panel.appendChild(block);
}

function selectManageCategory(categoryId) {
  manageCategoryId = categoryId;
  manageParentId = null;
  renderCategorySidebar();
  renderManageContent();
}

// Kökten (kategori) verilen konuya kadar olan zinciri döner.
function getBreadcrumbChain(topicId) {
  const chain = [];
  let cur = topicId ? topicsById[topicId] : null;
  while (cur) {
    chain.unshift(cur);
    cur = cur.parent_id ? topicsById[cur.parent_id] : null;
  }
  return chain;
}

function openManageNode(topicId) {
  manageParentId = topicId;
  renderManageContent();
}

function renderManageContent() {
  const contentEl = document.getElementById('content');
  const category = categoriesCache.find(c => c.id === manageCategoryId);
  if (!category) { contentEl.innerHTML = '<div class="empty-state">Kategori bulunamadı.</div>'; return; }

  const chain = getBreadcrumbChain(manageParentId);
  document.getElementById('mainTitle').textContent = chain.length ? chain[chain.length - 1].title : category.title;
  document.getElementById('mainSub').textContent = '';

  const breadcrumb = document.createElement('div');
  breadcrumb.className = 'breadcrumb';
  const rootLink = document.createElement('a');
  rootLink.textContent = category.title;
  rootLink.addEventListener('click', () => openManageNode(null));
  breadcrumb.appendChild(rootLink);
  chain.forEach(node => {
    breadcrumb.appendChild(document.createTextNode(' › '));
    const a = document.createElement('a');
    a.textContent = node.title;
    a.addEventListener('click', () => openManageNode(node.id));
    breadcrumb.appendChild(a);
  });

  const headerRow = document.createElement('div');
  headerRow.style.cssText = 'display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px;';
  headerRow.appendChild(breadcrumb);

  const actions = document.createElement('div');
  actions.style.cssText = 'display:flex;gap:8px;flex-shrink:0;';
  if (!manageParentId) {
    const editCatBtn = document.createElement('button');
    editCatBtn.className = 'btn secondary small';
    editCatBtn.type = 'button';
    editCatBtn.textContent = 'Kategoriyi Düzenle';
    editCatBtn.addEventListener('click', () => openCategoryModal(category));
    actions.appendChild(editCatBtn);

    const delCatBtn = document.createElement('button');
    delCatBtn.className = 'btn danger small';
    delCatBtn.type = 'button';
    delCatBtn.textContent = 'Kategoriyi Sil';
    delCatBtn.addEventListener('click', () => deleteCategory(category));
    actions.appendChild(delCatBtn);
  }
  const addBtn = document.createElement('button');
  addBtn.className = 'btn small';
  addBtn.type = 'button';
  addBtn.textContent = manageParentId ? '+ Alt Konu/Bölüm Ekle' : '+ Yeni Konu Ekle';
  addBtn.addEventListener('click', () => openTopicModal(null, manageParentId, manageCategoryId));
  actions.appendChild(addBtn);
  headerRow.appendChild(actions);

  const children = Object.values(topicsById)
    .filter(t => t.category_id === manageCategoryId && (t.parent_id || null) === (manageParentId || null))
    .sort((a, b) => a.sort_order - b.sort_order);

  const list = document.createElement('div');
  list.className = 'manage-list';

  if (!children.length) {
    list.innerHTML = '<div class="empty-state">Burada henüz bir alt konu/bölüm yok.</div>';
  } else {
    children.forEach(t => {
      const row = document.createElement('div');
      row.className = 'manage-row';

      const title = document.createElement('div');
      title.className = 'mr-title';
      title.innerHTML = `<span class="type-badge">${TOPIC_TYPE_LABELS[t.type] || t.type}</span> ${escapeHtml(t.title)}`;
      row.appendChild(title);

      const metaParts = [];
      if (t.article_range) metaParts.push(t.article_range);
      // DÜZELTME: burada da toplam (alt konular dahil) soru sayısını gösteriyoruz,
      // aksi halde alt konusu olan bir üst konu "0 soru mevcut" gibi yanıltıcı görünüyordu.
      const actualCount = aggregatedQuestionCounts[t.id] || 0;
      metaParts.push(`${actualCount} soru mevcut`);
      if (t.question_count != null) metaParts.push(`${t.question_count} hedef`);
      if (metaParts.length) {
        const meta = document.createElement('div');
        meta.className = 'mr-meta';
        meta.textContent = metaParts.join(' • ');
        row.appendChild(meta);
      }

      const rowActions = document.createElement('div');
      rowActions.className = 'mr-actions';
      const editBtn = document.createElement('button');
      editBtn.type = 'button'; editBtn.textContent = 'Düzenle';
      editBtn.addEventListener('click', (e) => { e.stopPropagation(); openTopicModal(t, t.parent_id, t.category_id); });
      const delBtn = document.createElement('button');
      delBtn.type = 'button'; delBtn.className = 'del'; delBtn.textContent = 'Sil';
      delBtn.addEventListener('click', (e) => { e.stopPropagation(); deleteTopicNode(t.id, t.title); });
      rowActions.appendChild(editBtn);
      rowActions.appendChild(delBtn);
      row.appendChild(rowActions);

      row.addEventListener('click', () => openManageNode(t.id));
      list.appendChild(row);
    });
  }

  contentEl.innerHTML = '';
  contentEl.appendChild(headerRow);
  contentEl.appendChild(list);
}

async function refreshTopicsAndRerender() {
  await loadTopics();
  if (activeTab === 'questions') { renderTopicTree(); }
  else if (activeTab === 'topics') { renderCategorySidebar(); if (manageCategoryId) renderManageContent(); }
}

// Türkçe karakterleri sadeleştirip URL/ID dostu bir slug üretir.
function slugify(str) {
  const map = { 'ç':'c','ğ':'g','ı':'i','ö':'o','ş':'s','ü':'u' };
  return String(str).toLowerCase().replace(/[çğıöşü]/g, c => map[c] || c)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'konu';
}

// ---- Konu ekle/düzenle modalı ----
const topicModalBackdrop = document.getElementById('topicModalBackdrop');
const topicForm = document.getElementById('topicForm');
const topicFormError = document.getElementById('topicFormError');
const tKadroGroup = document.getElementById('tKadroGroup');

tKadroGroup.innerHTML = Object.keys(KADRO_LABELS).map(k =>
  `<label><input type="checkbox" value="${k}" checked> ${kadroLabel(k)}</label>`
).join('');

document.getElementById('topicModalCancelBtn').addEventListener('click', closeTopicModal);
topicModalBackdrop.addEventListener('click', (e) => { if (e.target === topicModalBackdrop) closeTopicModal(); });

function openTopicModal(topic, parentId, categoryId) {
  editingTopicId = topic ? topic.id : null;
  newTopicParentId = parentId || null;
  newTopicCategoryId = categoryId;
  topicFormError.classList.remove('show');

  document.getElementById('topicModalTitle').textContent = topic ? 'Konuyu Düzenle' : 'Yeni Konu';
  document.getElementById('tTitle').value = topic?.title || '';
  document.getElementById('tType').value = topic?.type || (parentId ? 'section' : 'topic');
  document.getElementById('tDocNumber').value = topic?.document_number || '';
  document.getElementById('tArticleRange').value = topic?.article_range || '';
  document.getElementById('tQuestionCount').value = topic?.question_count ?? '';
  document.getElementById('tSummary').value = topic?.summary || '';
  document.getElementById('tKeyPoints').value = (topic?.key_points || []).join('\n');

  const selectedKadrolar = topic?.kadrolar || Object.keys(KADRO_LABELS);
  tKadroGroup.querySelectorAll('input').forEach(cb => { cb.checked = selectedKadrolar.includes(cb.value); });

  const chain = getBreadcrumbChain(parentId);
  document.getElementById('topicParentHint').textContent = chain.length
    ? `Konum: ${chain.map(c => c.title).join(' › ')}`
    : 'Bu, kategori kökünde üst düzey bir konu olacak.';

  topicModalBackdrop.classList.add('open');
  document.getElementById('tTitle').focus();
}

function closeTopicModal() {
  topicModalBackdrop.classList.remove('open');
  topicForm.reset();
  editingTopicId = null;
}

topicForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  topicFormError.classList.remove('show');

  const title = document.getElementById('tTitle').value.trim();
  const type = document.getElementById('tType').value;
  const documentNumber = document.getElementById('tDocNumber').value.trim();
  const articleRange = document.getElementById('tArticleRange').value.trim();
  const questionCountRaw = document.getElementById('tQuestionCount').value;
  const kadrolar = Array.from(tKadroGroup.querySelectorAll('input:checked')).map(cb => cb.value);
  const summary = document.getElementById('tSummary').value.trim();
  const keyPoints = document.getElementById('tKeyPoints').value
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);

  if (!title) {
    topicFormError.textContent = 'Başlık zorunludur.';
    topicFormError.classList.add('show');
    return;
  }

  const saveBtn = document.getElementById('topicModalSaveBtn');
  saveBtn.disabled = true;
  saveBtn.textContent = 'Kaydediliyor…';

  const payload = {
    title,
    type,
    document_number: documentNumber || null,
    article_range: articleRange || null,
    question_count: questionCountRaw === '' ? null : Number(questionCountRaw),
    kadrolar,
    summary: summary || null,
    key_points: keyPoints
  };

  let error;
  if (editingTopicId) {
    ({ error } = await supabaseClient.from('topics').update(payload).eq('id', editingTopicId));
  } else {
    // Yeni konuya benzersiz bir id ver. source_file'ı da aynı değere eşitliyoruz;
    // böylece uygulama tarafı bu konuyu "içerik paketi aktif" olarak görüp
    // sorularını (questions.topic_id üzerinden) doğrudan çekebiliyor —
    // yani kod değişikliği gerekmeden admin panelinden eklenen her konu
    // otomatik olarak çalışılabilir hale geliyor.
    const id = `t-${slugify(title)}-${Date.now().toString(36).slice(-5)}`;
    const siblings = Object.values(topicsById).filter(t =>
      t.category_id === newTopicCategoryId && (t.parent_id || null) === (newTopicParentId || null));
    const sortOrder = siblings.length ? Math.max(...siblings.map(s => s.sort_order)) + 1 : 0;

    ({ error } = await supabaseClient.from('topics').insert({
      id,
      category_id: newTopicCategoryId,
      parent_id: newTopicParentId,
      source_file: id,
      sort_order: sortOrder,
      ...payload
    }));
  }

  saveBtn.disabled = false;
  saveBtn.textContent = 'Kaydet';

  if (error) {
    topicFormError.textContent = 'Kaydedilemedi: ' + error.message;
    topicFormError.classList.add('show');
    return;
  }

  closeTopicModal();
  await refreshTopicsAndRerender();
});

// A-04 (2026-09-15): Konu/kategori silme, alt konuları ve TÜM sorularını
// geri dönüşsüz siler (veritabanında ON DELETE CASCADE). Silinecek miktar
// açıkça gösterilir ve işlem, adın aynen yazılmasıyla onaylanır.
function confirmDestructiveDelete(kind, title, topicCount, questionCount) {
  const lines = [
    `"${title}" ${kind} kalıcı olarak silinecek.`,
    '',
    `• Silinecek alt konu/bölüm: ${topicCount}`,
    `• Silinecek soru: ${questionCount}`,
    '',
    'Bu işlem geri alınamaz. Devam etmek için adı aynen yazın:'
  ];
  const entered = window.prompt(lines.join('\n'), '');
  if (entered === null) return false;
  if (entered.trim() !== String(title).trim()) {
    showToast('Silme iptal edildi: ad eşleşmedi.', true);
    return false;
  }
  return true;
}

async function deleteTopicNode(id, title) {
  const affectedIds = collectDescendantTopicIds(id);
  const questionCount = aggregatedQuestionCounts[id] || 0;
  if (!confirmDestructiveDelete('konusu', title, Math.max(affectedIds.length - 1, 0), questionCount)) return;

  // DÜZELTME: silinecek konu (ve tüm alt konuları) şu anda "Sorular" sekmesinde
  // seçili olan konuyu kapsıyorsa, eskimiş (stale) referansı temizle.
  const currentTopicWasAffected = currentTopicId && affectedIds.includes(currentTopicId);

  const { data: deleted, error } = await supabaseClient.from('topics').delete().eq('id', id).select('id');
  if (error) {
    const msg = /exam_topics/.test(error.message || '')
      ? 'Bu konu bir kadro sınavı başlığına bağlı olduğu için silinemez.'
      : error.message;
    showToast('Silinemedi: ' + msg, true);
    return;
  }
  if (!deleted || deleted.length === 0) { showToast('Silinemedi: kayıt bulunamadı ya da yetki yok.', true); return; }

  if (manageParentId === id) manageParentId = null;
  if (currentTopicWasAffected) {
    currentTopicId = null;
    currentTopicTitle = '';
  }
  showToast(`"${title}" silindi.`);
  await refreshTopicsAndRerender();
}

async function deleteCategory(category) {
  const categoryTopics = Object.values(topicsById).filter(t => t.category_id === category.id);
  const rootTopics = categoryTopics.filter(t => !t.parent_id);
  const questionCount = rootTopics.reduce((sum, t) => sum + (aggregatedQuestionCounts[t.id] || 0), 0);
  if (!confirmDestructiveDelete('kategorisi', category.title, categoryTopics.length, questionCount)) return;

  const affectedIds = categoryTopics.map(t => t.id);
  const currentTopicWasAffected = currentTopicId && affectedIds.includes(currentTopicId);

  const { data: deleted, error } = await supabaseClient.from('categories').delete().eq('id', category.id).select('id');
  if (error) {
    const msg = /card_decks|exam_topics/.test(error.message || '')
      ? 'Bu kategoriye bağlı kart desteleri veya sınav konuları olduğu için silinemez.'
      : error.message;
    showToast('Silinemedi: ' + msg, true);
    return;
  }
  if (!deleted || deleted.length === 0) { showToast('Silinemedi: kayıt bulunamadı ya da yetki yok.', true); return; }

  if (manageCategoryId === category.id) { manageCategoryId = null; manageParentId = null; }
  if (currentTopicWasAffected) {
    currentTopicId = null;
    currentTopicTitle = '';
  }
  showToast(`"${category.title}" silindi.`);
  await refreshTopicsAndRerender();
}

// ---- Kategori ekle/düzenle modalı ----
const categoryModalBackdrop = document.getElementById('categoryModalBackdrop');
const categoryForm = document.getElementById('categoryForm');
const categoryFormError = document.getElementById('categoryFormError');

document.getElementById('categoryModalCancelBtn').addEventListener('click', closeCategoryModal);
categoryModalBackdrop.addEventListener('click', (e) => { if (e.target === categoryModalBackdrop) closeCategoryModal(); });

function openCategoryModal(category) {
  editingCategoryId = category ? category.id : null;
  categoryFormError.classList.remove('show');
  document.getElementById('categoryModalTitle').textContent = category ? 'Kategoriyi Düzenle' : 'Yeni Kategori';
  document.getElementById('cTitle').value = category?.title || '';
  document.getElementById('cSubtitle').value = category?.subtitle || '';
  categoryModalBackdrop.classList.add('open');
  document.getElementById('cTitle').focus();
}

function closeCategoryModal() {
  categoryModalBackdrop.classList.remove('open');
  categoryForm.reset();
  editingCategoryId = null;
}

categoryForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  categoryFormError.classList.remove('show');

  const title = document.getElementById('cTitle').value.trim();
  const subtitle = document.getElementById('cSubtitle').value.trim();
  if (!title) {
    categoryFormError.textContent = 'Başlık zorunludur.';
    categoryFormError.classList.add('show');
    return;
  }

  const saveBtn = document.getElementById('categoryModalSaveBtn');
  saveBtn.disabled = true;
  saveBtn.textContent = 'Kaydediliyor…';

  let error, newId = editingCategoryId;
  if (editingCategoryId) {
    ({ error } = await supabaseClient.from('categories').update({ title, subtitle: subtitle || null }).eq('id', editingCategoryId));
  } else {
    let base = slugify(title);
    if (categoriesCache.some(c => c.id === base)) base = `${base}-${Date.now().toString(36).slice(-4)}`;
    newId = base;
    const sortOrder = categoriesCache.length ? Math.max(...categoriesCache.map(c => c.sort_order || 0)) + 1 : 0;
    ({ error } = await supabaseClient.from('categories').insert({ id: newId, title, subtitle: subtitle || null, sort_order: sortOrder }));
  }

  saveBtn.disabled = false;
  saveBtn.textContent = 'Kaydet';

  if (error) {
    categoryFormError.textContent = 'Kaydedilemedi: ' + error.message;
    categoryFormError.classList.add('show');
    return;
  }

  const wasNew = !editingCategoryId;
  closeCategoryModal();
  await refreshTopicsAndRerender();
  if (wasNew) selectManageCategory(newId);
});

// ========================= 9) Bildirimler sekmesi =========================
async function loadFeedback() {
  let query = supabaseClient
    .from('question_feedback')
    .select('id, question_id, tf_question_id, user_id, message, status, created_at, resolved_at, resolution_note, questions(prompt, topic_id), tf_pool(statement)')
    .order('created_at', { ascending: false })
    .limit(200);

  if (feedbackStatusFilter !== 'all') {
    query = query.eq('status', feedbackStatusFilter);
  }

  const { data, error } = await query;
  if (error) {
    document.getElementById('content').innerHTML =
      `<div class="empty-state">Bildirimler yüklenemedi: ${escapeHtml(error.message)}</div>`;
    return;
  }
  feedbackRowsCache = data || [];
  document.getElementById('mainSub').textContent = `${feedbackRowsCache.length} kayıt`;
  renderFeedbackTable();
}

function feedbackStatusBadge(status) {
  const map = {
    open: '<span class="badge no" style="background:#fde68a;color:#92400e;">Açık</span>',
    resolved: '<span class="badge yes">Çözüldü</span>',
    retracted: '<span class="badge no">Geri Alındı</span>',
  };
  return map[status] || escapeHtml(status);
}

function renderFeedbackTable() {
  const contentEl = document.getElementById('content');
  const rows = feedbackRowsCache;

  if (!rows.length) {
    contentEl.innerHTML = '<div class="empty-state">Bu filtrede bildirim yok.</div>';
    return;
  }

  const table = document.createElement('table');
  table.className = 'q-table';
  table.innerHTML = `
    <thead><tr>
      <th style="width:14%">Tarih</th>
      <th style="width:12%">Kullanıcı</th>
      <th style="width:34%">Soru</th>
      <th style="width:22%">Not</th>
      <th style="width:10%">Durum</th>
      <th></th>
    </tr></thead>
    <tbody></tbody>`;
  const tbody = table.querySelector('tbody');

  rows.forEach(row => {
    const tr = document.createElement('tr');
    const dt = new Date(row.created_at);
    const dateStr = dt.toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    const promptText = row.questions?.prompt
      || (row.tf_pool?.statement ? `[Doğru/Yanlış] ${row.tf_pool.statement}` : null)
      || `(soru bulunamadı: ${row.question_id || row.tf_question_id || '-'})`;
    tr.innerHTML = `
      <td style="font-size:12px;color:var(--muted);">${dateStr}</td>
      <td style="font-size:12px;">${row.user_id ? escapeHtml(row.user_id.slice(0, 8)) : '-'}</td>
      <td class="q-prompt">${escapeHtml(promptText)}</td>
      <td style="font-size:12px;">${escapeHtml(row.message || '-')}</td>
      <td>${feedbackStatusBadge(row.status)}</td>
      <td class="row-actions">
        ${row.question_id ? '<button type="button" class="edit">Soruyu Aç</button>' : ''}
        ${row.status === 'open' ? '<button type="button" class="resolve">Çözüldü</button>' : ''}
        <button type="button" class="del">Sil</button>
      </td>`;

    if (row.question_id) {
      tr.querySelector('.edit').addEventListener('click', async () => {
        const { data: q, error } = await supabaseClient.from('questions').select('*').eq('id', row.question_id).maybeSingle();
        if (error || !q) { showToast('Soru bulunamadı, silinmiş olabilir.', true); return; }
        currentTopicId = q.topic_id;
        openQuestionModal(q);
      });
    }
    const resolveBtn = tr.querySelector('.resolve');
    if (resolveBtn) {
      resolveBtn.addEventListener('click', async () => {
        // Kullanıcıya gidecek kısa not (isteğe bağlı). İptal'e basılırsa işlem yapılmaz.
        const note = window.prompt(
          'Bildirimi yapan kullanıcıya gidecek kısa not (boş bırakabilirsin):\n' +
          'Örn: Doğru cevap ve açıklama güncellendi.',
          ''
        );
        if (note === null) return;
        resolveBtn.disabled = true;
        // Yetki kontrolü veritabanında: resolve_question_feedback yalnızca admin çağırabilir.
        // Aynı soruya ait diğer açık bildirimler de çözülür ve her kullanıcıya
        // uygulama içi bildirim üretilir (tekrar gönderim unique index ile engellenir).
        const { data: notified, error } = await supabaseClient.rpc('resolve_question_feedback', {
          p_feedback_id: row.id,
          p_note: note.trim() || null,
        });
        if (error) { resolveBtn.disabled = false; showToast('Güncellenemedi: ' + error.message, true); return; }
        showToast(`Çözüldü. ${notified || 0} kullanıcıya bildirim gönderildi.`);
        loadFeedback();
      });
    }
    tr.querySelector('.del').addEventListener('click', async () => {
      if (!confirm('Bu bildirim kalıcı olarak silinsin mi?')) return;
      const { error } = await supabaseClient.from('question_feedback').delete().eq('id', row.id);
      if (error) { showToast('Silinemedi: ' + error.message, true); return; }
      loadFeedback();
    });

    tbody.appendChild(tr);
  });

  contentEl.innerHTML = '';
  appendResponsiveTable(contentEl, table);
}

// ========================= 10) Kullanıcılar sekmesi (premium / hesap yönetimi) =========================
// NOT: auth.users tablosu istemciye hiç açılmıyor; e-posta/premium bilgisi
// sadece yönetici yetkisi denetlenen RPC'ler üzerinden geliyor.
async function loadUsers() {
  const { data, error } = await supabaseClient.rpc('admin_search_users', { p_query: userSearchQuery });
  if (error) {
    document.getElementById('content').innerHTML =
      `<div class="empty-state">Kullanıcılar yüklenemedi: ${escapeHtml(error.message)}</div>`;
    return;
  }
  userRowsCache = data || [];
  document.getElementById('mainSub').textContent = userSearchQuery
    ? `"${userSearchQuery}" için ${userRowsCache.length} sonuç`
    : `${userRowsCache.length} kullanıcı (ilk 30)`;
  renderUsersTable();
}

function renderUsersTable() {
  const contentEl = document.getElementById('content');
  const rows = userRowsCache;

  if (!rows.length) {
    contentEl.innerHTML = '<div class="empty-state">Kullanıcı bulunamadı.</div>';
    return;
  }

  const table = document.createElement('table');
  table.className = 'q-table';
  table.innerHTML = `
    <thead><tr>
      <th style="width:34%">E-posta</th>
      <th style="width:12%">Admin</th>
      <th style="width:14%">Premium</th>
      <th style="width:20%">Bitiş</th>
      <th></th>
    </tr></thead>
    <tbody></tbody>`;
  const tbody = table.querySelector('tbody');

  rows.forEach(row => {
    const tr = document.createElement('tr');
    // A-03 (2026-09-15): Ham is_premium bayrağı süre dolduğunda false'a
    // çekilmiyor. Gerçek durum = bayrak açık VE (süresiz VEYA bitiş gelecekte).
    const untilMs = row.premium_until ? new Date(row.premium_until).getTime() : null;
    const isLifetime = Boolean(row.is_premium) && untilMs === null;
    const isActivePremium = Boolean(row.is_premium) && (untilMs === null || untilMs > Date.now());
    const isExpired = Boolean(row.is_premium) && untilMs !== null && untilMs <= Date.now();
    const untilStr = untilMs !== null
      ? new Date(untilMs).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) + (isExpired ? ' (doldu)' : '')
      : (isLifetime ? 'Süresiz' : '-');
    tr.innerHTML = `
      <td>${escapeHtml(row.email || '-')}</td>
      <td>${row.is_admin ? '<span class="badge yes">Admin</span>' : ''}</td>
      <td>${isActivePremium ? '<span class="badge yes">Premium</span>' : (isExpired ? '<span class="badge no">Süresi doldu</span>' : '<span class="badge no">Ücretsiz</span>')}</td>
      <td style="font-size:12px;color:var(--muted);">${escapeHtml(untilStr)}</td>
      <td class="row-actions">
        <button type="button" class="grant30">+30 Gün</button>
        <button type="button" class="grant-forever">Süresiz Yap</button>
        ${isActivePremium ? '<button type="button" class="revoke del">Kaldır</button>' : ''}
        ${row.id !== currentAdminUserId ? '<button type="button" class="delete-user del" title="Kullanıcıyı ve tüm verilerini kalıcı olarak sil">Kullanıcıyı Sil</button>' : ''}
      </td>`;

    // A-02 (2026-09-15): "+30 Gün" mevcut aktif süreye EKLER (önceden bitişi
    // "şimdi + 30 gün" yapıyor, daha uzun süreleri kısaltıyordu). Süresiz
    // premium'a dokunulmaz.
    tr.querySelector('.grant30').addEventListener('click', async () => {
      if (isLifetime) { showToast(`${row.email} zaten süresiz premium.`); return; }
      const base = isActivePremium && untilMs !== null ? untilMs : Date.now();
      const until = new Date(base + 30 * 24 * 60 * 60 * 1000).toISOString();
      const { error } = await supabaseClient.rpc('admin_set_premium', { p_user_id: row.id, p_is_premium: true, p_premium_until: until });
      if (error) { showToast('Güncellenemedi: ' + error.message, true); return; }
      showToast(`${row.email} — 30 günlük premium verildi.`);
      loadUsers();
    });
    tr.querySelector('.grant-forever').addEventListener('click', async () => {
      if (!confirm(`${row.email} kullanıcısına süresiz premium verilsin mi?`)) return;
      const { error } = await supabaseClient.rpc('admin_set_premium', { p_user_id: row.id, p_is_premium: true, p_premium_until: null });
      if (error) { showToast('Güncellenemedi: ' + error.message, true); return; }
      showToast(`${row.email} — süresiz premium verildi.`);
      loadUsers();
    });
    const revokeBtn = tr.querySelector('.revoke');
    if (revokeBtn) {
      revokeBtn.addEventListener('click', async () => {
        if (!confirm(`${row.email} kullanıcısının premium erişimi kaldırılsın mı?`)) return;
        const { error } = await supabaseClient.rpc('admin_set_premium', { p_user_id: row.id, p_is_premium: false, p_premium_until: null });
        if (error) { showToast('Güncellenemedi: ' + error.message, true); return; }
        showToast(`${row.email} — premium kaldırıldı.`);
        loadUsers();
      });
    }

    const deleteUserBtn = tr.querySelector('.delete-user');
    if (deleteUserBtn) {
      deleteUserBtn.addEventListener('click', () => deleteUserWithAllData(row, deleteUserBtn));
    }

    tbody.appendChild(tr);
  });

  contentEl.innerHTML = '';
  appendResponsiveTable(contentEl, table);
}

async function deleteUserWithAllData(user, button) {
  if (!user?.id || !user?.email) {
    showToast('Kullanıcı kaydı eksik olduğu için silme işlemi başlatılamadı.', true);
    return;
  }

  const expectedEmail = String(user.email).trim().toLowerCase();
  const enteredEmail = window.prompt(
    `Bu işlem geri alınamaz.\n\n"${user.email}" hesabı, giriş bilgileri, profil, premium durumu, ilerleme geçmişi ve kullanıcıya bağlı diğer veriler kalıcı olarak silinecek.\n\nDevam etmek için kullanıcının e-posta adresini eksiksiz yazın:`,
    ''
  );

  if (enteredEmail === null) return;
  if (String(enteredEmail).trim().toLowerCase() !== expectedEmail) {
    showToast('Silme iptal edildi: e-posta doğrulaması eşleşmedi.', true);
    return;
  }

  const actionButtons = Array.from(button.closest('.row-actions')?.querySelectorAll('button') || []);
  actionButtons.forEach(actionButton => { actionButton.disabled = true; });
  button.textContent = 'Siliniyor…';

  try {
    const { error } = await supabaseClient.rpc('admin_delete_user', { p_user_id: user.id });
    if (error) {
      showToast('Kullanıcı silinemedi: ' + error.message, true);
      return;
    }

    showToast(`${user.email} kullanıcısı ve bağlı verileri kalıcı olarak silindi.`);
    userRowsCache = userRowsCache.filter(row => row.id !== user.id);
    await loadUsers();
  } catch (error) {
    showToast('Kullanıcı silinemedi: ' + (error?.message || 'Beklenmeyen bir hata oluştu.'), true);
  } finally {
    actionButtons.forEach(actionButton => { actionButton.disabled = false; });
  }
}

// ========================= yardımcı =========================
function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

boot();

// ========================= 8) Genel Ayarlar (app_settings) =========================
// Tum kullanicilar icin ORTAK degerler (kullanici bazli degil) - su an
// resmi sinav tarihi ve ana sayfa header'indaki motivasyon sozleri havuzu.
// app_settings tablosu herkese okunabilir, sadece admin yazabilir (bkz.
// migration: add_app_settings_shared_exam_date).
async function loadSettings() {
  const { data, error } = await supabaseClient
    .from('app_settings')
    .select('key, value, updated_at')
    .in('key', ['exam_date', 'motivational_phrases']);
  if (error) {
    document.getElementById('content').innerHTML =
      `<div class="empty-state">Ayarlar yüklenemedi: ${escapeHtml(error.message)}</div>`;
    return;
  }
  const examRow = (data || []).find(r => r.key === 'exam_date');
  const phrasesRow = (data || []).find(r => r.key === 'motivational_phrases');
  const examDate = examRow?.value || '';
  const examUpdatedAt = examRow?.updated_at ? new Date(examRow.updated_at).toLocaleString('tr-TR') : '—';

  // O-12 (2026-09-19): motivational_phrases, app_settings.value (text) kolonunda
  // JSON dizi olarak tutuluyor — ör. '["Bugün 1 adım daha!","Az kaldı, devam et!"]'.
  // Mobil app.js aynı formatı bekliyor (bkz. app.js -> loadMotivationalPhrases()).
  let phrasesList = [];
  try { phrasesList = JSON.parse(phrasesRow?.value || '[]'); } catch { phrasesList = []; }
  if (!Array.isArray(phrasesList)) phrasesList = [];
  const phrasesUpdatedAt = phrasesRow?.updated_at ? new Date(phrasesRow.updated_at).toLocaleString('tr-TR') : '—';

  document.getElementById('content').innerHTML = `
    <div class="settings-card">
      <div class="field">
        <label>Resmi sınav tarihi</label>
        <input type="date" id="examDateInput" value="${escapeHtml(examDate)}">
      </div>
      <p class="settings-hint">Uygulamanın ana sayfasında ve profilinde herkese aynı gösterilen geri sayım burada belirlenir. Boş bırakıp kaydedersen sayaç gizlenir. Son güncelleme: ${escapeHtml(examUpdatedAt)}</p>
      <button class="btn" id="saveExamDateBtn" type="button">Kaydet</button>
    </div>
    <div class="settings-card">
      <div class="field">
        <label>Ana sayfa motivasyon sözleri</label>
        <textarea id="motivationalPhrasesInput" rows="8" placeholder="Her satıra bir söz yaz…">${escapeHtml(phrasesList.join('\n'))}</textarea>
      </div>
      <p class="settings-hint">Ana sayfa header'ında, "Merhaba, [Ad]!" yazısının altındaki kırmızı şeritte gösterilir. Her gün listeden bir söz otomatik seçilir (gün sırasına göre, sabit). Boş satırlar yok sayılır. Son güncelleme: ${escapeHtml(phrasesUpdatedAt)}</p>
      <button class="btn" id="saveMotivationalPhrasesBtn" type="button">Kaydet</button>
    </div>`;
  document.getElementById('saveExamDateBtn').addEventListener('click', saveExamDate);
  document.getElementById('saveMotivationalPhrasesBtn').addEventListener('click', saveMotivationalPhrases);
}

async function saveExamDate() {
  const input = document.getElementById('examDateInput');
  const value = input.value || null;
  const btn = document.getElementById('saveExamDateBtn');
  btn.disabled = true;
  // A-07 (2026-09-15): Satır yoksa oluşturulur; RLS reddi (0 satır) hata sayılır.
  if (value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    btn.disabled = false;
    showToast('Geçersiz tarih biçimi.', true);
    return;
  }
  const { data: saved, error } = await supabaseClient
    .from('app_settings')
    .upsert({ key: 'exam_date', value, updated_at: new Date().toISOString() }, { onConflict: 'key' })
    .select('key');
  btn.disabled = false;
  if (error || !saved || saved.length === 0) {
    showToast(`Kaydedilemedi: ${error?.message || 'yetki yok ya da kayıt oluşturulamadı.'}`, true);
    return;
  }
  showToast('Sınav tarihi güncellendi.');
  loadSettings();
}

async function saveMotivationalPhrases() {
  const textarea = document.getElementById('motivationalPhrasesInput');
  const btn = document.getElementById('saveMotivationalPhrasesBtn');
  const phrases = textarea.value
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);
  if (!phrases.length) {
    showToast('En az bir söz girmelisin.', true);
    return;
  }
  btn.disabled = true;
  const { data: saved, error } = await supabaseClient
    .from('app_settings')
    .upsert({ key: 'motivational_phrases', value: JSON.stringify(phrases), updated_at: new Date().toISOString() }, { onConflict: 'key' })
    .select('key');
  btn.disabled = false;
  if (error || !saved || saved.length === 0) {
    showToast(`Kaydedilemedi: ${error?.message || 'yetki yok ya da kayıt oluşturulamadı.'}`, true);
    return;
  }
  showToast(`${phrases.length} söz kaydedildi.`);
  loadSettings();
}
