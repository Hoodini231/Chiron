import { useEffect, useRef, useState } from 'react';
import type { ChatMessage } from '../types/api';

interface Props {
  messages: ChatMessage[];
  onSend: (message: string) => Promise<void>;
  disabled?: boolean;
  status?: string;
}

export default function ChatPanel({ messages, onSend, disabled = false, status }: Props) {
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || sending || disabled) return;
    setSending(true);
    try {
      await onSend(text);
      setInput('');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="chat-panel">
      <div className="conversation-scroll" ref={scrollRef}>
        <div className="chat-messages">
          {messages.map((msg, i) => (
            <div key={i} className={`chat-message ${msg.role}`}>
              <strong>{msg.role === 'user' ? 'You' : 'Coach'}</strong>
              <p>{msg.text}</p>
            </div>
          ))}
        </div>
      </div>
      {status && <p className="chat-status">{status}</p>}
      <form className="chat-form" onSubmit={handleSubmit}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={disabled || sending}
          placeholder="Ask a follow-up question..."
          rows={2}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSubmit(e);
            }
          }}
        />
        <button type="submit" disabled={disabled || sending || !input.trim()}>
          {sending ? 'Sending...' : 'Send'}
        </button>
      </form>
    </div>
  );
}
