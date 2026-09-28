import UIKit
import Capacitor

// The bridge view controller, so the app's own plugins can be registered
// (Main.storyboard points here).
class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(LanPlugin())
        bridge?.registerPluginInstance(StoreKitPlugin())
    }
}
