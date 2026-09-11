import BrandWordmark from '../ui/BrandWordmark';

interface GameEndedNoticeProps {
  /** 'abandoned' has no result to show; 'completed' has a replay worth watching. */
  abandoned: boolean;
  onWatchReplay: () => void;
  onBackToLobby: () => void;
}

/**
 * What `/game/:id` shows once the match is over.
 *
 * That route keeps resolving for a finished game — the game-over modal's own
 * CTAs leave through it, and browser Back lands on it — but there is no board
 * to render and no lobby to wait in. It used to fall through to the Pre-Game
 * Room, whose every navigation control sits inside `{lobby && …}` and so never
 * rendered without a lobby snapshot: the player was left on "Loading lobby…"
 * with no way out but the browser's address bar.
 */
export default function GameEndedNotice({ abandoned, onWatchReplay, onBackToLobby }: GameEndedNoticeProps) {
  return (
    <div className="min-h-screen bg-bf-dark flex flex-col pt-safe pb-safe">
      <nav className="border-b border-bf-border px-6 py-3 flex justify-between items-center">
        <BrandWordmark to="/lobby" className="text-sm" />
      </nav>
      <div className="flex-1 flex items-center justify-center px-4">
        <div className="max-w-sm w-full text-center space-y-4">
          <h2 className="font-display text-xl text-bf-gold">
            {abandoned ? 'This match was abandoned' : 'This match has ended'}
          </h2>
          <p className="text-bf-muted text-sm">
            {abandoned
              ? 'Nobody finished it, so there is no result to show.'
              : 'The board is gone, but the replay keeps every turn of it.'}
          </p>
          {/* An abandoned match has no result worth reviewing, so leading with
              "Watch replay" there would contradict the line above it. */}
          <div className="flex flex-col gap-3 mt-6">
            <button
              className={`${abandoned ? 'btn-secondary' : 'btn-primary'} w-full`}
              onClick={onWatchReplay}
            >
              Watch replay
            </button>
            <button
              className={`${abandoned ? 'btn-primary' : 'btn-secondary'} w-full`}
              onClick={onBackToLobby}
            >
              Back to lobby
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
