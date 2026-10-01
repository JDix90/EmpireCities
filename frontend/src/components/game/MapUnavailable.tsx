/**
 * Stands in for the map when the browser cannot draw it. The 2D map (PixiJS)
 * and the globe (three.js) both need WebGL; without it they used to fail the
 * whole game page into its error screen. In their place this says what is
 * missing and how to turn it on, and the rest of the page stays up.
 */
export default function MapUnavailable({ width, height }: { width?: number; height?: number }) {
  return (
    <div
      role="alert"
      className="flex h-full w-full items-center justify-center rounded-lg border border-bf-border bg-bf-dark p-6 text-center"
      style={{ width, height }}
      data-testid="map-unavailable"
    >
      <div className="max-w-sm space-y-2">
        <p className="font-display text-bf-gold">This browser can&apos;t draw the map</p>
        <p className="text-sm text-bf-muted">
          The map needs WebGL, which is turned off or not supported here. Turn on hardware acceleration in
          your browser&apos;s settings, restart the browser and reload this page, or try another browser.
        </p>
      </div>
    </div>
  );
}
