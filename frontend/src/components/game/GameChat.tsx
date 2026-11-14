import React, { useState, useEffect, useRef, useCallback, Suspense } from 'react';
import { createPortal } from 'react-dom';
import { Smile, Film, MoreHorizontal } from 'lucide-react';
import clsx from 'clsx';
import toast from 'react-hot-toast';
import { getSocket } from '../../services/socket';
import { lazyWithChunkRetry } from '../../utils/lazyWithChunkRetry';
import { searchGifs, isGifSearchAvailable, type GifResult } from '../../utils/gifSearch';
import { useAuthStore } from '../../store/authStore';
import { useChatSafetyEnabled } from '../../store/featureFlagsStore';
import { blockPlayer, type ChatMessageToReport } from '../../services/chatSafety';
import ReportChatModal from './ReportChatModal';

// Retries, then reloads onto a new build, if a deploy deleted this chunk.
const EmojiPicker = lazyWithChunkRetry(() => import('@emoji-mart/react'));

export interface ChatMessagePayload {
  gameId: string;
  /** The sender. Spectator chat carries it since chat_safety_enabled. */
  playerId?: string;
  username: string;
  /** Spectator chat has no seat colour. */
  color?: string;
  message: string;
  timestamp: number;
  /** What a report names (chat_safety_enabled). */
  messageId?: string;
}

interface GameChatProps {
  gameId: string;
  /** In-sidebar layout: does not use fixed positioning, so it never covers the map or territory panel. */
  embedded?: boolean;
  /** Whether the chat should start expanded on first render. */
  defaultOpen?: boolean;
  /** When true, uses lobby chat events (game:lobby_chat / game:lobby_chat_message) instead of in-game events. */
  lobbyMode?: boolean;
  /** When true, uses spectator chat events scoped to the spectator room. */
  spectatorMode?: boolean;
  /**
   * Embedded, and filling the box it sits in: the messages take whatever
   * height the composer leaves (the spectator's phone panel). Without it the
   * embedded chat caps itself for the game's sidebar.
   */
  fill?: boolean;
}

const GIF_REGEX = /^\[gif:(https:\/\/media1?\.tenor\.com\/[^\]]+)\]$/;

function renderMessage(message: string) {
  const gifMatch = message.match(GIF_REGEX);
  if (gifMatch) {
    return (
      <img
        src={gifMatch[1]}
        alt="GIF"
        className="max-w-[180px] rounded mt-1"
        loading="lazy"
      />
    );
  }
  return <span className="text-bf-text/90 break-words">{message}</span>;
}

export default function GameChat({ gameId, embedded = false, defaultOpen = false, lobbyMode = false, spectatorMode = false, fill = false }: GameChatProps) {
  const [messages, setMessages] = useState<ChatMessagePayload[]>([]);
  const [input, setInput] = useState('');
  const [open, setOpen] = useState(defaultOpen);
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const [gifSearchOpen, setGifSearchOpen] = useState(false);
  const [gifQuery, setGifQuery] = useState('');
  const [gifResults, setGifResults] = useState<GifResult[]>([]);
  const [gifSearching, setGifSearching] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const gifTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const emojiData = useRef<any>(null);
  // Chat safety (chat_safety_enabled): each message from someone else offers
  // Report and Block. A block also drops what they already said here; the
  // server stops sending their messages to this player.
  const chatSafety = useChatSafetyEnabled();
  const myId = useAuthStore((s) => s.user?.user_id);
  const channel: ChatMessageToReport['channel'] = spectatorMode ? 'spectator' : lobbyMode ? 'lobby' : 'game';
  const [actionsFor, setActionsFor] = useState<string | null>(null);
  const [reporting, setReporting] = useState<ChatMessageToReport | null>(null);
  const dropMessagesFrom = useCallback((playerId: string) => {
    setMessages((prev) => prev.filter((m) => m.playerId !== playerId));
    setActionsFor(null);
  }, []);
  const block = useCallback(async (m: ChatMessagePayload) => {
    if (!m.playerId) return;
    try {
      await blockPlayer(m.playerId);
      dropMessagesFrom(m.playerId);
      toast.success(`Blocked ${m.username}. You won’t see their chat. Unblock them in Settings.`);
    } catch {
      toast.error('Could not block them. Try again in a moment.');
    }
  }, [dropMessagesFrom]);

  useEffect(() => {
    const socket = getSocket();
    const eventName = spectatorMode
      ? 'game:spectator_chat_message'
      : lobbyMode
        ? 'game:lobby_chat_message'
        : 'game:chat_message';
    const onMsg = (msg: ChatMessagePayload) => {
      if (msg.gameId !== gameId) return;
      setMessages((prev) => [...prev.slice(-99), msg]);
    };
    socket.on(eventName, onMsg);
    return () => {
      socket.off(eventName, onMsg);
    };
  }, [gameId, lobbyMode, spectatorMode]);

  useEffect(() => {
    const container = chatContainerRef.current;
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  }, [messages]);

  // Lazy-load emoji data
  useEffect(() => {
    if (emojiPickerOpen && !emojiData.current) {
      import('@emoji-mart/data').then((mod) => {
        emojiData.current = mod.default;
      }).catch(() => {
        // A stale tab after a deploy: the picker's own load recovers; this
        // must not become an unhandled rejection (a Sentry error by itself).
      });
    }
  }, [emojiPickerOpen]);

  function send(msg?: string) {
    const t = (msg ?? input).trim();
    if (!t) return;
    const socket = getSocket();
    socket.emit(
      spectatorMode ? 'game:spectator_chat' : lobbyMode ? 'game:lobby_chat' : 'game:chat',
      { gameId, message: t },
    );
    if (!msg) setInput('');
    setEmojiPickerOpen(false);
    setGifSearchOpen(false);
  }

  const handleEmojiSelect = useCallback((emoji: any) => {
    setInput((prev) => prev + (emoji.native ?? ''));
    setEmojiPickerOpen(false);
  }, []);

  const handleGifSearch = useCallback((q: string) => {
    setGifQuery(q);
    if (gifTimerRef.current) clearTimeout(gifTimerRef.current);
    if (!q.trim()) {
      setGifResults([]);
      return;
    }
    setGifSearching(true);
    gifTimerRef.current = setTimeout(async () => {
      const results = await searchGifs(q);
      setGifResults(results);
      setGifSearching(false);
    }, 300);
  }, []);

  const handleGifSelect = useCallback((gif: GifResult) => {
    send(`[gif:${gif.url}]`);
    setGifSearchOpen(false);
    setGifQuery('');
    setGifResults([]);
  }, [gameId]);

  const gifAvailable = isGifSearchAvailable();

  return (
    <div
      className={clsx(
        'overflow-hidden',
        embedded && fill
          ? 'w-full flex-1 min-h-0 flex flex-col border-t border-bf-border bg-bf-dark/50'
          : embedded
          // Capped so the composer, emoji and GIF rows can't grow the chat into
          // the sidebar's action button above it.
          ? 'w-full shrink-0 max-h-[45%] flex flex-col border-t border-bf-border bg-bf-dark/50'
          : 'fixed bottom-4 right-4 z-[80] w-[280px] max-w-[calc(100vw-2rem)] rounded-lg border border-bf-border bg-bf-surface/95 shadow-xl backdrop-blur-sm',
      )}
    >
      {!embedded && (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="w-full flex items-center justify-between px-3 py-2 text-left text-sm border-b border-bf-border/80 hover:bg-white/5"
        >
          <span className="font-display text-bf-gold">Chat</span>
          <span className="text-bf-muted text-xs">{open ? '▾' : '▸'}</span>
        </button>
      )}
      {(embedded || open) && (
        <>
          {/* Messages */}
          <div
            ref={chatContainerRef}
            className={clsx(
              'overflow-y-auto px-3 py-2 space-y-1.5',
              embedded && fill ? 'flex-1 min-h-0' : embedded ? 'max-h-[min(28vh,200px)]' : 'h-[180px]',
            )}
          >
            {messages.map((m, i) => {
              const key = m.messageId ?? `${m.timestamp}-${i}`;
              const canAct = chatSafety && !!m.playerId && m.playerId !== myId;
              return (
                <div key={key} className="text-xs" data-chat-message="">
                  <div className="flex items-start gap-1">
                    <div className="min-w-0 flex-1">
                      <span className="font-semibold" style={{ color: m.color }}>
                        {m.username}:
                      </span>{' '}
                      {renderMessage(m.message)}
                    </div>
                    {canAct && (
                      <button
                        type="button"
                        onClick={() => setActionsFor((cur) => (cur === key ? null : key))}
                        aria-label={`Report or block ${m.username}`}
                        aria-expanded={actionsFor === key}
                        className="tap-target shrink-0 -my-0.5 min-h-[24px] min-w-[24px] flex items-center justify-center rounded text-bf-muted/70 hover:text-bf-text hover:bg-white/5"
                      >
                        <MoreHorizontal className="w-3.5 h-3.5" aria-hidden />
                      </button>
                    )}
                  </div>
                  {canAct && actionsFor === key && (
                    <div className="mt-1 flex flex-wrap gap-1.5" role="group" aria-label={`${m.username}'s message`}>
                      <button
                        type="button"
                        onClick={() => {
                          setActionsFor(null);
                          setReporting({ gameId, channel, messageId: m.messageId, playerId: m.playerId!, username: m.username, message: m.message });
                        }}
                        className="tap-target rounded border border-bf-border px-2 py-1 text-bf-text hover:border-bf-muted"
                      >
                        Report message
                      </button>
                      <button
                        type="button"
                        onClick={() => void block(m)}
                        className="tap-target rounded border border-red-800/60 px-2 py-1 text-red-200 hover:border-red-600"
                      >
                        Block {m.username}
                      </button>
                      <button
                        type="button"
                        onClick={() => setActionsFor(null)}
                        className="tap-target rounded px-2 py-1 text-bf-muted hover:text-bf-text"
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
            {messages.length === 0 && (
              <p className="text-[11px] text-bf-muted/70 italic">
                Chat is live only — messages aren't stored, so they won't be here after a reload.
              </p>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Emoji Picker popover */}
          {emojiPickerOpen && emojiData.current && (
            <div className="border-t border-bf-border">
              <Suspense fallback={<div className="p-2 text-xs text-bf-muted">Loading...</div>}>
                <EmojiPicker
                  data={emojiData.current}
                  onEmojiSelect={handleEmojiSelect}
                  theme="dark"
                  previewPosition="none"
                  skinTonePosition="none"
                  perLine={7}
                  maxFrequentRows={1}
                  set="native"
                />
              </Suspense>
            </div>
          )}

          {/* GIF Search panel */}
          {gifSearchOpen && (
            <div className="border-t border-bf-border p-2 space-y-2">
              <input
                value={gifQuery}
                onChange={(e) => handleGifSearch(e.target.value)}
                placeholder="Search GIFs…"
                className="w-full bg-bf-dark border border-bf-border rounded px-2 py-1.5 text-xs text-bf-text"
                autoFocus
              />
              {gifSearching && <p className="text-xs text-bf-muted">Searching…</p>}
              {gifResults.length > 0 && (
                <div className="grid grid-cols-2 gap-1 max-h-[160px] overflow-y-auto">
                  {gifResults.map((gif) => (
                    <button
                      key={gif.id}
                      type="button"
                      onClick={() => handleGifSelect(gif)}
                      className="rounded overflow-hidden hover:ring-1 hover:ring-bf-gold transition-all"
                    >
                      <img
                        src={gif.preview}
                        alt="GIF"
                        className="w-full h-auto"
                        loading="lazy"
                      />
                    </button>
                  ))}
                </div>
              )}
              {!gifSearching && gifQuery && gifResults.length === 0 && (
                <p className="text-xs text-bf-muted">No GIFs found</p>
              )}
            </div>
          )}

          {/* Input bar */}
          <div className="flex items-center gap-1 p-2 border-t border-bf-border">
            <button
              type="button"
              onClick={() => { setEmojiPickerOpen((o) => !o); setGifSearchOpen(false); }}
              className={clsx(
                'w-7 h-7 flex items-center justify-center rounded transition-colors shrink-0',
                emojiPickerOpen ? 'text-bf-gold' : 'text-bf-muted hover:text-bf-text',
              )}
              aria-label="Emoji"
            >
              <Smile className="w-4 h-4" />
            </button>
            {gifAvailable && (
              <button
                type="button"
                onClick={() => { setGifSearchOpen((o) => !o); setEmojiPickerOpen(false); }}
                className={clsx(
                  'w-7 h-7 flex items-center justify-center rounded transition-colors shrink-0',
                  gifSearchOpen ? 'text-bf-gold' : 'text-bf-muted hover:text-bf-text',
                )}
                aria-label="GIF"
              >
                <Film className="w-4 h-4" />
              </button>
            )}
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { send(); }
              }}
              placeholder="Message…"
              maxLength={500}
              className="flex-1 min-w-0 bg-bf-dark border border-bf-border rounded px-2 py-1.5 text-xs text-bf-text"
            />
            <button type="button" onClick={() => send()} className="btn-secondary text-xs px-2 py-1">
              Send
            </button>
          </div>
        </>
      )}
      {/* On the page, not in the chat box: its blur and clipping would trap a fixed overlay. */}
      {reporting && createPortal(
        <ReportChatModal target={reporting} onClose={() => setReporting(null)} onBlocked={dropMessagesFrom} />,
        document.body,
      )}
    </div>
  );
}
