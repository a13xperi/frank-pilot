import { useCallback, useEffect, useRef, useState } from 'react';
import { Send, Loader2 } from 'lucide-react';
import { api } from '@/api/client';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/Button';
import { useToast } from '@/components/Toast';

interface Message {
  id: string;
  applicationId: string;
  senderUserId: string;
  senderRole: 'staff' | 'applicant' | 'tenant';
  senderName: string;
  body: string;
  createdAt: string;
  readAt: string | null;
}

interface MessagesResponse {
  messages: Message[];
}

function fmtTime(d: string): string {
  const date = new Date(d);
  const today = new Date();
  const yest = new Date(today);
  yest.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) {
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }
  if (date.toDateString() === yest.toDateString()) {
    return `Yesterday ${date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
  }
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function ApplicationMessages({ applicationId }: { applicationId: string }) {
  const { user } = useAuth();
  const toast = useToast();
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const fetchMessages = useCallback(async () => {
    try {
      const res = await api.get<MessagesResponse>(
        `/api/applications/${applicationId}/messages`,
      );
      setMessages(res.messages);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load messages');
    } finally {
      setLoading(false);
    }
  }, [applicationId]);

  // Mark incoming (applicant/tenant) messages as read on open / after fetch.
  const markIncomingRead = useCallback(
    async (msgs: Message[]) => {
      const unread = msgs.filter(
        (m) =>
          (m.senderRole === 'applicant' || m.senderRole === 'tenant') && !m.readAt,
      );
      if (unread.length === 0) return;
      await Promise.allSettled(
        unread.map((m) =>
          api.post(`/api/applications/${applicationId}/messages/${m.id}/read`),
        ),
      );
    },
    [applicationId],
  );

  useEffect(() => {
    fetchMessages();
    const interval = setInterval(fetchMessages, 15000);
    const onFocus = () => fetchMessages();
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', onFocus);
    };
  }, [fetchMessages]);

  // After messages are loaded/changed, mark any incoming applicant/tenant
  // messages as read.
  useEffect(() => {
    if (!loading && messages.length > 0) {
      markIncomingRead(messages);
    }
  }, [loading, messages, markIncomingRead]);

  // Scroll to bottom on new message
  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages.length]);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = draft.trim();
    if (!trimmed || sending || !user) return;

    const optimistic: Message = {
      id: `optimistic-${Date.now()}`,
      applicationId,
      senderUserId: user.id,
      senderRole: 'staff',
      senderName: `${user.firstName} ${user.lastName}`,
      body: trimmed,
      createdAt: new Date().toISOString(),
      readAt: null,
    };
    setMessages((prev) => [...prev, optimistic]);
    setDraft('');
    setSending(true);
    try {
      const res = await api.post<{ message: Message }>(
        `/api/applications/${applicationId}/messages`,
        { body: trimmed },
      );
      setMessages((prev) => prev.map((m) => (m.id === optimistic.id ? res.message : m)));
    } catch (err) {
      setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
      setDraft(trimmed);
      toast.error(err instanceof Error ? err.message : 'Failed to send');
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white">
      <header className="border-b border-gray-100 px-5 py-3">
        <h2 className="text-sm font-medium uppercase tracking-wider text-gray-600">
          Messages
        </h2>
        <p className="text-xs text-gray-500">
          Two-way thread with the applicant / tenant.
        </p>
      </header>

      <div
        ref={scrollRef}
        className="max-h-[28rem] min-h-[12rem] space-y-3 overflow-y-auto px-5 py-4"
      >
        {loading ? (
          <div className="flex items-center justify-center py-6 text-gray-400">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : messages.length === 0 ? (
          <p className="py-6 text-center text-sm text-gray-400">
            No messages yet.
          </p>
        ) : (
          messages.map((m) => (
            <Bubble key={m.id} m={m} selfId={user?.id || ''} />
          ))
        )}
      </div>

      {error && (
        <div className="mx-5 mb-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      )}

      <form
        onSubmit={handleSend}
        className="flex items-end gap-2 border-t border-gray-100 px-5 py-3"
      >
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={2}
          maxLength={4000}
          placeholder="Reply to the applicant…"
          className="flex-1 resize-none rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              handleSend(e);
            }
          }}
        />
        <Button type="submit" variant="primary" loading={sending} disabled={draft.trim().length === 0}>
          <Send className="h-4 w-4" />
          Send
        </Button>
      </form>
    </div>
  );
}

function Bubble({ m, selfId }: { m: Message; selfId: string }) {
  const isMine = m.senderUserId === selfId;
  const isStaff = m.senderRole === 'staff';
  return (
    <div className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[80%] ${isMine ? 'text-right' : 'text-left'}`}>
        <div className="mb-1 flex items-center gap-2 text-[11px] text-gray-400">
          {!isMine && <span className="font-medium text-gray-700">{m.senderName}</span>}
          <span
            className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
              isStaff
                ? 'bg-blue-100 text-blue-700'
                : 'bg-emerald-100 text-emerald-700'
            }`}
          >
            {isMine ? 'Staff' : isStaff ? 'Staff' : m.senderRole === 'tenant' ? 'Tenant' : 'Applicant'}
          </span>
          <span>{fmtTime(m.createdAt)}</span>
        </div>
        <div
          className={`whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm ${
            isMine
              ? 'bg-blue-600 text-white'
              : 'bg-gray-100 text-gray-900'
          }`}
        >
          {m.body}
        </div>
      </div>
    </div>
  );
}
