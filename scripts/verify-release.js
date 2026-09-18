#!/usr/bin/env node
/* Sürüm paketi için çevrimdışı, tekrarlanabilir doğrulamalar. */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const resolve = (...parts) => path.join(root, ...parts);

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function read(relative) {
  return fs.readFileSync(resolve(relative), 'utf8');
}

function json(relative) {
  try {
    return JSON.parse(read(relative));
  } catch (error) {
    fail(`${relative} geçerli JSON değil: ${error.message}`);
  }
}

function listFiles(directory) {
  const absolute = resolve(directory);
  const out = [];

  const walk = (current, prefix = '') => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const rel = path.join(prefix, entry.name);
      const file = path.join(current, entry.name);

      if (entry.isDirectory()) {
        walk(file, rel);
      } else if (entry.isFile()) {
        out.push(rel);
      }
    }
  };

  walk(absolute);
  return out.sort();
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    fail(
      `${command} ${args.join(' ')} başarısız oldu:\n` +
      `${result.stdout}${result.stderr}`
    );
  }
}

function countChunks(prefix) {
  return listFiles('supabase/export/production')
    .filter(file => new RegExp(`^${prefix}-\\d{3}\\.json$`).test(file))
    .flatMap(file => json(`supabase/export/production/${file}`));
}

function assertUnique(rows, key, label) {
  const ids = new Set(rows.map(key));

  assert(
    ids.size === rows.length,
    `${label} içinde yinelenen kimlik bulundu.`
  );
}

/* JavaScript ve regresyon kontrolleri */
run(process.execPath, ['--check', 'www/app.js']);
run(process.execPath, ['--check', 'www/content-repo.js']);
run(process.execPath, ['--check', 'www/progress-sync.js']);
run(process.execPath, ['scripts/check_no_answer_leak.js']);
run(process.execPath, ['scripts/test-progress-sync.js']);
run(process.execPath, ['scripts/test-auth-routing.js']);
run(process.execPath, ['scripts/check-migration-manifest.js']);
run('python3', ['scripts/generate_seed.py', '--check']);

/* Production veri kontrolleri */
const questions = countChunks('questions');
const flashcards = countChunks('flashcards');

assert(
  questions.length === 7572,
  `Production soru anlık görüntüsü eksik: ${questions.length}/7572.`
);

assert(
  flashcards.length === 1150,
  `Production flashcard anlık görüntüsü eksik: ${flashcards.length}/1150.`
);

assertUnique(
  questions,
  row => row.id,
  'Production soru anlık görüntüsü'
);

assertUnique(
  flashcards,
  row => `${row.deck_id}:${row.sort_order}`,
  'Production flashcard anlık görüntüsü'
);

// NOT (2026-09-04): deneme_questions kontrolü kaldırıldı.
// Tablo drop_legacy_dual_deneme_tables migration'ıyla düşürüldü.

/* Edge Function güvenlik kontrolleri */
const edge = read('supabase/functions/report-question/index.ts');

assert(
  !edge.includes('user_display'),
  'Edge Function user_display alanına başvurmamalı.'
);

assert(
  !edge.includes('question.prompt'),
  'Edge Function soru metnini dış sisteme aktarmamalı.'
);

assert(
  edge.includes('verify_jwt = true') ||
  read('supabase/config.toml').includes('[functions.report-question]'),
  'report-question JWT ayarı eksik.'
);

/* Kimlik doğrulama kontrolleri */
const supabaseClient = read('www/supabaseClient.js');
const authCommon = read('www/auth-common.js');
const indexHtml = read('www/index.html');
const signupHtml = read('www/signup.html');

assert(
  supabaseClient.includes("flowType: 'pkce'"),
  'Supabase Auth PKCE akışı etkin değil.'
);

assert(
  authCommon.includes('exchangeCodeForSession'),
  'Native PKCE callback kod değişimi eksik.'
);

assert(
  authCommon.includes('passwordRequirementError'),
  'İstemci parola politikasını doğrulamıyor.'
);

assert(
  authCommon.includes('redirectToApp'),
  'Native callback için güvenli uygulama yönlendirmesi eksik.'
);

assert(
  indexHtml.includes('src="auth-common.js"'),
  'Cold-start native callback dinleyicisi index.html içinde yüklenmiyor.'
);

assert(
  signupHtml.includes('minlength="8"'),
  'Kayıt ekranı parola uzunluğu politikasıyla eşleşmiyor.'
);

/* Paket sürümü kontrolü */
const packageMeta = json('package.json');

assert(
  typeof packageMeta.version === 'string' &&
  /^\d+\.\d+\.\d+$/.test(packageMeta.version),
  'package.json sürüm bilgisi geçersiz.'
);

/*
 * Bu depo yalnızca iOS sürümünü üretir.
 *
 * Android platform kopyası, AndroidManifest ve Gradle doğrulamaları
 * Android deposundaki release kontrolüne aittir. iOS testleri Android
 * varlıklarına bağlı değildir.
 *
 * Web kaynakları, auth akışları, veri anlık görüntüleri, migration'lar
 * ve paket sürümü doğrulanmaya devam eder.
 */

/* Zorunlu migration kontrolleri */
for (const migration of [
  '20260814081802_admin_bypass_on_content_read.sql',
  '20260812110139_add_progress_optimistic_lock.sql',
  '20260813185859_enforce_canonical_root_in_free_quota.sql',
  '20260813202523_harden_feedback_and_function_surface.sql',
  '20260813203501_optimize_rls_and_foreign_keys.sql',
]) {
  assert(
    fs.existsSync(resolve('supabase/migrations', migration)),
    `Eksik Supabase migration: ${migration}`
  );
}

console.log('Sürüm doğrulamaları başarılı.');