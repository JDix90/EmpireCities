import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import ReplayClipExporter from './ReplayClipExporter';
import type { CondensedFrame } from '../../utils/replayCondense';
import type { GameState } from '../../store/gameStore';
import type { ClipMapData } from '../../utils/replayClipRenderer';

vi.mock('../../services/api', () => ({ api: { post: vi.fn().mockResolvedValue({ data: {} }) } }));
vi.mock('react-hot-toast', () => ({
  default: { error: vi.fn(), success: vi.fn() },
}));

/**
 * Video capture is real-time, so a run can outlive the format that started it.
 * These fakes let a test resolve the video export by hand, after the player has
 * already switched to GIF — the exact sequence that produced a broken preview
 * labelled "MP4" under a lit GIF button.
 */
let resolveVideo: ((r: unknown) => void) | undefined;
let videoAborted = false;
const exportClipVideo = vi.fn();
const exportClipGif = vi.fn();

vi.mock('../../utils/replayClipExport', async () => {
  const actual = await vi.importActual<typeof import('../../utils/replayClipExport')>(
    '../../utils/replayClipExport',
  );
  return {
    ...actual,
    pickVideoMime: () => ({ mime: 'video/mp4', ext: 'mp4' }),
    exportClipVideo: (input: { signal?: AbortSignal }) => exportClipVideo(input),
    exportClipGif: (input: { signal?: AbortSignal }) => exportClipGif(input),
    downloadClip: vi.fn(),
    shareClipFile: vi.fn().mockResolvedValue(false),
  };
});

const frames: CondensedFrame[] = [{ index: 0, dwellMs: 1000, reason: 'capture' } as CondensedFrame];
const snapshots = [{ territories: {}, players: [] } as unknown as GameState];
const mapData = { territories: [], connections: [] } as unknown as ClipMapData;

function renderExporter() {
  return render(
    <ReplayClipExporter
      open
      onClose={() => {}}
      frames={frames}
      snapshots={snapshots}
      mapData={mapData}
      eraLabel="Ancient"
      gameId="abcdef123456"
    />,
  );
}

beforeEach(() => {
  resolveVideo = undefined;
  videoAborted = false;
  exportClipVideo.mockReset();
  exportClipGif.mockReset();
  exportClipVideo.mockImplementation((input: { signal?: AbortSignal }) => new Promise((resolve) => {
    resolveVideo = resolve;
    input.signal?.addEventListener('abort', () => { videoAborted = true; });
  }));
  exportClipGif.mockResolvedValue({
    blob: new Blob(['gif'], { type: 'image/gif' }),
    ext: 'gif',
    mime: 'image/gif',
    format: 'gif',
  });
  globalThis.URL.createObjectURL = vi.fn(() => 'blob:preview');
  globalThis.URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ReplayClipExporter', () => {
  it('drops a video result that finishes after the player switched to GIF', async () => {
    renderExporter();
    fireEvent.click(screen.getByRole('button', { name: /generate clip/i }));
    await waitFor(() => expect(exportClipVideo).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: 'GIF' }));

    // The superseded recorder finishes anyway — it must not reach the UI.
    await act(async () => {
      resolveVideo?.({ blob: new Blob(['mp4'], { type: 'video/mp4' }), ext: 'mp4', mime: 'video/mp4', format: 'video' });
      await Promise.resolve();
    });

    expect(screen.queryByAltText('Replay clip preview')).toBeNull();
    expect(screen.queryByText(/MP4/i)).toBeNull();
    expect(screen.getByRole('button', { name: /generate clip/i })).toBeInTheDocument();
  });

  it('cancels the in-flight run when the format changes', async () => {
    renderExporter();
    fireEvent.click(screen.getByRole('button', { name: /generate clip/i }));
    await waitFor(() => expect(exportClipVideo).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: 'GIF' }));
    expect(videoAborted).toBe(true);
  });

  it('previews a GIF result in an <img> and labels it GIF', async () => {
    renderExporter();
    fireEvent.click(screen.getByRole('button', { name: 'GIF' }));
    fireEvent.click(screen.getByRole('button', { name: /generate clip/i }));

    await waitFor(() => expect(screen.getByAltText('Replay clip preview')).toBeInTheDocument());
    expect(screen.getByText(/^GIF ·/)).toBeInTheDocument();
    expect(exportClipGif).toHaveBeenCalled();
  });
});
