// GENERATED FILE — do not edit. Source of truth: docker/portals.json.
// Regenerate: pnpm -C backend exec tsx scripts/syncPortals.ts
// A backend test (portalRegistry.test.ts) fails when this file is stale.

/** A game portal that may embed us, and what it lets us show inside its frame. */
export interface Portal {
  readonly id: string;
  readonly name: string;
  /** Absolute origins; a leading `*.` matches subdomains only. Same syntax as EMBED_ORIGINS. */
  readonly origins: readonly string[];
  /** False when the portal forbids a game showing its own login/registration UI. */
  readonly ownAuthUi: boolean;
}

export const PORTALS: readonly Portal[] = [
  {
    id: 'itch',
    name: 'itch.io',
    origins: [
      'https://itch.io',
      'https://*.itch.io',
      'https://*.itch.zone',
    ],
    ownAuthUi: true,
  },
  {
    id: 'crazygames',
    name: 'CrazyGames',
    origins: [
      'https://crazygames.com',
      'https://*.crazygames.com',
      'capacitor://app.crazygames.com',
      'https://www.crazygames.at',
      'https://www.crazygames.co.id',
      'https://www.crazygames.co.kr',
      'https://www.crazygames.com.br',
      'https://www.crazygames.com.ua',
      'https://www.crazygames.com.vn',
      'https://www.crazygames.cz',
      'https://www.crazygames.dk',
      'https://www.crazygames.fi',
      'https://www.crazygames.fr',
      'https://www.crazygames.hu',
      'https://www.crazygames.jp',
      'https://www.crazygames.nl',
      'https://www.crazygames.no',
      'https://www.crazygames.pl',
      'https://www.crazygames.pt',
      'https://www.crazygames.ro',
      'https://www.crazygames.ru',
      'https://www.crazygames.se',
      'https://www.crazygames.vn',
    ],
    ownAuthUi: false,
  },
  {
    id: 'newgrounds',
    name: 'Newgrounds',
    origins: [
      'https://www.newgrounds.com',
      'https://uploads.ungrounded.net',
    ],
    ownAuthUi: true,
  },
];
