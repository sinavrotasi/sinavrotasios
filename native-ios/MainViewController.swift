import UIKit
import Capacitor

// Android'deki MainActivity.registerPlugin(PlayBillingPlugin.class) satırının iOS karşılığı.
// Main.storyboard'daki view controller'ın Custom Class değeri bu sınıf olmalıdır.
class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(AppleBillingPlugin())
    }
}
