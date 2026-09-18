#!/usr/bin/env node
/* Cihaz-bazlı ilerleme sayaçlarının kayıpsız ve idempotent birleşme testi. */
const assert = require('assert/strict');
const sync = require('../www/progress-sync.js');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function merge(left, right) {
  const result = {};
  sync.mergeProgressCounters(result, left, right, 'user-1');
  return result;
}

const historical = {
  userId: 'user-1',
  answers: 10,
  correctAnswers: 7,
  dailyAnswers: { '2026-08-14': 10 },
  docStats: { 'law-657': { attempts: 10, correct: 7 } }
};

const phone = sync.normalizeProgressCounters(clone(historical), 'user-1');
const tablet = sync.normalizeProgressCounters(clone(historical), 'user-1');

sync.recordAnswer(phone, 'phone-a', true, '2026-08-14', 'law-657', 'user-1');
sync.recordAnswer(tablet, 'tablet-b', false, '2026-08-14', 'law-657', 'user-1');

const firstMerge = merge(phone, tablet);
assert.equal(firstMerge.answers, 12, 'İki cihazdaki farklı cevaplar toplanmalı.');
assert.equal(firstMerge.correctAnswers, 8, 'Doğru cevap sayısı kaybolmamalı.');
assert.equal(firstMerge.dailyAnswers['2026-08-14'], 12, 'Günlük sayaç kayıpsız birleşmeli.');
assert.deepEqual(firstMerge.docStats['law-657'], { attempts: 12, correct: 8 }, 'Konu istatistiği kayıpsız birleşmeli.');

const repeatedMerge = merge(firstMerge, tablet);
assert.equal(repeatedMerge.answers, 12, 'Aynı cihazın eski kopyası ikinci kez sayılmamalı.');
assert.equal(repeatedMerge.correctAnswers, 8, 'Birleşme idempotent olmalı.');

// ---- 2026-09-15: O-06 / O-10 / D-06 senaryoları ----
function baseProgress(extra = {}) {
  return sync.ensureClocks({
    userId: 'user-1', answers: 0, correctAnswers: 0, dailyAnswers: {}, docStats: {}, counterShards: {},
    wrongQuestions: {}, flaggedQuestions: {}, reportedQuestions: {}, completedSections: {},
    completedTests: [], purchasedRoles: [], seenBitmap: '', dailyGoal: 20,
    notificationPrefs: { dailyReminder: true }, selectedRole: 'memur', lastActivity: null,
    ...extra
  });
}

// O-06: Bir cihazda silinen yanlış soru, diğer cihazın eski kopyasıyla geri gelmemeli.
{
  const server = baseProgress();
  sync.setKey(server, 'wrongQuestions', 'q1', { id: 'q1' }, 1000);
  const phone = clone(server);
  const tablet = clone(server);
  sync.deleteKey(phone, 'wrongQuestions', 'q1', 2000);
  const merged = sync.mergeProgress(tablet, phone, 'user-1');
  assert.equal(merged.wrongQuestions.q1, undefined, 'Silinen yanlış soru geri gelmemeli.');
  const mergedReverse = sync.mergeProgress(phone, tablet, 'user-1');
  assert.equal(mergedReverse.wrongQuestions.q1, undefined, 'Birleşme sırası sonucu değiştirmemeli.');

  // Silmeden sonra tekrar eklenirse (daha yeni saat) kayıt geri gelmeli.
  sync.setKey(tablet, 'wrongQuestions', 'q1', { id: 'q1', again: true }, 3000);
  const readded = sync.mergeProgress(phone, tablet, 'user-1');
  assert.deepEqual(readded.wrongQuestions.q1, { id: 'q1', again: true }, 'Daha yeni ekleme kazanmalı.');
}

// O-06: Saatsiz (eski) kayıt, saatli silmeye karşı kaybetmeli.
{
  const legacy = baseProgress({ flaggedQuestions: { q9: true } });
  const fresh = baseProgress();
  sync.deleteKey(fresh, 'flaggedQuestions', 'q9', 5000);
  const merged = sync.mergeProgress(legacy, fresh, 'user-1');
  assert.equal(merged.flaggedQuestions.q9, undefined, 'Eski kopyadaki işaret, yeni silmeyi ezmemeli.');
  const keep = sync.mergeProgress(legacy, baseProgress(), 'user-1');
  assert.equal(keep.flaggedQuestions.q9, true, 'Saatsiz eski kayıtlar korunmalı.');
}

// O-06: Ayarlar daha çok soru çözmüş taraftan değil, en son değiştirilen taraftan gelmeli.
{
  const busy = baseProgress({ dailyGoal: 20 });
  sync.recordAnswer(busy, 'dev-a', true, '2026-09-01', 'law-657', 'user-1');
  sync.recordAnswer(busy, 'dev-a', true, '2026-09-01', 'law-657', 'user-1');
  sync.touchField(busy, 'dailyGoal', 1000);
  const quiet = baseProgress({ dailyGoal: 50 });
  sync.touchField(quiet, 'dailyGoal', 2000);
  const merged = sync.mergeProgress(busy, quiet, 'user-1');
  assert.equal(merged.dailyGoal, 50, 'En son değiştirilen günlük hedef kazanmalı.');
  assert.equal(merged.answers, 2, 'Sayaçlar yine korunmalı.');
}

// O-10: Sıfırlama sonrası eski kopya veriyi geri getirmemeli; ayarlar korunmalı.
{
  const old = baseProgress({ dailyGoal: 30 });
  sync.recordAnswer(old, 'dev-a', true, '2026-09-01', 'law-657', 'user-1');
  sync.setKey(old, 'wrongQuestions', 'q2', { id: 'q2' }, 1000);
  sync.markSeen(old, 'q2');
  old.completedTests = [{ id: 't1', kind: 'random', completedAt: '2026-09-01T10:00:00Z' }];
  sync.touchField(old, 'dailyGoal', 1000);

  const reset = baseProgress({ dailyGoal: 30, resetAt: Date.parse('2026-09-10T00:00:00Z') });
  reset.fieldClocks = { dailyGoal: 1000 };
  const merged = sync.mergeProgress(old, reset, 'user-1');
  assert.equal(merged.answers, 0, 'Sıfırlama öncesi sayaçlar geri gelmemeli.');
  assert.deepEqual(merged.wrongQuestions, {}, 'Sıfırlama öncesi yanlışlar geri gelmemeli.');
  assert.deepEqual(merged.completedTests, [], 'Sıfırlama öncesi testler geri gelmemeli.');
  assert.equal(sync.estimateSeenCount(merged.seenBitmap), 0, 'Görülen sorular sıfırlanmalı.');
  assert.equal(merged.dailyGoal, 30, 'Ayarlar sıfırlamadan etkilenmemeli.');
  assert.equal(merged.resetAt, reset.resetAt, 'Yeni sıfırlama dönemi korunmalı.');

  // Sıfırlamadan sonra yapılan çalışma birleşmede korunmalı.
  sync.recordAnswer(reset, 'dev-b', false, '2026-09-11', 'law-222', 'user-1');
  const after = sync.mergeProgress(old, reset, 'user-1');
  assert.equal(after.answers, 1, 'Sıfırlama sonrası çalışma korunmalı.');
}

// D-06: Görülen soru sayısı tekrarları saymamalı ve cihazlar arasında OR ile birleşmeli.
{
  const a = baseProgress();
  const b = baseProgress();
  for (let i = 0; i < 300; i++) sync.markSeen(a, `q-${i}`);
  for (let i = 0; i < 300; i++) sync.markSeen(a, `q-${i}`); // tekrar
  for (let i = 200; i < 500; i++) sync.markSeen(b, `q-${i}`);
  const estimateA = sync.estimateSeenCount(a.seenBitmap);
  assert.ok(Math.abs(estimateA - 300) <= 6, `Tekrarlar sayılmamalı (tahmin: ${estimateA}).`);
  const merged = sync.mergeProgress(a, b, 'user-1');
  const estimate = sync.estimateSeenCount(merged.seenBitmap);
  assert.ok(Math.abs(estimate - 500) <= 10, `Birleşik farklı soru sayısı ~500 olmalı (tahmin: ${estimate}).`);
  const big = baseProgress();
  for (let i = 0; i < 7646; i++) sync.markSeen(big, `question-${i}`);
  const bigEstimate = sync.estimateSeenCount(big.seenBitmap);
  assert.ok(Math.abs(bigEstimate - 7646) / 7646 < 0.03, `Tüm banka tahmini %3 içinde olmalı (tahmin: ${bigEstimate}).`);
  assert.ok(big.seenBitmap.length < 6000, 'Bit dizisi boyutu sınırlı kalmalı.');
}

// Silme işaretçileri süresi dolunca budanmalı.
{
  const p = baseProgress();
  sync.deleteKey(p, 'wrongQuestions', 'old', 1);
  sync.deleteKey(p, 'wrongQuestions', 'new', Date.now());
  sync.pruneTombstones(p);
  assert.equal(p.mapClocks.wrongQuestions.old, undefined, 'Eski silme işaretçisi budanmalı.');
  assert.ok(p.mapClocks.wrongQuestions.new, 'Yeni silme işaretçisi korunmalı.');
}

console.log('✓ İlerleme CRDT birleşme testleri geçti.');
console.log('✓ Silme işaretçisi, ayar saati, sıfırlama dönemi ve görülen soru testleri geçti.');
