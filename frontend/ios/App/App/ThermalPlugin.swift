import Foundation
import Capacitor

/// Reports how hot the device is, for the game's frame budget
/// (docs/MOBILE_UX_PLAN.md M-13 phase 3; the web side is
/// src/utils/deviceHeat.ts). iOS's own four thermal states are the levels the
/// web side uses, so they pass through unchanged: at serious or critical the
/// game drops to 20 fps with fewer effects until the phone has cooled.
///
/// Lives in the app rather than an npm package, so MainViewController
/// registers it by hand.
@objc(ThermalPlugin)
public class ThermalPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ThermalPlugin"
    public let jsName = "Thermal"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getThermalState", returnType: CAPPluginReturnPromise)
    ]
    private var observers: [NSObjectProtocol] = []

    override public func load() {
        observers.append(NotificationCenter.default.addObserver(forName: ProcessInfo.thermalStateDidChangeNotification, object: nil, queue: OperationQueue.main) { [weak self] (_) in
            self?.notifyListeners("thermalStateChange", data: [
                "state": ThermalPlugin.currentState()
            ])
        })
    }

    deinit {
        for observer in observers {
            NotificationCenter.default.removeObserver(observer)
        }
    }

    @objc func getThermalState(_ call: CAPPluginCall) {
        call.resolve([
            "state": ThermalPlugin.currentState()
        ])
    }

    static func currentState() -> String {
        switch ProcessInfo.processInfo.thermalState {
        case .nominal:
            return "nominal"
        case .fair:
            return "fair"
        case .serious:
            return "serious"
        case .critical:
            return "critical"
        @unknown default:
            return "unknown"
        }
    }
}
