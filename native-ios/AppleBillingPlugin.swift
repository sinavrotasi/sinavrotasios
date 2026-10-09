import Foundation
import Capacitor
import StoreKit

/**
 * StoreKit 2 üzerinden "Non-Renewing Subscription" satın alma akışını www/
 * tarafına açan Capacitor eklentisi. PlayBillingPlugin.java'nın iOS karşılığıdır.
 *
 * Akış: purchase({ productId, accountId }) -> Apple ödeme ekranı ->
 * { productId, transactionId, purchaseState } döner -> www bunu
 * verify-apple-purchase Edge Function'a gönderir -> sunucu premium'u verince
 * www finishTransaction({ transactionId }) çağırır.
 *
 * ÖNEMLİ: Bu eklenti is_premium'u HİÇBİR ŞEKİLDE doğrudan set etmez.
 * accountId, Supabase user.id (UUID) olmalıdır; appAccountToken olarak satın
 * almaya bağlanır ve sunucu bunu doğrular.
 */
@objc(AppleBillingPlugin)
public class AppleBillingPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AppleBillingPlugin"
    public let jsName = "AppleBilling"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "purchase", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "restorePurchases", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getProductDetails", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "finishTransaction", returnType: CAPPluginReturnPromise)
    ]

    private var updatesTask: Task<Void, Never>?
    private var purchaseInProgress = false

    public override func load() {
        // Uygulama dışında tamamlanan işlemler (ör. "Ask to Buy" onayı, yarım kalan
        // ödeme) burada yakalanır ve "purchaseUpdated" olayıyla JS'e iletilir.
        updatesTask = Task.detached { [weak self] in
            for await result in Transaction.updates {
                guard let self = self else { return }
                if case .verified(let transaction) = result, transaction.productType == .nonRenewable {
                    self.notifyListeners("purchaseUpdated", data: self.toJs(transaction), retainUntilConsumed: true)
                }
            }
        }
    }

    deinit {
        updatesTask?.cancel()
    }

    private func toJs(_ transaction: Transaction, state: String = "PURCHASED") -> [String: Any] {
        return [
            "productId": transaction.productID,
            "transactionId": String(transaction.id),
            "originalTransactionId": String(transaction.originalID),
            "purchaseDate": Int(transaction.purchaseDate.timeIntervalSince1970 * 1000),
            "purchaseState": state
        ]
    }

    /**
     * JS: Capacitor.Plugins.AppleBilling.purchase({ productId: 'premium_1ay', accountId: '<user.id UUID>' })
     */
    @objc func purchase(_ call: CAPPluginCall) {
        guard let productId = call.getString("productId"), !productId.isEmpty else {
            call.reject("productId gereklidir.")
            return
        }
        var options: Set<Product.PurchaseOption> = []
        if let accountId = call.getString("accountId") {
            guard let uuid = UUID(uuidString: accountId) else {
                call.reject("accountId geçersiz (UUID olmalı).")
                return
            }
            options.insert(.appAccountToken(uuid))
        }

        Task { @MainActor in
            if self.purchaseInProgress {
                call.reject("Devam eden bir satın alma işlemi var.", "PURCHASE_IN_PROGRESS")
                return
            }
            self.purchaseInProgress = true
            defer { self.purchaseInProgress = false }

            do {
                let products = try await Product.products(for: [productId])
                guard let product = products.first, product.type == .nonRenewable else {
                    call.reject("Ürün App Store Connect'te bulunamadı veya tipi hatalı: \(productId)")
                    return
                }

                let result = try await product.purchase(options: options)
                switch result {
                case .success(let verification):
                    switch verification {
                    case .verified(let transaction):
                        // finish() burada ÇAĞRILMAZ; sunucu premium'u verdikten sonra
                        // JS finishTransaction ile tamamlar.
                        call.resolve(self.toJs(transaction))
                    case .unverified:
                        call.reject("Satın alma Apple tarafından doğrulanamadı.")
                    }
                case .pending:
                    // Ask to Buy / onay bekleyen ödeme. Onaylanınca purchaseUpdated gelir.
                    call.resolve(["productId": productId, "purchaseState": "PENDING"])
                case .userCancelled:
                    call.reject("Kullanıcı satın almayı iptal etti.", "USER_CANCELED")
                @unknown default:
                    call.reject("Satın alma tamamlanamadı.")
                }
            } catch {
                call.reject("Satın alma başlatılamadı: \(error.localizedDescription)")
            }
        }
    }

    /**
     * Son ~120 günün geçerli (iade edilmemiş) non-renewing işlemlerini döner.
     * { sync: true } verilirse önce AppStore.sync() çağrılır (Apple ID giriş istemi
     * çıkarabilir; yalnızca kullanıcı "Satın Alımları Geri Yükle"ye bastığında kullanın).
     * Sunucu aynı transactionId'yi iki kez işlemez, bu yüzden açılışta çağırmak güvenlidir.
     */
    @objc func restorePurchases(_ call: CAPPluginCall) {
        let shouldSync = call.getBool("sync") ?? false
        Task {
            if shouldSync {
                do { try await AppStore.sync() } catch {
                    call.reject("App Store ile eşitlenemedi: \(error.localizedDescription)")
                    return
                }
            }
            let cutoff = Date().addingTimeInterval(-120 * 86_400)
            var list: [[String: Any]] = []
            for await result in Transaction.all {
                if case .verified(let transaction) = result,
                   transaction.productType == .nonRenewable,
                   transaction.revocationDate == nil,
                   transaction.purchaseDate > cutoff {
                    list.append(self.toJs(transaction))
                }
            }
            call.resolve(["purchases": list])
        }
    }

    /**
     * JS: Capacitor.Plugins.AppleBilling.getProductDetails({ productIds: [...] })
     */
    @objc func getProductDetails(_ call: CAPPluginCall) {
        guard let productIds = call.getArray("productIds", String.self), !productIds.isEmpty else {
            call.reject("productIds gereklidir.")
            return
        }
        Task {
            do {
                let products = try await Product.products(for: productIds)
                let list: [[String: Any]] = products.map { product in
                    [
                        "productId": product.id,
                        "title": product.displayName,
                        "formattedPrice": product.displayPrice
                    ]
                }
                call.resolve(["products": list])
            } catch {
                call.reject("Ürün bilgileri alınamadı: \(error.localizedDescription)")
            }
        }
    }

    /**
     * Sunucu premium'u verdikten sonra JS tarafından çağrılır.
     * JS: Capacitor.Plugins.AppleBilling.finishTransaction({ transactionId: '...' })
     */
    @objc func finishTransaction(_ call: CAPPluginCall) {
        guard let transactionId = call.getString("transactionId"), !transactionId.isEmpty else {
            call.reject("transactionId gereklidir.")
            return
        }
        Task {
            for await result in Transaction.all {
                if case .verified(let transaction) = result, String(transaction.id) == transactionId {
                    await transaction.finish()
                    call.resolve()
                    return
                }
            }
            call.reject("İşlem bulunamadı: \(transactionId)")
        }
    }
}
