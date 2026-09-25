package com.borderfall.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // Capacitor finds plugins that come from npm packages on its own;
        // plugins that live in this app are registered here, before the
        // bridge starts.
        registerPlugin(ThermalPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
