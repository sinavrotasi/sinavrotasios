/*
 * SınavRotası ilerleme sayaçları için cihaz-bazlı, birleşebilir sayaçlar.
 *
 * Aynı kullanıcının iki cihazda çevrimdışı çalışması durumunda tek bir toplam
 * sayacı `max()` ile seçmek veri kaybına neden olur. Her cihaz kendi artan
 * sayacını taşır; cihaz kopyaları birleştirilirken yalnız aynı cihazın en son
 * değeri seçilir. Genel toplam, cihaz sayaçlarının toplamından türetilir.
 */
(function registerProgressSync(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.SRProgressSync = api;
})(typeof window !== 'undefined' ? window : globalThis, function createProgressSync() {
  const MAX_COUNTER = Number.MAX_SAFE_INTEGER;
  const MAX_SHARD_ID_LENGTH = 180;

  function count(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) return 0;
    return Math.min(MAX_COUNTER, Math.floor(numeric));
  }

  function record(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  }

  function validShardId(value) {
    return typeof value === 'string'
      && value.length > 0
      && value.length <= MAX_SHARD_ID_LENGTH
      && /^[a-zA-Z0-9_.:-]+$/.test(value);
  }

  function normalizeDailyAnswers(value) {
    const result = {};
    Object.entries(record(value)).forEach(([day, rawCount]) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return;
      const safeCount = count(rawCount);
      if (safeCount) result[day] = safeCount;
    });
    return result;
  }

  function normalizeDocStats(value) {
    const result = {};
    Object.entries(record(value)).forEach(([documentId, rawStats]) => {
      if (typeof documentId !== 'string' || !documentId || documentId.length > 180) return;
      const attempts = count(rawStats && rawStats.attempts);
      const correct = Math.min(attempts, count(rawStats && rawStats.correct));
      if (attempts || correct) result[documentId] = { attempts, correct };
    });
    return result;
  }

  function normalizeShard(value) {
    const attempts = count(value && value.answers);
    return {
      answers: attempts,
      correctAnswers: Math.min(attempts, count(value && value.correctAnswers)),
      dailyAnswers: normalizeDailyAnswers(value && value.dailyAnswers),
      docStats: normalizeDocStats(value && value.docStats)
    };
  }

  function mergeMapsByMaximum(left, right) {
    const merged = { ...normalizeDailyAnswers(left) };
    Object.entries(normalizeDailyAnswers(right)).forEach(([key, value]) => {
      merged[key] = Math.max(merged[key] || 0, value);
    });
    return merged;
  }

  function mergeDocStats(left, right) {
    const merged = { ...normalizeDocStats(left) };
    Object.entries(normalizeDocStats(right)).forEach(([documentId, stats]) => {
      const existing = merged[documentId] || { attempts: 0, correct: 0 };
      const attempts = Math.max(existing.attempts, stats.attempts);
      const correct = Math.min(attempts, Math.max(existing.correct, stats.correct));
      merged[documentId] = { attempts, correct };
    });
    return merged;
  }

  function mergeShard(left, right) {
    const first = normalizeShard(left);
    const second = normalizeShard(right);
    const answers = Math.max(first.answers, second.answers);
    return {
      answers,
      correctAnswers: Math.min(answers, Math.max(first.correctAnswers, second.correctAnswers)),
      dailyAnswers: mergeMapsByMaximum(first.dailyAnswers, second.dailyAnswers),
      docStats: mergeDocStats(first.docStats, second.docStats)
    };
  }

  function normalizeCounterShards(value) {
    const result = {};
    Object.entries(record(value)).forEach(([shardId, shard]) => {
      if (!validShardId(shardId)) return;
      result[shardId] = mergeShard(result[shardId], shard);
    });
    return result;
  }

  function legacyShardId(userId) {
    const identity = typeof userId === 'string' && userId ? userId : 'unassigned';
    return `legacy:${identity}`;
  }

  function aggregate(counterShards) {
    const totals = {
      answers: 0,
      correctAnswers: 0,
      dailyAnswers: {},
      docStats: {}
    };
    Object.values(normalizeCounterShards(counterShards)).forEach(shard => {
      totals.answers = Math.min(MAX_COUNTER, totals.answers + shard.answers);
      totals.correctAnswers = Math.min(MAX_COUNTER, totals.correctAnswers + shard.correctAnswers);
      Object.entries(shard.dailyAnswers).forEach(([day, amount]) => {
        totals.dailyAnswers[day] = Math.min(MAX_COUNTER, (totals.dailyAnswers[day] || 0) + amount);
      });
      Object.entries(shard.docStats).forEach(([documentId, stats]) => {
        const total = totals.docStats[documentId] || { attempts: 0, correct: 0 };
        total.attempts = Math.min(MAX_COUNTER, total.attempts + stats.attempts);
        total.correct = Math.min(total.attempts, Math.min(MAX_COUNTER, total.correct + stats.correct));
        totals.docStats[documentId] = total;
      });
    });
    totals.correctAnswers = Math.min(totals.answers, totals.correctAnswers);
    return totals;
  }

  function legacyNeedsPreserving(legacy, totals) {
    if (legacy.answers > totals.answers || legacy.correctAnswers > totals.correctAnswers) return true;
    if (Object.entries(legacy.dailyAnswers).some(([day, amount]) => amount > (totals.dailyAnswers[day] || 0))) return true;
    return Object.entries(legacy.docStats).some(([documentId, stats]) => {
      const current = totals.docStats[documentId] || { attempts: 0, correct: 0 };
      return stats.attempts > current.attempts || stats.correct > current.correct;
    });
  }

  function normalizeProgressCounters(progress, fallbackUserId) {
    if (!progress || typeof progress !== 'object') return progress;
    const counterShards = normalizeCounterShards(progress.counterShards);
    const existingTotals = aggregate(counterShards);
    const legacy = normalizeShard({
      answers: progress.answers,
      correctAnswers: progress.correctAnswers,
      dailyAnswers: progress.dailyAnswers,
      docStats: progress.docStats
    });
    if (legacyNeedsPreserving(legacy, existingTotals)) {
      const key = legacyShardId(progress.userId || fallbackUserId);
      counterShards[key] = mergeShard(counterShards[key], legacy);
    }
    progress.counterShards = counterShards;
    return recomputeCounters(progress);
  }

  function recomputeCounters(progress) {
    const totals = aggregate(progress && progress.counterShards);
    progress.answers = totals.answers;
    progress.correctAnswers = totals.correctAnswers;
    progress.dailyAnswers = totals.dailyAnswers;
    progress.docStats = totals.docStats;
    return progress;
  }

  function mergeCounterShards(left, right) {
    const merged = normalizeCounterShards(left);
    Object.entries(normalizeCounterShards(right)).forEach(([shardId, shard]) => {
      merged[shardId] = mergeShard(merged[shardId], shard);
    });
    return merged;
  }

  function mergeProgressCounters(merged, local, server, fallbackUserId) {
    const localCopy = { ...(local || {}) };
    const serverCopy = { ...(server || {}) };
    normalizeProgressCounters(localCopy, fallbackUserId);
    normalizeProgressCounters(serverCopy, fallbackUserId);
    merged.counterShards = mergeCounterShards(localCopy.counterShards, serverCopy.counterShards);
    return recomputeCounters(merged);
  }

  function recordAnswer(progress, deviceId, isCorrect, day, documentId, fallbackUserId) {
    normalizeProgressCounters(progress, fallbackUserId);
    const shardId = `device:${deviceId}`;
    if (!validShardId(shardId)) throw new Error('Geçersiz ilerleme cihaz kimliği.');
    const shard = normalizeShard(progress.counterShards[shardId]);
    shard.answers = Math.min(MAX_COUNTER, shard.answers + 1);
    if (isCorrect) shard.correctAnswers = Math.min(shard.answers, shard.correctAnswers + 1);
    if (/^\d{4}-\d{2}-\d{2}$/.test(day)) {
      shard.dailyAnswers[day] = Math.min(MAX_COUNTER, (shard.dailyAnswers[day] || 0) + 1);
    }
    if (typeof documentId === 'string' && documentId && documentId.length <= 180) {
      const stats = shard.docStats[documentId] || { attempts: 0, correct: 0 };
      stats.attempts = Math.min(MAX_COUNTER, stats.attempts + 1);
      if (isCorrect) stats.correct = Math.min(stats.attempts, stats.correct + 1);
      shard.docStats[documentId] = stats;
    }
    progress.counterShards[shardId] = shard;
    return recomputeCounters(progress);
  }

  // ===================================================================
  // 2026-09-15 (O-06 / O-10 / D-06): Çoklu cihaz birleştirme kuralları
  // ===================================================================
  //
  // 1) Anahtarlı haritalar (wrongQuestions, flaggedQuestions, reportedQuestions,
  //    completedSections) için "son yazan kazanır" (LWW) saatleri tutulur:
  //      progress.mapClocks[field][key] = { t: <ms>, d: 0|1 }
  //    Silme işlemi d:1 ile bir "mezar taşı" bırakır; böylece başka bir cihazın
  //    eski kopyası silinen kaydı geri getiremez. Saati olmayan eski kayıtlar
  //    t=0 kabul edilir (her yeni işlem onlardan sonra sayılır).
  // 2) Tekil ayarlar (dailyGoal, notificationPrefs, selectedRole, lastActivity)
  //    için progress.fieldClocks[field] = <ms> tutulur; daha yeni olan kazanır.
  // 3) Sıfırlama dönemi: progress.resetAt (ms). Birleştirmede daha eski
  //    döneme ait çalışma verisi (sayaçlar, haritalar, testler, görülen sorular)
  //    yok sayılır; ayarlar yine LWW ile birleşir.
  // 4) Görülen sorular: progress.seenBitmap — 32.768 bitlik, base64 kodlu bit
  //    dizisi. Birleştirme OR ile yapılır (CRDT). Farklı soru sayısı "linear
  //    counting" ile tahmin edilir (~7.600 soruda hata payı ~%1).

  const KEYED_FIELDS = ['wrongQuestions', 'flaggedQuestions', 'reportedQuestions', 'completedSections'];
  const CLOCKED_FIELDS = ['dailyGoal', 'notificationPrefs', 'selectedRole', 'lastActivity'];
  const TOMBSTONE_TTL_MS = 180 * 24 * 60 * 60 * 1000;
  const SEEN_BITS = 32768;
  const SEEN_BYTES = SEEN_BITS / 8;

  function nowMs() {
    return Date.now();
  }

  function clockValue(entry) {
    if (!entry || typeof entry !== 'object') return { t: 0, d: 0 };
    const t = Number(entry.t);
    return { t: Number.isFinite(t) && t > 0 ? Math.floor(t) : 0, d: entry.d ? 1 : 0 };
  }

  function ensureClocks(progress) {
    if (!progress.mapClocks || typeof progress.mapClocks !== 'object' || Array.isArray(progress.mapClocks)) {
      progress.mapClocks = {};
    }
    KEYED_FIELDS.forEach(field => {
      const bucket = progress.mapClocks[field];
      if (!bucket || typeof bucket !== 'object' || Array.isArray(bucket)) progress.mapClocks[field] = {};
    });
    if (!progress.fieldClocks || typeof progress.fieldClocks !== 'object' || Array.isArray(progress.fieldClocks)) {
      progress.fieldClocks = {};
    }
    const resetAt = Number(progress.resetAt);
    progress.resetAt = Number.isFinite(resetAt) && resetAt > 0 ? Math.floor(resetAt) : 0;
    return progress;
  }

  function setKey(progress, field, key, value, at) {
    ensureClocks(progress);
    if (!progress[field] || typeof progress[field] !== 'object') progress[field] = {};
    progress[field][key] = value;
    progress.mapClocks[field][key] = { t: at || nowMs(), d: 0 };
  }

  function deleteKey(progress, field, key, at) {
    ensureClocks(progress);
    if (progress[field] && typeof progress[field] === 'object') delete progress[field][key];
    progress.mapClocks[field][key] = { t: at || nowMs(), d: 1 };
  }

  function touchField(progress, field, at) {
    ensureClocks(progress);
    progress.fieldClocks[field] = at || nowMs();
  }

  function pruneTombstones(progress, at) {
    ensureClocks(progress);
    const limit = (at || nowMs()) - TOMBSTONE_TTL_MS;
    KEYED_FIELDS.forEach(field => {
      const bucket = progress.mapClocks[field];
      Object.keys(bucket).forEach(key => {
        const clock = clockValue(bucket[key]);
        if (clock.d && clock.t < limit) delete bucket[key];
      });
    });
    return progress;
  }

  function mergeKeyedField(field, left, right) {
    const leftMap = record(left[field]);
    const rightMap = record(right[field]);
    const leftClocks = record(left.mapClocks && left.mapClocks[field]);
    const rightClocks = record(right.mapClocks && right.mapClocks[field]);
    const keys = new Set([
      ...Object.keys(leftMap), ...Object.keys(rightMap),
      ...Object.keys(leftClocks), ...Object.keys(rightClocks)
    ]);
    const map = {};
    const clocks = {};
    keys.forEach(key => {
      const lc = clockValue(leftClocks[key]);
      const rc = clockValue(rightClocks[key]);
      const lHas = Object.prototype.hasOwnProperty.call(leftMap, key);
      const rHas = Object.prototype.hasOwnProperty.call(rightMap, key);
      // Daha yeni saat kazanır. Eşitlikte silme kazanır (aynı anda ekle/sil
      // belirsizliğinde kayıt geri gelmesin). Eşit ve ikisi de silme değilse
      // değeri olan taraf alınır (sol öncelikli).
      let winner;
      if (lc.t !== rc.t) winner = lc.t > rc.t ? 'L' : 'R';
      else if (lc.d || rc.d) winner = lc.d ? 'L' : 'R';
      else winner = lHas ? 'L' : 'R';
      const clock = winner === 'L' ? lc : rc;
      const has = winner === 'L' ? lHas : rHas;
      const value = winner === 'L' ? leftMap[key] : rightMap[key];
      if (!clock.d) {
        if (has) map[key] = value;
        else if (lHas) map[key] = leftMap[key];
        else if (rHas) map[key] = rightMap[key];
      }
      if (clock.t > 0 || clock.d) clocks[key] = clock;
    });
    return { map, clocks };
  }

  function mergeClockedFields(target, left, right, preferred) {
    const lc = record(left.fieldClocks);
    const rc = record(right.fieldClocks);
    const clocks = {};
    CLOCKED_FIELDS.forEach(field => {
      const lt = Number(lc[field]) || 0;
      const rt = Number(rc[field]) || 0;
      let source;
      if (lt !== rt) source = lt > rt ? left : right;
      else source = preferred;
      if (Object.prototype.hasOwnProperty.call(source, field)) target[field] = source[field];
      const t = Math.max(lt, rt);
      if (t > 0) clocks[field] = t;
    });
    target.fieldClocks = clocks;
    return target;
  }

  // ---- Görülen soru bit dizisi ----
  function toBase64(bytes) {
    if (typeof btoa === 'function') {
      let binary = '';
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      return btoa(binary);
    }
    return Buffer.from(bytes).toString('base64');
  }

  function fromBase64(text) {
    const bytes = new Uint8Array(SEEN_BYTES);
    if (typeof text !== 'string' || !text) return bytes;
    try {
      let raw;
      if (typeof atob === 'function') {
        const binary = atob(text);
        raw = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) raw[i] = binary.charCodeAt(i);
      } else {
        raw = new Uint8Array(Buffer.from(text, 'base64'));
      }
      if (raw.length !== SEEN_BYTES) return bytes;
      bytes.set(raw);
    } catch (_) {
      // Bozuk değer: boş dizi ile devam.
    }
    return bytes;
  }

  function hashQuestionId(id) {
    // FNV-1a 32 bit
    let hash = 0x811c9dc5;
    const text = String(id);
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash % SEEN_BITS;
  }

  function markSeen(progress, questionId) {
    if (questionId == null || questionId === '') return progress;
    const bytes = fromBase64(progress.seenBitmap);
    const bit = hashQuestionId(questionId);
    bytes[bit >> 3] |= (1 << (bit & 7));
    progress.seenBitmap = toBase64(bytes);
    return progress;
  }

  function mergeSeen(left, right) {
    const a = fromBase64(left);
    const b = fromBase64(right);
    let any = false;
    for (let i = 0; i < SEEN_BYTES; i++) {
      a[i] |= b[i];
      if (a[i]) any = true;
    }
    return any ? toBase64(a) : '';
  }

  function estimateSeenCount(bitmap) {
    const bytes = fromBase64(bitmap);
    let set = 0;
    for (let i = 0; i < SEEN_BYTES; i++) {
      let v = bytes[i];
      while (v) { set += v & 1; v >>= 1; }
    }
    if (set === 0) return 0;
    const zero = SEEN_BITS - set;
    if (zero === 0) return SEEN_BITS; // doygunluk (pratikte ulaşılmaz)
    return Math.round(-SEEN_BITS * Math.log(zero / SEEN_BITS));
  }

  // ---- Tam ilerleme birleştirmesi ----
  // Sayaç dışındaki tüm alanları kurallara göre birleştirir. Sayaçlar için
  // mergeProgressCounters kullanılır. Dönen nesne yeni bir kopyadır.
  function mergeProgress(local, server, fallbackUserId) {
    if (!server) return local;
    if (!local) return server;
    const l = ensureClocks({ ...local });
    const r = ensureClocks({ ...server });

    // Sıfırlama dönemi farklıysa eski dönemin çalışma verisi yok sayılır.
    const epoch = Math.max(l.resetAt, r.resetAt);
    const lData = l.resetAt === epoch;
    const rData = r.resetAt === epoch;
    const emptyData = { counterShards: {}, answers: 0, correctAnswers: 0, dailyAnswers: {}, docStats: {}, completedTests: [], seenBitmap: '', mapClocks: {} };
    KEYED_FIELDS.forEach(field => { emptyData[field] = {}; });
    const lEff = lData ? l : { ...l, ...emptyData };
    const rEff = rData ? r : { ...r, ...emptyData };

    const base = (Number(lEff.answers) || 0) >= (Number(rEff.answers) || 0) ? lEff : rEff;
    const merged = { ...base, resetAt: epoch, mapClocks: {} };

    KEYED_FIELDS.forEach(field => {
      const { map, clocks } = mergeKeyedField(field, lEff, rEff);
      merged[field] = map;
      merged.mapClocks[field] = clocks;
    });

    mergeClockedFields(merged, l, r, base === lEff ? l : r);

    mergeProgressCounters(merged, lEff, rEff, merged.userId || l.userId || r.userId || fallbackUserId);

    const seen = new Set();
    merged.completedTests = [...(lEff.completedTests || []), ...(rEff.completedTests || [])].filter(test => {
      if (!test || typeof test !== 'object') return false;
      const completedMs = Date.parse(test.completedAt || '');
      if (epoch && (!Number.isFinite(completedMs) || completedMs < epoch)) return false;
      const key = test.id || `${test.kind}-${test.completedAt || ''}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    merged.seenBitmap = mergeSeen(lEff.seenBitmap, rEff.seenBitmap);
    merged.purchasedRoles = Array.from(new Set([...(l.purchasedRoles || []), ...(r.purchasedRoles || [])]));
    return pruneTombstones(merged);
  }

  return {
    aggregate,
    legacyShardId,
    mergeCounterShards,
    mergeProgressCounters,
    normalizeProgressCounters,
    recordAnswer,
    recomputeCounters,
    ensureClocks,
    setKey,
    deleteKey,
    touchField,
    pruneTombstones,
    markSeen,
    mergeSeen,
    estimateSeenCount,
    hashQuestionId,
    mergeProgress,
    KEYED_FIELDS,
    CLOCKED_FIELDS
  };
});
