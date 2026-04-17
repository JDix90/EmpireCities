const SAFE_MAP_ID = /^[a-zA-Z0-9_-]+$/;

export function isSafeMapId(mapId: string): boolean {
  return SAFE_MAP_ID.test(mapId) && mapId.length <= 128;
}
