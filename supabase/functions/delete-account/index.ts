import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ---------------------------------------------------------------------------
// delete-account
//
// Kullanıcının kendi hesabını ve ilişkili verilerini kalıcı olarak siler.
// Çağıran kullanıcı JWT ile doğrulanır; yalnızca KENDİ hesabını silebilir.
//
// 2026-09-15 revizyonu (D-03):
//   * Tablo tablo, transaction'sız silme kaldırıldı. Kullanıcıya bağlı tüm
//     public tablolar auth.users'a (doğrudan veya profiles üzerinden)
//     ON DELETE CASCADE ile bağlı olduğundan tek bir auth.admin.deleteUser
//     çağrısı hepsini aynı veritabanı işleminde siler. Yarıda kalmış
//     "kısmen silinmiş hesap" durumu oluşmaz.
//   * question_feedback.user_id ON DELETE SET NULL olduğu için kullanıcının
//     serbest metin notları hesap silindikten sonra da kalıyordu. Notlar
//     silme işleminden ÖNCE temizlenir (bu adım başarısız olursa hesap
//     silinmez; başarılı olup silme başarısız olursa yalnızca notlar
//     boşalmış olur, bu da kullanıcı açısından zararsızdır).
//   * Kaynak kod depoya alındı (O-03).
//
// Not: purchases satırları da CASCADE ile silinir (önceki davranışla aynı).
// Mali kayıt saklama yükümlülüğü varsa bu satırlar silinmeden önce
// anonimleştirilmiş bir arşive taşınmalıdır — hukuki değerlendirme gerekir.
// ---------------------------------------------------------------------------

const ALLOWED_ORIGINS = new Set([
  'https://zrlsllbgqrllwgjyqbfv.supabase.co',
  'https://sinavrotasi.github.io',
  'capacitor://localhost',
  'http://localhost',
  'https://localhost',
]);
const DEFAULT_ORIGIN = 'https://zrlsllbgqrllwgjyqbfv.supabase.co';

function corsHeaders(request: Request) {
  const origin = request.headers.get('origin') || '';
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.has(origin) ? origin : DEFAULT_ORIGIN,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}

function response(request: Request, body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(request), 'Content-Type': 'application/json; charset=utf-8' },
  });
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(request) });
  if (request.method !== 'POST') return response(request, { error: 'Yalnızca POST desteklenir.' }, 405);

  const authorization = request.headers.get('authorization') || '';
  if (!/^Bearer\s+.+/i.test(authorization)) return response(request, { error: 'Yetkilendirme gerekli.' }, 401);

  const url = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !anonKey || !serviceRoleKey) return response(request, { error: 'Sunucu yapılandırması eksik.' }, 500);

  const authClient = createClient(url, anonKey, { global: { headers: { Authorization: authorization } } });
  const { data: { user }, error: authError } = await authClient.auth.getUser();
  if (authError || !user) return response(request, { error: 'Oturum doğrulanamadı.' }, 401);

  const serviceClient = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const { error: feedbackError } = await serviceClient
    .from('question_feedback')
    .update({ message: null })
    .eq('user_id', user.id);
  if (feedbackError) {
    console.error('Geri bildirim notları temizlenemedi:', feedbackError.message);
    return response(request, { error: 'Hesap silinirken hata oluştu. Lütfen tekrar deneyin.' }, 500);
  }

  // auth.users silinince profiles, flashcard_progress (profiles üzerinden),
  // topic_free_attempts, quiz_sessions, purchases ve user_events CASCADE ile
  // aynı işlemde silinir; question_feedback.user_id NULL'a çekilir.
  const { error: deleteUserError } = await serviceClient.auth.admin.deleteUser(user.id);
  if (deleteUserError) {
    console.error('Hesap silme hatası:', deleteUserError.message);
    return response(request, { error: 'Hesap silinirken hata oluştu. Lütfen tekrar deneyin.' }, 500);
  }

  return response(request, { ok: true });
});
