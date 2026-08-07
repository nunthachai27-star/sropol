'use client';

// Phase 3 — clinical-chat UI panel (Thai, cost-gated, informative UX).
// Renders a floating chat panel for clinicians. When the server reports the
// feature disabled (503) it collapses to a subtle hint instead of an error
// loop. Constitution V: every operation shows progress + actionable Thai
// errors; multi-turn weaves prior turns so the context stays coherent.
import { useState, useRef, useEffect } from 'react';
import { Send, Loader2, Bot, MessageSquareOff } from 'lucide-react';
import { ClinicalMarkdown } from '@/components/chat/ClinicalMarkdown';
import type { ClinicalChatMode } from '@/services/chat/prompt-config';

interface ChatMessageUi {
  role: 'user' | 'assistant';
  content: string;
  error?: boolean;
}

export function ClinicalChatPanel({ mode = 'clinical' }: { mode?: ClinicalChatMode }) {
  const [open, setOpen] = useState(false);
  const [disabled, setDisabled] = useState(false);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<ChatMessageUi[]>([]);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, open]);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    setBusy(true);
    setMessages((m) => [...m, { role: 'user', content: text }]);
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: text, mode }),
      });
      const body = (await res.json().catch(() => ({}))) as { answer?: string; error?: string };
      if (res.status === 503) {
        setDisabled(true);
      } else if (!res.ok || !body.answer) {
        setMessages((m) => [
          ...m,
          { role: 'assistant', content: body.error ?? 'ยังตอบไม่ได้ ลองใหม่อีกครั้ง', error: true },
        ]);
      } else {
        setMessages((m) => [...m, { role: 'assistant', content: body.answer as string }]);
      }
    } catch {
      setMessages((m) => [
        ...m,
        { role: 'assistant', content: 'ไม่สามารถติดต่อผู้ช่วยแชทได้', error: true },
      ]);
    } finally {
      setBusy(false);
    }
  }

  if (disabled) {
    return (
      <button
        onClick={() => setDisabled(false)}
        title="เปิดผู้ช่วยแชททางคลินิก"
        className="fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-full bg-slate-700 px-4 py-2 text-sm text-white shadow-lg"
      >
        <MessageSquareOff size={16} />
        AI ปิด
      </button>
    );
  }

  return (
    <div className="fixed bottom-5 right-5 z-40 flex w-[22rem] flex-col rounded-2xl border border-slate-200 bg-white shadow-2xl">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center justify-between rounded-t-2xl bg-teal-600 px-4 py-3 text-white"
      >
        <span className="flex items-center gap-2 text-sm font-medium">
          <Bot size={18} />
          ผู้ช่วยแชททางคลินิก
        </span>
        <span>{open ? 'ซ่อน' : 'ขยาย'}</span>
      </button>
      {open && (
        <>
          <div ref={listRef} className="h-72 space-y-2 overflow-y-auto p-3">
            {messages.length === 0 && (
              <p className="text-xs text-slate-500">
                ถามเรื่องผู้ป่วย ผู้ป่วยเสี่ยงสูง หรือครรภ์ในความดูแลได้
              </p>
            )}
            {messages.map((m, i) => (
              <div
                key={i}
                className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                  m.role === 'user'
                    ? 'ml-auto bg-teal-100 text-teal-900'
                    : m.error
                      ? 'bg-rose-50 text-rose-800'
                      : 'bg-slate-100 text-slate-800'
                }`}
              >
                {m.role === 'user' || m.error ? (
                  m.content
                ) : (
                  <ClinicalMarkdown>{m.content}</ClinicalMarkdown>
                )}
              </div>
            ))}
            {busy && (
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <Loader2 size={14} className="animate-spin" /> กำลังคิด…
              </div>
            )}
          </div>
          <div className="flex items-end gap-2 border-t border-slate-100 p-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              rows={2}
              placeholder="พิมพ์คำถามเป็นภาษาไทย…"
              className="flex-1 resize-none rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
            <button
              onClick={() => void send()}
              disabled={busy || !input.trim()}
              className="rounded-lg bg-teal-600 p-2 text-white disabled:opacity-50"
              aria-label="ส่งคำถาม"
            >
              <Send size={16} />
            </button>
          </div>
        </>
      )}
    </div>
  );
}
