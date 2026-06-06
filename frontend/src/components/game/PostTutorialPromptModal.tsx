import { Bot, X } from 'lucide-react';

interface PostTutorialPromptModalProps {
  loading?: boolean;
  onStartSolo: () => void;
  onBackToLobby: () => void;
}

/**
 * Shown right after a player finishes the tutorial. Rather than dropping back
 * to the lobby, actively route them into their first real match — the highest-
 * leverage activation step for a new player.
 */
export default function PostTutorialPromptModal({
  loading,
  onStartSolo,
  onBackToLobby,
}: PostTutorialPromptModalProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm px-4 pt-safe pb-safe"
      onClick={onBackToLobby}
    >
      <div
        className="relative bg-bf-surface border border-bf-gold/25 rounded-2xl p-6 sm:p-8 w-full max-w-md shadow-2xl shadow-black/60"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onBackToLobby}
          className="absolute top-3 right-3 min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg text-bf-muted hover:text-bf-gold hover:bg-white/5 transition-colors"
          aria-label="Close"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="text-center mb-6">
          <div className="w-14 h-14 rounded-full bg-bf-gold/10 border border-bf-gold/30 flex items-center justify-center mx-auto mb-4">
            <Bot className="w-6 h-6 text-bf-gold" aria-hidden />
          </div>
          <h2 className="font-display text-2xl text-bf-gold mb-2">Nice work, Commander</h2>
          <p className="text-bf-muted text-sm leading-relaxed">
            You&apos;ve got the basics. Ready for a real match? Three AI opponents are standing by — start
            now, no waiting.
          </p>
        </div>

        <button
          type="button"
          onClick={onStartSolo}
          disabled={loading}
          className="w-full btn-primary flex items-center justify-center gap-2 mb-3 disabled:opacity-60 disabled:cursor-not-allowed"
        >
          <Bot className="w-4 h-4" aria-hidden />
          {loading ? 'Starting…' : 'Start Solo Game'}
        </button>

        <button
          type="button"
          onClick={onBackToLobby}
          className="w-full text-center text-sm text-bf-muted hover:text-bf-gold transition-colors"
        >
          Back to lobby
        </button>
      </div>
    </div>
  );
}
