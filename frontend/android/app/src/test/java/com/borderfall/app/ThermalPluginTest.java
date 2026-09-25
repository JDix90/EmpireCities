package com.borderfall.app;

import static org.junit.Assert.assertEquals;

import android.os.PowerManager;
import org.junit.Test;

public class ThermalPluginTest {

    @Test
    public void mapsThermalStatusOntoTheFourLevels() {
        assertEquals("nominal", ThermalPlugin.levelForStatus(PowerManager.THERMAL_STATUS_NONE));
        assertEquals("fair", ThermalPlugin.levelForStatus(PowerManager.THERMAL_STATUS_LIGHT));
        assertEquals("serious", ThermalPlugin.levelForStatus(PowerManager.THERMAL_STATUS_MODERATE));
        assertEquals("critical", ThermalPlugin.levelForStatus(PowerManager.THERMAL_STATUS_SEVERE));
        assertEquals("critical", ThermalPlugin.levelForStatus(PowerManager.THERMAL_STATUS_CRITICAL));
        assertEquals("critical", ThermalPlugin.levelForStatus(PowerManager.THERMAL_STATUS_EMERGENCY));
        assertEquals("critical", ThermalPlugin.levelForStatus(PowerManager.THERMAL_STATUS_SHUTDOWN));
    }

    @Test
    public void aSevereForecastRaisesACoolerLevelToSerious() {
        assertEquals("serious", ThermalPlugin.withForecast("nominal", 1.0f));
        assertEquals("serious", ThermalPlugin.withForecast("fair", 1.2f));
        assertEquals("serious", ThermalPlugin.withForecast("serious", 1.0f));
        assertEquals("critical", ThermalPlugin.withForecast("critical", 1.5f));
    }

    @Test
    public void aForecastShortOfSevereOrMissingChangesNothing() {
        assertEquals("nominal", ThermalPlugin.withForecast("nominal", 0.99f));
        assertEquals("fair", ThermalPlugin.withForecast("fair", 0.5f));
        assertEquals("nominal", ThermalPlugin.withForecast("nominal", Float.NaN));
        assertEquals("serious", ThermalPlugin.withForecast("serious", Float.NaN));
    }
}
