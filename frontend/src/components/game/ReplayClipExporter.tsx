import { useEffect, useState } from 'react';
import { X, Download, Share2, Film, Loader2, Clapperboard } from 'lucide-react';
import clsx from 'clsx';
import toast from 'react-hot-toast';
import { api } from '../../services/api';
import type { GameState } from '../../store/gameStore';
import type { CondensedFrame } from '../../utils/replayCondense';
import type { ClipMapData } from '../../utils/replayClipRenderer';
import {
  exportClipVideo,
  exportClipGif,
  downloadClip,
  shareClipFile,
  pickVideoMime,
  type ClipAspect,
  type ClipFormat,
  type ClipResult,
} from '../../utils/replayClipExport';

interface ReplayClipExporterProps {
  open: boolean;
  onClose: () => void;
  frames: CondensedFrame[];
  snapshots: GameState[];
  mapData: ClipMapData;
  eraLabel: string;
  gameId: string;
  /** Records a share analytics event for the chosen platform. */
  onShared?: (platform: 'native' | 'clipboard') => void;
}

const ASPECTS: Array<{ id: ClipAspect; label: string; hint: string }> = [
  { id: '9:16', label: '9:16', hint: 'TikTok / Reels' },
  { id: '1:1', label: '1:1', hint: 'Feed' },
  { id: '16:9', label: '16:9', hint: 'Link / YouTube' },
];

export default function ReplayClipExporter({
  open,
  onClose,
  frames,
  snapshots,
  mapData,
  eraLabel,
  gameId,
  onShared,
}: ReplayClipExporterProps) {
  const [aspect, setAspect] = useState<ClipAspect>('9:16');
  const [format, setFormat] = useState<ClipFormat>('video');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<ClipResult | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  // Lazy one-time detection; pickVideoMime() probes MediaRecorder support.
  const [videoSupported] = useState(() => pickVideoMime() !== null);

  // Default to GIF when the browser can't record video.
  useEffect(() => {
    if (open && !videoSupported) setFormat('gif');
  }, [open, videoSupported]);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  // Reset generated output whenever the inputs change.
  useEffect(() => {
    setResult(null);
    setPreviewUrl((url) => {
      if (url) URL.revokeObjectURL(url);
      return null;
    });
    setProgress(0);
  }, [aspect, format, open]);

  if (!open) return null;

  const baseName = `borderfall-replay-${gameId.slice(0, 8)}`;

  const handleGenerate = async () => {
    if (busy) return;
    setBusy(true);
    setProgress(0);
    setResult(null);
    try {
      const input = {
        frames,
        snapshots,
        mapData,
        eraLabel,
        aspect,
        onProgress: setProgress,
      };
      const out = format === 'video' ? await exportClipVideo(input) : await exportClipGif(input);
      const url = URL.createObjectURL(out.blob);
      setResult(out);
      setPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return url;
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to generate clip');
    } finally {
      setBusy(false);
    }
  };

  const handleDownload = () => {
    if (!result) return;
    downloadClip(result, baseName);
    toast.success('Clip downloaded');
  };

  const handleShare = async () => {
    if (!result) return;
    // The shared text embeds the replay link, so make sure it's viewable.
    // 403s harmlessly for non-participants (the link is already public to them).
    api.post(`/share/${gameId}/make-public`).catch(() => {});
    const text = `My Borderfall match — watch the highlights! ${window.location.origin}/replay/${gameId}?source=share`;
    const shared = await shareClipFile(result, baseName, text);
    if (shared) {
      onShared?.('native');
    } else {
      handleDownload();
    }
  };

  const sizeKb = result ? Math.round(result.blob.size / 1024) : 0;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/85 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-2xl border border-bf-border bg-bf-surface p-5 flex flex-col gap-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="font-display text-bf-gold text-lg flex items-center gap-2">
            <Clapperboard className="w-5 h-5" /> Export Highlight Clip
          </h2>
          <button onClick={onClose} className="text-white/40 hover:text-white" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Aspect ratio */}
        <div>
          <p className="text-xs text-white/50 uppercase tracking-wide mb-1.5">Aspect ratio</p>
          <div className="grid grid-cols-3 gap-2">
            {ASPECTS.map((a) => (
              <button
                key={a.id}
                onClick={() => setAspect(a.id)}
                className={clsx(
                  'rounded-lg border px-2 py-2 text-center transition-all',
                  aspect === a.id
                    ? 'bg-bf-gold/20 border-bf-gold/40 text-bf-gold'
                    : 'bg-white/5 border-bf-border text-white/60 hover:text-white/80',
                )}
              >
                <div className="text-sm font-semibold">{a.label}</div>
                <div className="text-[10px] text-white/40">{a.hint}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Format */}
        <div>
          <p className="text-xs text-white/50 uppercase tracking-wide mb-1.5">Format</p>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setFormat('video')}
              disabled={!videoSupported}
              className={clsx(
                'rounded-lg border px-3 py-2 text-sm font-medium transition-all flex items-center justify-center gap-1.5',
                format === 'video'
                  ? 'bg-bf-gold/20 border-bf-gold/40 text-bf-gold'
                  : 'bg-white/5 border-bf-border text-white/60 hover:text-white/80',
                !videoSupported && 'opacity-40 cursor-not-allowed',
              )}
            >
              <Film className="w-4 h-4" /> Video
            </button>
            <button
              onClick={() => setFormat('gif')}
              className={clsx(
                'rounded-lg border px-3 py-2 text-sm font-medium transition-all',
                format === 'gif'
                  ? 'bg-bf-gold/20 border-bf-gold/40 text-bf-gold'
                  : 'bg-white/5 border-bf-border text-white/60 hover:text-white/80',
              )}
            >
              GIF
            </button>
          </div>
          {!videoSupported && (
            <p className="text-[11px] text-white/40 mt-1">Video recording isn't supported here — GIF only.</p>
          )}
        </div>

        {/* Preview / progress */}
        <div className="rounded-xl border border-bf-border bg-black/30 min-h-[160px] flex items-center justify-center overflow-hidden">
          {previewUrl ? (
            format === 'video' ? (
              <video src={previewUrl} controls autoPlay loop muted className="max-h-[40vh] w-auto" />
            ) : (
              <img src={previewUrl} alt="Replay clip preview" className="max-h-[40vh] w-auto" />
            )
          ) : busy ? (
            <div className="flex flex-col items-center gap-2 text-white/60 py-8">
              <Loader2 className="w-6 h-6 animate-spin text-bf-gold" />
              <p className="text-sm">{format === 'video' ? 'Recording clip…' : 'Encoding GIF…'}</p>
              <div className="w-40 h-1.5 rounded-full bg-white/10 overflow-hidden">
                <div className="h-full bg-bf-gold transition-all" style={{ width: `${Math.round(progress * 100)}%` }} />
              </div>
            </div>
          ) : (
            <p className="text-white/40 text-sm py-8 px-4 text-center">
              Generate a condensed highlight clip from this match's best moments.
            </p>
          )}
        </div>

        {/* Actions */}
        {result ? (
          <div className="flex flex-col gap-2">
            <p className="text-[11px] text-white/40 text-center">{result.ext.toUpperCase()} · {sizeKb} KB</p>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={handleDownload}
                className="rounded-xl bg-white/10 hover:bg-white/15 border border-white/10 px-3 py-2.5 text-sm font-medium text-white flex items-center justify-center gap-2"
              >
                <Download className="w-4 h-4" /> Download
              </button>
              <button
                onClick={handleShare}
                className="rounded-xl bg-bf-gold/20 hover:bg-bf-gold/30 border border-bf-gold/30 px-3 py-2.5 text-sm font-medium text-bf-gold flex items-center justify-center gap-2"
              >
                <Share2 className="w-4 h-4" /> Share
              </button>
            </div>
            <button onClick={handleGenerate} className="text-xs text-white/40 hover:text-white/70 mt-1">
              Regenerate
            </button>
          </div>
        ) : (
          <button
            onClick={handleGenerate}
            disabled={busy}
            className="rounded-xl bg-bf-gold/20 hover:bg-bf-gold/30 border border-bf-gold/30 px-3 py-3 text-sm font-semibold text-bf-gold flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Clapperboard className="w-4 h-4" />}
            {busy ? 'Generating…' : 'Generate Clip'}
          </button>
        )}
      </div>
    </div>
  );
}
