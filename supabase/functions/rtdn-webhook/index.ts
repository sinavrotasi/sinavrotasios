import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ---------------------------------------------------------------------------
// rtdn-webhook
//
// Google Play Real-time Developer Notifications (RTDN) için Pub/Sub push
// endpoint'i. Yalnızca voidedPurchaseNotification (tek seferlik ürün iadesi /
// geri alma) işlenir ve public.apply_purchase_void() RPC'si çağrılır.
//
// Kimlik doğrulama: Pub/Sub push isteği Supabase JWT'si taşımaz, özel header
// da eklenemez. Bu yüzden fonksiyon verify_jwt=false ile deploy edilir ve
// push subscription URL'ine eklenen paylaşılan gizli anahtar (?secret=...)
// SABİT ZAMANLI karşılaştırma ile doğrulanır.
//
// 2026-09-15 revizyonu (D-02) ve log iyileştirmesi:
//   * Her bildirim tipi (test, tek seferlik ürün, abonelik, iade) ve boş
//     push'lar tek satırlık bir logla kaydedilir; kişisel veri ve tam token
//     loglanmaz.
//   * Gizli anahtar karşılaştırması sabit zamanlı.
//   * packageName doğrulanıyor.
//   * purchase_token loglarda maskeleniyor; kullanıcı kimliği loglanmıyor.
//   * Kaynak kod depoya alındı (O-03).
// Operasyon notu: URL query string'i platform loglarında görünebilir; gizli
// anahtar daha önce bir log ya da ekran görüntüsüne düştüyse RTDN_WEBHOOK_SECRET
// değerini değiştirip Pub/Sub push URL'ini güncelleyin. Daha güçlü seçenek:
// push subscription'da OIDC kimlik doğrulamasını açıp Google imzalı JWT'yi
// doğrulamak.
// ---------------------------------------------------------------------------

const ANDROID_PACKAGE_NAME = 'com.sinavrotasi.mebgys';
const PRODUCT_TYPE_SUBSCRIPTION = 1;
const PRODUCT_TYPE_ONE_TIME = 2;

interface VoidedPurchaseNotification {
  purchaseToken: string;
  orderId?: string;
  // Google RTDN referansı: 1 = PRODUCT_TYPE_SUBSCRIPTION, 2 = PRODUCT_TYPE_ONE_TIME.
  // (2026-09-15 düzeltmesi: önceki sürümler bu değerleri ters yorumlayıp
  // tek seferlik ürün iadelerini "abonelik" sanarak atlıyordu.)
  productType: number;
  refundType?: number; // 1 = tam iade, 2 = kısmi iade
}

interface DeveloperNotification {
  version?: string;
  packageName?: string;
  eventTimeMillis?: string;
  voidedPurchaseNotification?: VoidedPurchaseNotification;
  oneTimeProductNotification?: { notificationType?: number; sku?: string };
  subscriptionNotification?: { notificationType?: number };
  testNotification?: { version?: string };
}

// Hangi bildirim tipinin geldiğini loglarda görebilmek için kısa etiket.
function notificationKind(n: DeveloperNotification): string {
  if (n.voidedPurchaseNotification) return 'voided';
  if (n.testNotification) return 'test';
  if (n.oneTimeProductNotification) return `one_time(type=${n.oneTimeProductNotification.notificationType ?? '-'})`;
  if (n.subscriptionNotification) return `subscription(type=${n.subscriptionNotification.notificationType ?? '-'})`;
  return 'bilinmeyen';
}

function eventTime(n: DeveloperNotification): string {
  const ms = Number(n.eventTimeMillis);
  return Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : '-';
}

function base64Decode(value: string): string {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  // Uzunluk bilgisini de sızdırmamak için önce iki değerin özetini alıp
  // sabit uzunluklu diziler üzerinde karşılaştırıyoruz.
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(a)),
    crypto.subtle.digest('SHA-256', enc.encode(b)),
  ]);
  const va = new Uint8Array(ha);
  const vb = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < va.length; i++) diff |= va[i] ^ vb[i];
  return diff === 0;
}

function maskToken(token: string | undefined): string {
  if (!token) return '-';
  return token.length <= 12 ? '***' : `${token.slice(0, 6)}…${token.slice(-4)}`;
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') {
    return new Response('Yalnızca POST desteklenir.', { status: 405 });
  }

  const expectedSecret = Deno.env.get('RTDN_WEBHOOK_SECRET');
  if (!expectedSecret) {
    console.error('rtdn-webhook: RTDN_WEBHOOK_SECRET tanımlı değil.');
    return new Response('Sunucu yapılandırması eksik.', { status: 500 });
  }
  const providedSecret = new URL(request.url).searchParams.get('secret') ?? '';
  if (!(await timingSafeEqual(providedSecret, expectedSecret))) {
    console.warn('rtdn-webhook: yetkisiz istek.');
    return new Response('Yetkisiz.', { status: 401 });
  }

  let body: { message?: { data?: string } };
  try {
    body = await request.json();
  } catch {
    return new Response('Geçersiz JSON.', { status: 400 });
  }

  const rawData = body.message?.data;
  if (!rawData) {
    // Test push'ları boş gelebilir; 200 dönüp Pub/Sub'ın yeniden denemesini engelle.
    console.log('rtdn-webhook: veri içermeyen push alındı, atlandı.');
    return new Response('ok (veri yok)', { status: 200 });
  }

  let notification: DeveloperNotification;
  try {
    notification = JSON.parse(base64Decode(rawData));
  } catch (error) {
    console.error('rtdn-webhook: çözümleme hatası:', error);
    return new Response('ok (parse hatası, loglandı)', { status: 200 });
  }

  const kind = notificationKind(notification);
  console.log('rtdn-webhook: bildirim alındı:', kind, 'olay_zamanı=', eventTime(notification));

  if (notification.packageName && notification.packageName !== ANDROID_PACKAGE_NAME) {
    console.warn('rtdn-webhook: beklenmeyen paket adı, atlandı.');
    return new Response('ok (farklı paket)', { status: 200 });
  }

  const voided = notification.voidedPurchaseNotification;
  if (!voided) {
    console.log('rtdn-webhook: iade içermeyen bildirim, işlem yapılmadı:', kind);
    return new Response('ok (ilgisiz bildirim)', { status: 200 });
  }
  if (voided.productType !== PRODUCT_TYPE_ONE_TIME) {
    const label = voided.productType === PRODUCT_TYPE_SUBSCRIPTION ? 'abonelik iadesi' : 'bilinmeyen ürün tipi';
    console.log(`rtdn-webhook: ${label}, atlandı (productType=`, voided.productType, ')');
    return new Response('ok (tek seferlik ürün değil, atlandı)', { status: 200 });
  }
  if (typeof voided.purchaseToken !== 'string' || voided.purchaseToken.length < 10) {
    console.warn('rtdn-webhook: geçersiz purchaseToken.');
    return new Response('ok (geçersiz token)', { status: 200 });
  }

  const url = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceRoleKey) {
    console.error('rtdn-webhook: sunucu yapılandırması eksik.');
    return new Response('Sunucu yapılandırması eksik.', { status: 500 });
  }

  const serviceClient = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Google, iade ile idari geri almayı aynı bildirim tipinde gönderir ve
  // ayırt edici bir alan sunmaz. Bu yüzden durum her zaman 'refunded' yazılır;
  // purchases.status CHECK kısıtındaki 'revoked' değeri admin işlemleri için
  // ayrılmıştır.
  const { data, error } = await serviceClient.rpc('apply_purchase_void', {
    p_purchase_token: voided.purchaseToken,
    p_new_status: 'refunded',
  });

  if (error) {
    console.error('rtdn-webhook: apply_purchase_void hatası:', maskToken(voided.purchaseToken), error.message);
    // 500 → Pub/Sub yeniden dener (geçici DB hatalarında istenen davranış).
    return new Response('İşlenemedi.', { status: 500 });
  }

  const result = Array.isArray(data) ? data[0] : data;
  if (!result?.found) {
    console.log('rtdn-webhook: token bulunamadı, atlandı:', maskToken(voided.purchaseToken));
  } else {
    console.log('rtdn-webhook: iade işlendi:', maskToken(voided.purchaseToken), 'refundType=', voided.refundType ?? '-');
  }

  return new Response('ok', { status: 200 });
});