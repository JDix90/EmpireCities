/**
 * Whether this browser can draw WebGL, which a globe needs. Asked once a page:
 * GlobeMap's own fallback probes for every globe it mounts, but Split puts up
 * four at once (components/game/GalaxySplitView.tsx), so it asks here and draws
 * flat maps when the answer is no. Every probe holds a WebGL context until it
 * is collected, and a browser allows only a handful.
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
