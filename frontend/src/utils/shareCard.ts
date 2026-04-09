/**
 * Generates a 600×300 PNG share card for post-game results.
 */

export interface ShareCardOptions {
  eraName: string;
  factionColor: string;
  victoryCondition: string;
  territoryCount: number;
  turnCount: number;
  username: string;
  shareUrl: string;
  isWinner: boolean;
}

const VICTORY_LABELS: Record<string, string> = {
  domination: 'Domination Victory',
  last_standing: 'Last Standing',
  threshold: 'Threshold Victory',
  capital: 'Capital Capture',
  secret_mission: 'Secret Mission',
  alliance_victory: 'Alliance Victory',
};

export async function generateShareCard(opts: ShareCardOptions): Promise<Blob> {
  const W = 600;
  const H = 300;

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;

  // Background
  ctx.fillStyle = '#1a1a2e';
  ctx.fillRect(0, 0, W, H);

  // Subtle grid pattern
  ctx.strokeStyle = 'rgba(255,255,255,0.03)';
  ctx.lineWidth = 1;
  for (let x = 0; x < W; x += 30) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
  }
  for (let y = 0; y < H; y += 30) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }

  // Era-color accent stripe (top, 6px)
  ctx.fillStyle = opts.factionColor;
  ctx.fillRect(0, 0, W, 6);

  // Left faction color bar (full height, 6px)
  ctx.fillStyle = opts.factionColor;
  ctx.fillRect(0, 0, 6, H);

  // Faction color dot (large circle, left side)
  const dotX = 56;
  const dotY = H / 2;
  ctx.beginPath();
  ctx.arc(dotX, dotY, 32, 0, Math.PI * 2);
  ctx.fillStyle = opts.factionColor + '33';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(dotX, dotY, 32, 0, Math.PI * 2);
  ctx.strokeStyle = opts.factionColor;
  ctx.lineWidth = 3;
  ctx.stroke();

  // Outcome icon text in circle
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 28px sans-serif';
  ctx.fillStyle = opts.isWinner ? '#f1c40f' : '#e74c3c';
  ctx.fillText(opts.isWinner ? '🏆' : '💀', dotX, dotY);

  // Username
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.font = 'bold 26px sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(opts.username, 108, 100);

  // Outcome text
  const outcomeLabel = opts.isWinner ? 'Victory!' : 'Defeated';
  ctx.font = 'bold 32px sans-serif';
  ctx.fillStyle = opts.isWinner ? '#f1c40f' : '#e74c3c';
  ctx.fillText(outcomeLabel, 108, 148);

  // Victory condition label
  const condLabel = VICTORY_LABELS[opts.victoryCondition] ?? opts.victoryCondition;
  ctx.font = '16px sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.fillText(condLabel, 108, 180);

  // Stats row
  const statsY = 220;
  ctx.font = 'bold 20px sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fillText(`${opts.territoryCount} territories`, 108, statsY);
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.fillText('  ·  ', 108 + ctx.measureText(`${opts.territoryCount} territories`).width, statsY);
  const dotSep = ctx.measureText(`${opts.territoryCount} territories  ·  `).width;
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fillText(`${opts.turnCount} turns`, 108 + dotSep, statsY);

  // Era name
  ctx.font = '14px sans-serif';
  ctx.fillStyle = opts.factionColor;
  ctx.fillText(opts.eraName.toUpperCase(), 108, 258);

  // Footer — right-aligned domain
  ctx.textAlign = 'right';
  ctx.font = '13px sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  ctx.fillText('erasofempire.com', W - 20, H - 16);

  // Bottom accent line
  ctx.fillStyle = opts.factionColor + '66';
  ctx.fillRect(0, H - 3, W, 3);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Failed to generate share card'));
    }, 'image/png');
  });
}

export function buildShareText(opts: Pick<ShareCardOptions, 'username' | 'isWinner' | 'eraName' | 'victoryCondition' | 'turnCount' | 'shareUrl'>): string {
  const outcome = opts.isWinner ? 'won' : 'played';
  const cond = VICTORY_LABELS[opts.victoryCondition] ?? opts.victoryCondition;
  return `${opts.username} just ${outcome} an ${opts.eraName} game via ${cond} in ${opts.turnCount} turns on Eras of Empire! ${opts.shareUrl}`;
}
