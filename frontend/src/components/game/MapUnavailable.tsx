import { isNativeApp } from '../../utils/nativeApp';

/**
 * Stands in for the map when the browser cannot draw it. The 2D map (PixiJS)
 * and the globe (three.js) both need WebGL; without it they used to fail the
 * whole game page into its error screen. In their place this says what is
 * missing and how to turn it on, and the rest of the page stays up.
 *
 * In the native app there is no browser to blame or to swap, so it says
 * "this device" and suggests what a player can do there.
 */
export default function MapUnavailable({ width, height }: { width?: number; height?: number }) {
  const native = isNativeApp();
  return (
    <div
      role="alert"
      className="flex h-full w-full items-center justify-center rounded-lg border border-bf-border bg-bf-dark p-6 text-center"
      style={{ width, height }}
      data-testid="map-unavailable"
    >
      <div className="max-w-sm space-y-2">
        <p className="font-display text-bf-gold">
          {native ? "This device can't draw the map" : "This browser can't draw the map"}
        </p>
        <p className="text-sm text-bf-muted">
          {native
            ? "The map needs graphics support that this device isn't providing right now. Close Borderfall completely and open it again; if that doesn't help, restart the device or update its software."
            : "The map needs WebGL, which is turned off or not supported here. Turn on hardware acceleration in your browser's settings, restart the browser and reload this page, or try another browser."}
        </p>
      </div>
    </div>
  );
}
