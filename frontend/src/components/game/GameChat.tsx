import React, { useState, useEffect, useRef } from 'react';
import clsx from 'clsx';
import { getSocket } from '../../services/socket';

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

export default function GameChat({ gameId, embedded = false }: GameChatProps) {
  const [messages, setMessages] = useState<ChatMessagePayload[]>([]);
  const [input, setInput] = useState('');
  const [open, setOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

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

  function send() {
    const t = input.trim();
    if (!t) return;
    const socket = getSocket();
    socket.emit('game:chat', { gameId, message: t });
    setInput('');
  }

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
                <span className="text-cc-text/90 break-words">{m.message}</span>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
          <div className="flex gap-1 p-2 border-t border-cc-border">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && send()}
              placeholder="Message…"
              maxLength={200}
              className="flex-1 min-w-0 bg-cc-dark border border-cc-border rounded px-2 py-1.5 text-xs text-cc-text"
            />
            <button type="button" onClick={send} className="btn-secondary text-xs px-2 py-1">
              Send
            </button>
          </div>
        </>
      )}
    </div>
  );
}
