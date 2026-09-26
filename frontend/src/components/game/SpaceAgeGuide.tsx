import Modal from '../ui/Modal';
import {
  buildSpaceAgeGuide,
  hasSpaceAgeGuide,
  spaceAgeGuideInput,
  type SpaceAgeGuideInput,
} from '../../utils/spaceAgeGuide';
import type { GameState } from '../../store/gameStore';

/**
 * "How the Space Age works", as sections written from this game's settings.
 * Rendered in two places: as the second page of the start briefing, and in
 * the modal below, which the Space Program tracker opens.
 */
export function SpaceAgeGuideSections({ input }: { input: SpaceAgeGuideInput }) {
  const sections = buildSpaceAgeGuide(input);
  return (
    <div className="space-y-4" data-testid="space-age-guide">
      {sections.map((section) => (
        <section key={section.id} data-testid={`space-age-guide-${section.id}`}>
          <h4 className="flex items-center gap-2 text-sm font-medium text-bf-text mb-1">
            <span className="w-4 text-center" aria-hidden>{section.icon}</span>
            {section.title}
          </h4>
          {section.paragraphs.map((text) => (
            <p key={text} className="text-sm text-bf-muted leading-relaxed mb-1.5 pl-6">{text}</p>
          ))}
          {section.items && (
            <ul className="space-y-1 pl-6">
              {section.items.map((text) => (
                <li key={text} className="text-sm text-bf-muted leading-relaxed flex gap-2">
                  <span className="text-violet-300/80 shrink-0" aria-hidden>•</span>
                  <span>{text}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}

/** The guide on its own, opened from the Space Program tracker. */
export default function SpaceAgeGuideModal({
  open,
  onClose,
  gameState,
  viewerPlayerId,
  moonTiles,
}: {
  open: boolean;
  onClose: () => void;
  gameState: GameState;
  viewerPlayerId: string | null;
  moonTiles: number;
}) {
  const input = spaceAgeGuideInput(gameState, viewerPlayerId, moonTiles);
  if (!hasSpaceAgeGuide(input)) return null;
  return (
    <Modal open={open} onClose={onClose} title="How the Space Age works">
      <SpaceAgeGuideSections input={input} />
      <button
        type="button"
        onClick={onClose}
        className="mt-4 w-full py-2.5 rounded-lg bg-bf-gold/20 border border-bf-gold/30 text-bf-gold text-sm font-medium hover:bg-bf-gold/30 transition-colors"
      >
        Got it
      </button>
    </Modal>
  );
}
