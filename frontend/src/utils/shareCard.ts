/**
 * Generates a stylized PNG share card for post-game results.
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
  achievements?: string[];
  friendStreakBonus?: number;
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
  const W = 800;
  const H = 420;

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;

  const gradient = ctx.createLinearGradient(0, 0, W, H);
  gradient.addColorStop(0, '#101724');
  gradient.addColorStop(0.55, '#1b2335');
  gradient.addColorStop(1, '#0a0f18');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = `${opts.factionColor}18`;
  ctx.beginPath();
  ctx.arc(W - 120, 90, 160, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(140, H - 40, 120, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = opts.factionColor;
  ctx.fillRect(0, 0, W, 8);
  ctx.fillRect(0, 0, 8, H);

  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.lineWidth = 1;
  for (let x = 0; x < W; x += 40) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
  }
  for (let y = 0; y < H; y += 40) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }

  const dotX = 92;
  const dotY = 120;
  ctx.beginPath();
  ctx.arc(dotX, dotY, 48, 0, Math.PI * 2);
  ctx.fillStyle = opts.factionColor + '33';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(dotX, dotY, 48, 0, Math.PI * 2);
  ctx.strokeStyle = opts.factionColor;
  ctx.lineWidth = 4;
  ctx.stroke();

  // Outcome icon text in circle
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 42px serif';
  ctx.fillStyle = opts.isWinner ? '#f1c40f' : '#e74c3c';
  ctx.fillText(opts.isWinner ? '🏆' : '💀', dotX, dotY);

  // Username
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.font = '600 18px Georgia, serif';
  ctx.fillStyle = 'rgba(255,255,255,0.58)';
  ctx.fillText('Eras of Empire', 168, 72);

  ctx.font = 'bold 34px Georgia, serif';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(opts.username, 168, 118);

  // Outcome text
  const outcomeLabel = opts.isWinner ? 'Victory!' : 'Defeated';
  ctx.font = 'bold 46px Georgia, serif';
  ctx.fillStyle = opts.isWinner ? '#f1c40f' : '#e74c3c';
  ctx.fillText(outcomeLabel, 168, 174);

  // Victory condition label
  const condLabel = VICTORY_LABELS[opts.victoryCondition] ?? opts.victoryCondition;
  ctx.font = '16px system-ui, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.fillText(condLabel, 168, 206);

  const statCards = [
    { label: 'Territories', value: String(opts.territoryCount) },
    { label: 'Turns', value: String(opts.turnCount) },
    { label: 'Era', value: opts.eraName },
  ];
  if (opts.friendStreakBonus && opts.friendStreakBonus > 0) {
    statCards.push({ label: 'Friend Bonus', value: `+${opts.friendStreakBonus}%` });
  }

  statCards.forEach((card, index) => {
    const x = 48 + index * 180;
    const y = 262;
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    ctx.fillRect(x, y, 156, 74);
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.strokeRect(x, y, 156, 74);
    ctx.font = '12px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.52)';
    ctx.fillText(card.label.toUpperCase(), x + 14, y + 22);
    ctx.font = 'bold 24px Georgia, serif';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(card.value, x + 14, y + 52);
  });

  const badgeY = 354;
  const badges = (opts.achievements ?? []).slice(0, 2);
  badges.forEach((badge, index) => {
    const x = 48 + index * 230;
    ctx.fillStyle = 'rgba(241, 196, 15, 0.1)';
    ctx.fillRect(x, badgeY, 210, 30);
    ctx.strokeStyle = 'rgba(241, 196, 15, 0.18)';
    ctx.strokeRect(x, badgeY, 210, 30);
    ctx.font = '12px system-ui, sans-serif';
    ctx.fillStyle = '#f4d35e';
    ctx.fillText(badge.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()), x + 12, badgeY + 20);
  });

  ctx.font = '14px system-ui, sans-serif';
  ctx.fillStyle = opts.factionColor;
  ctx.fillText(opts.eraName.toUpperCase(), 610, 306);

  ctx.textAlign = 'right';
  ctx.font = '13px system-ui, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.fillText(opts.shareUrl.replace(/^https?:\/\//, ''), W - 28, H - 28);

  ctx.fillStyle = opts.factionColor + '66';
  ctx.fillRect(0, H - 4, W, 4);

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
