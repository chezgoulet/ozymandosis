import Foundation
import Capacitor
import StoreKit

// The App Store for Ozymandosis (docs/MONETIZATION.md): the mobile subscription as
// an in-app purchase ($2/month, $12/year; prices come from the App Store), and proof
// that this Apple account bought the game ($1). The app decides nothing: it hands the
// signed JWS that StoreKit 2 gives it to the play service, which verifies Apple's
// signature and binds it to the account (appAccountToken is issued by the service).
@objc(StoreKitPlugin)
public class StoreKitPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "StoreKitPlugin"
    public let jsName = "StoreKit"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "products", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "purchase", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "restore", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "appTransaction", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "manage", returnType: CAPPluginReturnPromise),
    ]
    private var updates: Task<Void, Never>?

    override public func load() {
        // renewals, purchases approved later (Ask to Buy), refunds: tell the game, which tells the service
        updates = Task.detached { [weak self] in
            for await result in Transaction.updates {
                if case .verified(let t) = result { await t.finish() }
                self?.notifyListeners("transaction", data: ["signedTransaction": result.jwsRepresentation])
            }
        }
    }
    deinit { updates?.cancel() }

    @objc func products(_ call: CAPPluginCall) {
        let ids = call.getArray("ids", String.self) ?? []
        Task {
            do {
                let list = try await Product.products(for: ids)
                call.resolve(["products": list.map { p -> [String: Any] in
                    var o: [String: Any] = ["id": p.id, "price": p.displayPrice, "amount": NSDecimalNumber(decimal: p.price).doubleValue]
                    if let s = p.subscription { o["period"] = "\(s.subscriptionPeriod.value) \(s.subscriptionPeriod.unit)" }
                    return o
                }])
            } catch { call.reject("The App Store did not answer: \(error.localizedDescription)", "unavailable") }
        }
    }

    @objc func purchase(_ call: CAPPluginCall) {
        guard let id = call.getString("productId"), let token = call.getString("appAccountToken"), let account = UUID(uuidString: token) else { call.reject("Sign in first.", "signin"); return }
        Task {
            do {
                guard let product = try await Product.products(for: [id]).first else { call.reject("That plan is not offered in this store.", "unavailable"); return }
                switch try await product.purchase(options: [.appAccountToken(account)]) {
                case .success(let result):
                    if case .verified(let t) = result { await t.finish() }
                    call.resolve(["signedTransaction": result.jwsRepresentation])
                case .userCancelled: call.resolve(["cancelled": true])
                case .pending: call.resolve(["pending": true])
                @unknown default: call.resolve(["cancelled": true])
                }
            } catch { call.reject("The purchase did not complete: \(error.localizedDescription)", "failed") }
        }
    }

    // What this Apple account is entitled to now (after a reinstall or on a new device).
    @objc func restore(_ call: CAPPluginCall) {
        Task {
            try? await AppStore.sync()
            var out: [String] = []
            for await result in Transaction.currentEntitlements { out.append(result.jwsRepresentation) }
            call.resolve(["transactions": out])
        }
    }

    // Proof that this copy of the game was bought by this Apple account.
    @objc func appTransaction(_ call: CAPPluginCall) {
        guard #available(iOS 16.0, *) else { call.reject("Online play needs iOS 16 or later.", "unavailable"); return }
        Task {
            do {
                let result = try await AppTransaction.shared
                call.resolve(["jws": result.jwsRepresentation])
            } catch { call.reject("The App Store could not confirm this copy: \(error.localizedDescription)", "failed") }
        }
    }

    // Cancel or change the plan: Apple's own sheet.
    @objc func manage(_ call: CAPPluginCall) {
        guard #available(iOS 15.0, *) else { call.resolve(); return }
        Task { @MainActor in
            if let scene = UIApplication.shared.connectedScenes.first as? UIWindowScene { try? await AppStore.showManageSubscriptions(in: scene) }
            call.resolve()
        }
    }
}
