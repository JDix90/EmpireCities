import React, { useState, useEffect, useRef, useCallback, lazy, Suspense } from 'react';
import { Smile, Film } from 'lucide-react';
import clsx from 'clsx';
import { getSocket } from '../../services/socket';
import { searchGifs, isGifSearchAvailable, type GifResult } from '../../utils/gifSearch';

const EmojiPicker = lazy(() => import('@emoji-mart/react'));

export interface ChatMessagePayload {
  gameId: string;
  playerId: string;
  username: string;
  color: string;
  message: string;
  timestamp: number;
}

interface GameChatProps {
  gameId: string;
  /** In-sidebar layout: does not use fixed positioning, so it never covers the map or territory panel. */
  embedded?: boolean;
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
  return <span className="text-cc-text/90 break-words">{message}</span>;
}

export default function GameChat({ gameId, embedded = false }: GameChatProps) {
  const [messages, setMessages] = useState<ChatMessagePayload[]>([]);
  const [input, setInput] = useState('');
  const [open, setOpen] = useState(false);
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const [gifSearchOpen, setGifSearchOpen] = useState(false);
  const [gifQuery, setGifQuery] = useState('');
  const [gifResults, setGifResults] = useState<GifResult[]>([]);
  const [gifSearching, setGifSearching] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const gifTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const emojiData = useRef<any>(null);

  useEffect(() => {
    const socket = getSocket();
    const onMsg = (msg: ChatMessagePayload) => {
      if (msg.gameId !== gameId) return;
      setMessages((prev) => [...prev.slice(-99), msg]);
    };
    socket.on('game:chat_message', onMsg);
    return () => {
      socket.off('game:chat_message', onMsg);
    };
  }, [gameId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Lazy-load emoji data
  useEffect(() => {
    if (emojiPickerOpen && !emojiData.current) {
      import('@emoji-mart/data').then((mod) => {
        emojiData.current = mod.default;
      });
    }
  }, [emojiPickerOpen]);

  function send(msg?: string) {
    const t = (msg ?? input).trim();
    if (!t) return;
    const socket = getSocket();
    socket.emit('game:chat', { gameId, message: t });
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
        embedded
          ? 'w-full shrink-0 border-t border-cc-border bg-cc-dark/50'
          : 'fixed bottom-4 right-4 z-[80] w-[280px] max-w-[calc(100vw-2rem)] rounded-lg border border-cc-border bg-cc-surface/95 shadow-xl backdrop-blur-sm',
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-3 py-2 text-left text-sm border-b border-cc-border/80 hover:bg-white/5"
      >
        <span className="font-display text-cc-gold">Chat</span>
        <span className="text-cc-muted text-xs">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <>
          {/* Messages */}
          <div
            className={clsx(
              'overflow-y-auto px-3 py-2 space-y-1.5',
              embedded ? 'max-h-[140px]' : 'h-[180px]',
            )}
          >
            {messages.map((m, i) => (
              <div key={`${m.timestamp}-${i}`} className="text-xs">
                <span className="font-semibold" style={{ color: m.color }}>
                  {m.username}:
                </span>{' '}
                {renderMessage(m.message)}
              </div>
            ))}
            <div ref={bottomRef} />
          </div>

          {/* Emoji Picker popover */}
          {emojiPickerOpen && emojiData.current && (
            <div className="border-t border-cc-border">
              <Suspense fallback={<div className="p-2 text-xs text-cc-muted">Loading...</div>}>
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
            <div className="border-t border-cc-border p-2 space-y-2">
              <input
                value={gifQuery}
                onChange={(e) => handleGifSearch(e.target.value)}
                placeholder="Search GIFs…"
                className="w-full bg-cc-dark border border-cc-border rounded px-2 py-1.5 text-xs text-cc-text"
                autoFocus
              />
              {gifSearching && <p className="text-xs text-cc-muted">Searching…</p>}
              {gifResults.length > 0 && (
                <div className="grid grid-cols-2 gap-1 max-h-[160px] overflow-y-auto">
                  {gifResults.map((gif) => (
                    <button
                      key={gif.id}
                      type="button"
                      onClick={() => handleGifSelect(gif)}
                      className="rounded overflow-hidden hover:ring-1 hover:ring-cc-gold transition-all"
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
                <p className="text-xs text-cc-muted">No GIFs found</p>
              )}
            </div>
          )}

          {/* Input bar */}
          <div className="flex items-center gap-1 p-2 border-t border-cc-border">
            <button
              type="button"
              onClick={() => { setEmojiPickerOpen((o) => !o); setGifSearchOpen(false); }}
              className={clsx(
                'w-7 h-7 flex items-center justify-center rounded transition-colors shrink-0',
                emojiPickerOpen ? 'text-cc-gold' : 'text-cc-muted hover:text-cc-text',
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
                  gifSearchOpen ? 'text-cc-gold' : 'text-cc-muted hover:text-cc-text',
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
              className="flex-1 min-w-0 bg-cc-dark border border-cc-border rounded px-2 py-1.5 text-xs text-cc-text"
            />
            <button type="button" onClick={() => send()} className="btn-secondary text-xs px-2 py-1">
              Send
            </button>
          </div>
        </>
      )}
    </div>
  );
}
