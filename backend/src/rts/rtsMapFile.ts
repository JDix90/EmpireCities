import * as fs from 'fs';
import * as path from 'path';
import { isSafeMapId } from '../utils/mapId.js';

export function readMapFileJson(mapId: string): unknown {
  if (!isSafeMapId(mapId)) {
    throw new Error('Invalid map id');
  }
  const candidates = [
    path.join(process.cwd(), 'database', 'maps', `${mapId}.json`),
    path.join(process.cwd(), '..', 'database', 'maps', `${mapId}.json`),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      return JSON.parse(fs.readFileSync(p, 'utf-8'));
    }
  }
  const here = __dirname;
  const legacy = path.join(here, '../../../database/maps', `${mapId}.json`);
  if (fs.existsSync(legacy)) {
    return JSON.parse(fs.readFileSync(legacy, 'utf-8'));
  }
  throw new Error(`Map JSON not found for ${mapId}`);
}
