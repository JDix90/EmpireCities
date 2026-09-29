import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Game events the server sends to a player's user room (`user:<id>`) rather
 * than to the game's room: a player's own `game:state` (broadcastState), their
 * copy of a map visual under fog (emitMapVisual), and whatever emitToPlayer
 * sends. Every socket the player has open receives them, whichever game it is
 * showing, so a page must drop another game's before acting on one.
 */
const USER_ROOM_GAME_EVENTS = new Set([
  'game:state',
  'game:map_visual',
  'game:truce_proposal',
  'game:truce_broken',
  'game:coaching_tip',
  'game:campaign_advanced',
  'game:drop_assault_cancelled',
]);

/** The guard as a handler's first statement, after any comments. */
const CHECKS_GAME_FIRST = /^\{\s*(?:\/\/[^\n]*\n\s*|\/\*[\s\S]*?\*\/\s*)*if \(isForAnotherGame\(/;

/** The `{ … }` body of the first arrow function at or after `from`. */
function arrowBody(source: string, from: number): string {
  const open = source.indexOf('{', source.indexOf('=>', from));
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}' && (depth -= 1) === 0) return source.slice(open, i + 1);
  }
  throw new Error('unbalanced handler body');
}

/** Each user-room game event the page listens for, with its handler's body. */
function userRoomListeners(page: string): Array<{ event: string; body: string }> {
  const source = readFileSync(resolve(process.cwd(), 'src/pages', page), 'utf8');
  const listeners: Array<{ event: string; body: string }> = [];
  for (const m of source.matchAll(/socket\.on\('([\w:]+)',\s*(?:(\w+)\)|\()/g)) {
    const [, event, handlerName] = m;
    if (!USER_ROOM_GAME_EVENTS.has(event)) continue;
    // A named handler (`socket.on('game:state', onGameState)`) is defined elsewhere.
    const from = handlerName ? source.indexOf(`const ${handlerName} = `) : m.index!;
    expect(from, `${page}: definition of ${handlerName}`).toBeGreaterThanOrEqual(0);
    listeners.push({ event, body: arrowBody(source, from) });
  }
  return listeners;
}

describe('pages drop game events meant for another game', () => {
  it.each([
    ['GamePage.tsx', ['game:state', 'game:map_visual', 'game:truce_proposal', 'game:truce_broken', 'game:coaching_tip', 'game:campaign_advanced']],
    ['SpectatorPage.tsx', ['game:state', 'game:map_visual']],
  ])('%s checks the game before handling any user-room event', (page, expected) => {
    const listeners = userRoomListeners(page);
    // The scan found the listeners it is meant to check.
    expect(listeners.map((l) => l.event)).toEqual(expect.arrayContaining(expected));
    const unchecked = listeners.filter((l) => !CHECKS_GAME_FIRST.test(l.body)).map((l) => l.event);
    expect(unchecked).toEqual([]);
  });
});
