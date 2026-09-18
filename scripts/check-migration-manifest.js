#!/usr/bin/env node
/*
 * Yerel migration dosyaları, doğrulanmış production grafiğiyle birebir eşleşmeli.
 *
 * files        : production'da uygulanmış migration'lar (supabase migration list --linked).
 * pendingFiles : kaynakta hazırlanmış ama production'a HENÜZ uygulanmamış migration'lar.
 *                Test bunları kabul eder ama her çalıştırmada görünür biçimde uyarır;
 *                böylece "kaynakta var, canlıda yok" sapması sessiz kalmaz.
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const manifestPath = path.join(root, 'supabase', 'production-migrations.json');
const migrationsPath = path.join(root, 'supabase', 'migrations');

function fail(message) {
  throw new Error(message);
}

let manifest;
try {
  manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
} catch (error) {
  fail(`Migration manifest okunamadı: ${error.message}`);
}

if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
  fail('Migration manifest geçerli bir files dizisi içermiyor.');
}
const pending = Array.isArray(manifest.pendingFiles) ? manifest.pendingFiles : [];

const applied = [...manifest.files].sort();
const expected = [...applied, ...pending].sort();
const actual = fs.readdirSync(migrationsPath)
  .filter(file => file.endsWith('.sql'))
  .sort();

const duplicate = expected.find((file, index) => index > 0 && file === expected[index - 1]);
if (duplicate) fail(`Migration manifest yinelenen dosya içeriyor (files ve pendingFiles çakışıyor olabilir): ${duplicate}`);

for (const file of expected) {
  if (!/^\d{14}_[a-z0-9_]+\.sql$/.test(file)) {
    fail(`Migration adı geçersiz: ${file}`);
  }
}

const lastApplied = applied[applied.length - 1];
const stalePending = pending.filter(file => file <= lastApplied);
if (stalePending.length) {
  fail(`Bekleyen migration'lar son uygulanmış migration'dan (${lastApplied}) daha eski zaman damgası taşıyor: ${stalePending.join(', ')}`);
}

if (JSON.stringify(actual) !== JSON.stringify(expected)) {
  const missing = expected.filter(file => !actual.includes(file));
  const unexpected = actual.filter(file => !expected.includes(file));
  fail(`Migration geçmişi production manifestiyle eşleşmiyor. Eksik: ${missing.join(', ') || '-'}; Fazla: ${unexpected.join(', ') || '-'}`);
}

console.log(`✓ ${applied.length} migration production manifestiyle eşleşiyor.`);
if (pending.length) {
  console.warn(`⚠ ${pending.length} migration production'a henüz uygulanmadı:\n  - ${pending.join('\n  - ')}`);
}
