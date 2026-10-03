import { Link } from 'react-router-dom';
import { Compass } from 'lucide-react';
import clsx from 'clsx';
import { GALAXY_TUTORIAL_MODULE_IDS, TUTORIAL_MODULES, TUTORIAL_V2_ENABLED } from '../../tutorial';
import { useGalaxyTutorialEnabled } from '../../store/featureFlagsStore';

interface GalaxyLessonsOfferProps {
  /** Lesson ids the player has finished, as the lobby tracks them. */
  completedModules: readonly string[];
  className?: string;
}

/**
 * The Galactic Age track, offered where a Galactic Age game begins. The
 * lobby's Training Academy grid is for the deep dives every era shares; seven
 * galaxy cards there tripled its height for a mode most players were not about
 * to start. Here it is one row: the first lesson not yet done (the primer
 * first), the count, and the Academy for the rest.
 */
export default function GalaxyLessonsOffer({ completedModules, className }: GalaxyLessonsOfferProps) {
  const galaxyEnabled = useGalaxyTutorialEnabled();
  if (!TUTORIAL_V2_ENABLED || !galaxyEnabled) return null;

  const total = GALAXY_TUTORIAL_MODULE_IDS.length;
  const done = GALAXY_TUTORIAL_MODULE_IDS.filter((id) => completedModules.includes(id)).length;
  const nextId = GALAXY_TUTORIAL_MODULE_IDS.find((id) => !completedModules.includes(id));
  const next = nextId ? TUTORIAL_MODULES.find((m) => m.id === nextId) : undefined;

  return (
    <div
      data-testid="galaxy-lessons-offer"
      className={clsx('rounded-lg border border-bf-gold/25 bg-bf-gold/5 p-3', className)}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 font-display text-sm text-bf-gold">
          <Compass className="w-4 h-4 shrink-0" aria-hidden />
          Galactic Age lessons
        </p>
        <span className="text-[10px] text-bf-muted shrink-0">{`${done} of ${total} done`}</span>
      </div>
      <p className="text-bf-muted text-xs mt-1 leading-relaxed">
        {next
          ? `New to the galaxy? ${total} short lessons: a primer on what changes, then one for each way to win.`
          : 'Every lesson done. Replay any from the Academy.'}
      </p>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-xs">
        {next && (
          <Link to={`/tutorial?module=${next.id}&start=1`} className="text-bf-gold hover:underline">
            {`Start \u201c${next.title}\u201d (~${next.estimatedMinutes} min)`}
          </Link>
        )}
        <Link to="/tutorial" className="text-bf-muted hover:text-bf-gold">
          All lessons
        </Link>
      </div>
    </div>
  );
}
