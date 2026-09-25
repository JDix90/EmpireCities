package com.borderfall.app;

import android.annotation.SuppressLint;
import android.content.Context;
import android.os.Build;
import android.os.PowerManager;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Reports how hot the device is, for the game's frame budget
 * (docs/MOBILE_UX_PLAN.md M-13 phase 3; the web side is src/utils/deviceHeat.ts),
 * in the four levels iOS uses: nominal, fair, serious and critical. At serious
 * or critical the game drops to 20 fps with fewer effects until the phone has
 * cooled.
 *
 * Android's thermal status (API 29) maps onto those levels. The thermal
 * headroom forecast (API 30) raises the level to serious when it predicts
 * severe throttling within ten seconds, so the game sheds work before the phone
 * throttles rather than after. Below API 29 the plugin reports "unknown", which
 * the web side reads as nominal.
 *
 * Lives in the app rather than an npm package, so MainActivity registers it by
 * hand.
 */
@CapacitorPlugin(name = "Thermal")
public class ThermalPlugin extends Plugin {

    /** How far ahead the headroom forecast looks, in seconds. */
    static final int FORECAST_SECONDS = 10;

    /** The headroom at which Android's severe throttling begins. */
    static final float SEVERE_HEADROOM = 1.0f;

    private PowerManager powerManager;
    private PowerManager.OnThermalStatusChangedListener statusListener;

    @Override
    public void load() {
        powerManager = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
        if (powerManager != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            statusListener = status -> {
                JSObject data = new JSObject();
                data.put("state", currentState());
                notifyListeners("thermalStateChange", data);
            };
            powerManager.addThermalStatusListener(statusListener);
        }
    }

    @Override
    protected void handleOnDestroy() {
        if (powerManager != null && statusListener != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            powerManager.removeThermalStatusListener(statusListener);
        }
        statusListener = null;
    }

    @PluginMethod
    public void getThermalState(PluginCall call) {
        JSObject result = new JSObject();
        result.put("state", currentState());
        call.resolve(result);
    }

    private String currentState() {
        if (powerManager == null || Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            return "unknown";
        }
        String level = levelForStatus(powerManager.getCurrentThermalStatus());
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            level = withForecast(level, powerManager.getThermalHeadroom(FORECAST_SECONDS));
        }
        return level;
    }

    /**
     * Android's thermal status in the four levels the web side uses. The status
     * constants are inlined at compile time, and only API 29 and up has a status
     * to map, so older devices never reach this.
     */
    @SuppressLint("InlinedApi")
    static String levelForStatus(int status) {
        if (status >= PowerManager.THERMAL_STATUS_SEVERE) return "critical";
        if (status >= PowerManager.THERMAL_STATUS_MODERATE) return "serious";
        if (status >= PowerManager.THERMAL_STATUS_LIGHT) return "fair";
        return "nominal";
    }

    /**
     * Raises a cooler level to serious when the headroom forecast reaches severe
     * throttling. A NaN forecast, which Android returns when a device cannot
     * forecast or is asked more than about once a second, changes nothing.
     */
    static String withForecast(String level, float headroom) {
        if (!(headroom >= SEVERE_HEADROOM) || "critical".equals(level)) return level;
        return "serious";
    }
}
