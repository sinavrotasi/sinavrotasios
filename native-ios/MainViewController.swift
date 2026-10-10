import UIKit
import Capacitor

class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        super.capacitorDidLoad()
        guard let bridge = bridge else {
            NSLog("[AppleBilling] MainViewController bridge unavailable")
            return
        }
        // Capacitor's packageClassList registers the plugin before this hook.
        // Keep manual registration as a fallback, without creating two listeners.
        if bridge.plugin(withName: "AppleBilling") == nil {
            bridge.registerPluginInstance(AppleBillingPlugin())
        }
        NSLog("[AppleBilling] registered=%@ build=%@",
              bridge.plugin(withName: "AppleBilling") == nil ? "false" : "true",
              Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "unknown")
    }
}
