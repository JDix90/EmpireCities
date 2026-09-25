import UIKit
import Capacitor

/// The app's bridge view controller (Base.lproj/Main.storyboard). Capacitor
/// finds plugins that come from npm packages on its own; plugins that live in
/// this app are registered here, before the web view loads.
class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(ThermalPlugin())
    }
}
