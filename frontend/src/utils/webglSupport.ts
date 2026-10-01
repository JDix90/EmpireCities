/**
 * Whether this browser can draw WebGL, which the globe needs, and the 2D map
 * too (PixiJS has no other renderer). Asked once a page and shared: GlobeMap's
 * fallback, Split (components/game/GalaxySplitView.tsx) and the game page's
 * Moon inset all ask here. Every probe holds a WebGL context until it is
 * collected, and a browser allows only a handful.
 */

let probed: boolean | null = null;

export function webglAvailable(): boolean {
  if (probed !== null) return probed;
  try {
    const canvas = document.createElement('canvas');
    const gl = (canvas.getContext('webgl') ?? canvas.getContext('experimental-webgl')) as WebGLRenderingContext | null;
    probed = !!gl;
    // The probe's own context goes straight back.
    gl?.getExtension?.('WEBGL_lose_context')?.loseContext();
  } catch {
    probed = false;
  }
  return probed;
}
