import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ---------------------------------------------------------------------------
// verify-apple-purchase
//
// verify-play-purchase'ın iOS karşılığı. İstemciden (iOS/Capacitor, StoreKit 2)
// gelen transaction_id'yi App Store Server API ile Apple'dan doğrular ve
// public.apply_verified_purchase() RPC'siyle premium verir. İstemci
// is_premium'u doğrudan yazamaz; tek yetkili yol bu fonksiyondur.
//
// Ürünler App Store Connect'te "Non-Renewing Subscription" tipindedir.
// Süreyi Apple takip etmez; süre premium_products.duration_days'ten gelir.
//
// Gerekli secret'lar:
//   APPLE_IAP_KEY_ID        App Store Connect > Users and Access > Integrations
//                           > In-App Purchase bölümündeki Key ID
//   APPLE_IAP_ISSUER_ID     aynı sayfadaki Issuer ID
//   APPLE_IAP_PRIVATE_KEY   indirilen AuthKey_XXXX.p8 dosyasının içeriği
//   APPLE_BUNDLE_ID         (opsiyonel) varsayılan: com.sinavrotasi.mebgys
// ---------------------------------------------------------------------------

const ALLOWED_ORIGINS = new Set([
  'https://zrlsllbgqrllwgjyqbfv.supabase.co',
  'capacitor://localhost',
  'http://localhost',
  'https://localhost',
]);
const DEFAULT_ORIGIN = 'https://zrlsllbgqrllwgjyqbfv.supabase.co';

const BUNDLE_ID = Deno.env.get('APPLE_BUNDLE_ID') ?? 'com.sinavrotasi.mebgys';
const PRODUCTION_API = 'https://api.storekit.itunes.apple.com';
const SANDBOX_API = 'https://api.storekit-sandbox.itunes.apple.com';

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

const PRODUCT_ID_PATTERN = /^[a-z0-9][a-z0-9_.]{0,99}$/;
const TRANSACTION_ID_PATTERN = /^[0-9]{6,20}$/;

function normalizeProductId(value: unknown): string {
  if (typeof value !== 'string') throw new Error('product_id gereklidir.');
  const id = value.trim();
  if (!PRODUCT_ID_PATTERN.test(id)) throw new Error('Geçersiz product_id.');
  return id;
}

function normalizeTransactionId(value: unknown): string {
  const id = String(value ?? '').trim();
  if (!TRANSACTION_ID_PATTERN.test(id)) throw new Error('Geçersiz transaction_id.');
  return id;
}

// ---- App Store Server API: JWT (ES256) ----

function base64UrlEncode(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let str = '';
  for (const byte of arr) str += String.fromCharCode(byte);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const cleaned = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s+/g, '');
  const binary = atob(cleaned);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function createAppleJwt(): Promise<string> {
  const keyId = Deno.env.get('APPLE_IAP_KEY_ID');
  const issuerId = Deno.env.get('APPLE_IAP_ISSUER_ID');
  const privateKeyPem = Deno.env.get('APPLE_IAP_PRIVATE_KEY');
  if (!keyId || !issuerId || !privateKeyPem) throw new Error('Apple IAP yapılandırması eksik.');

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'ES256', kid: keyId, typ: 'JWT' };
  const claims = { iss: issuerId, iat: now, exp: now + 1200, aud: 'appstoreconnect-v1', bid: BUNDLE_ID };

  const encoder = new TextEncoder();
  const unsigned = `${base64UrlEncode(encoder.encode(JSON.stringify(header)))}.${base64UrlEncode(encoder.encode(JSON.stringify(claims)))}`;

  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToArrayBuffer(privateKeyPem.replace(/\\n/g, '\n')),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  // WebCrypto ECDSA çıktısı ham r||s biçimindedir; JWT ES256 de bunu bekler.
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, encoder.encode(unsigned));
  return `${unsigned}.${base64UrlEncode(signature)}`;
}

// ---- App Store Server API: işlem sorgulama ----

interface AppleTransaction {
  transactionId?: string;
  originalTransactionId?: string;
  bundleId?: string;
  productId?: string;
  type?: string; // "Non-Renewing Subscription"
  purchaseDate?: number; // ms
  revocationDate?: number;
  appAccountToken?: string;
  environment?: string; // "Production" | "Sandbox"
}

function decodeJwsPayload(jws: string): AppleTransaction {
  const part = jws.split('.')[1] ?? '';
  const b64 = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=');
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

async function fetchAppleTransaction(jwt: string, transactionId: string): Promise<AppleTransaction> {
  // Önce production; bulunamazsa sandbox (TestFlight ve App Review sandbox'tır).
  for (const base of [PRODUCTION_API, SANDBOX_API]) {
    const res = await fetch(`${base}/inApps/v1/transactions/${encodeURIComponent(transactionId)}`, {
      headers: { Authorization: `Bearer ${jwt}` },
    });
    if (res.status === 404) continue;
    if (!res.ok) throw new Error(`Apple doğrulaması başarısız: ${res.status} ${await res.text()}`);
    const body = await res.json();
    if (typeof body.signedTransactionInfo !== 'string') throw new Error('Apple yanıtı geçersiz.');
    // Veri doğrudan Apple'dan TLS üzerinden, bizim JWT'mizle alındığı için JWS
    // imza zinciri burada ayrıca doğrulanmıyor. (Webhook'ta doğrulanmalı.)
    return decodeJwsPayload(body.signedTransactionInfo);
  }
  throw new Error('İşlem Apple tarafında bulunamadı.');
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

  let payload: Record<string, unknown>;
  try {
    payload = await request.json();
  } catch {
    return response(request, { error: 'Geçersiz JSON gövdesi.' }, 400);
  }

  let productId: string;
  let transactionId: string;
  try {
    productId = normalizeProductId(payload.product_id);
    transactionId = normalizeTransactionId(payload.transaction_id);
  } catch (error) {
    return response(request, { error: error instanceof Error ? error.message : 'Geçersiz istek.' }, 400);
  }

  const serviceClient = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });

  // Ürün aktif listede olmalı; süre buradan okunur.
  const { data: product, error: productError } = await serviceClient
    .from('premium_products')
    .select('product_id, duration_days')
    .eq('product_id', productId)
    .eq('is_active', true)
    .maybeSingle();
  if (productError) {
    console.error('Ürün listesi okunamadı:', productError);
    return response(request, { error: 'Sunucu hatası.' }, 500);
  }
  if (!product) return response(request, { error: 'Geçersiz veya pasif ürün.' }, 400);

  // Daha önce işlenmiş işlem: Apple'a gitmeden yanıtla (restore çağrıları için ucuz yol).
  const { data: existing, error: existingError } = await serviceClient
    .from('purchases')
    .select('user_id, granted_until')
    .eq('purchase_token', transactionId)
    .maybeSingle();
  if (existingError) {
    console.error('Satın alma sorgulanamadı:', existingError);
    return response(request, { error: 'Sunucu hatası.' }, 500);
  }
  if (existing) {
    if (existing.user_id !== user.id) return response(request, { error: 'Bu satın alma başka bir hesaba ait.' }, 403);
    return response(request, { ok: true, premium_until: existing.granted_until ?? null, already_applied: true });
  }

  let transaction: AppleTransaction;
  try {
    transaction = await fetchAppleTransaction(await createAppleJwt(), transactionId);
  } catch (error) {
    console.error('Apple doğrulama hatası:', transactionId, error);
    return response(request, { error: 'Satın alma Apple ile doğrulanamadı.' }, 502);
  }

  if (transaction.bundleId !== BUNDLE_ID) return response(request, { error: 'Satın alma bu uygulamaya ait değil.' }, 403);
  if (transaction.productId !== productId) return response(request, { error: 'Ürün eşleşmedi.' }, 400);
  if (transaction.type !== 'Non-Renewing Subscription') return response(request, { error: 'Geçersiz ürün tipi.' }, 400);
  if (transaction.revocationDate) return response(request, { error: 'Satın alma iade edilmiş.' }, 402);

  // Satın alma, istemcinin appAccountToken olarak gönderdiği Supabase user.id'ye bağlıdır.
  const token = String(transaction.appAccountToken ?? '').toLowerCase();
  if (!token || token !== user.id.toLowerCase()) {
    console.warn('Hesap eşleşmedi:', transactionId);
    return response(request, { error: 'Bu satın alma başka bir hesaba ait.' }, 403);
  }

  // Süresi zaten dolmuş eski bir işlem (ör. restore) yeniden süre kazandırmasın.
  const durationMs = Number(product.duration_days) * 86_400_000;
  if (!transaction.purchaseDate || transaction.purchaseDate + durationMs < Date.now()) {
    return response(request, { ok: true, expired: true, premium_until: null, already_applied: false });
  }

  const { data, error: rpcError } = await serviceClient.rpc('apply_verified_purchase', {
    p_user_id: user.id,
    p_product_id: productId,
    p_purchase_token: transactionId,
    p_order_id: transaction.originalTransactionId ?? null,
    p_raw_response: { platform: 'apple', ...transaction },
  });
  if (rpcError) {
    console.error('apply_verified_purchase hatası:', transactionId, rpcError);
    return response(request, { error: 'Premium erişimi işlenemedi.' }, 500);
  }

  const result = Array.isArray(data) ? data[0] : data;
  return response(request, {
    ok: true,
    premium_until: result?.granted_until ?? null,
    already_applied: result?.already_applied ?? false,
  });
});
