import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  History,
  LifeBuoy,
  MessageSquarePlus,
  RotateCcw,
  SendHorizontal,
  ShieldAlert,
  Sparkles,
  Trash2,
  WifiOff,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { isApiError } from '@/api/client';
import { mindChatApi, type ChatMessage, type MindChatStatus } from '@/api/mindChat';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useSession } from '@/features/auth/sessionStore';
import { useMissionState } from '@/features/shell/useMissionState';
import { prefersReducedMotion } from '@/lib/capabilities';
import { cn } from '@/lib/utils';

interface Pending {
  clientId: string;
  content: string;
  state: 'sending' | 'not_sent';
  error: string | null;
}

const newClientId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

const timeOf = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

function errorMessage(error: unknown): string {
  if (isApiError(error)) {
    const body = error.body as { detail?: unknown } | undefined;
    if (body && typeof body.detail === 'string') return body.detail;
    if (error.kind === 'network') {
      return 'The Mind Companion service could not be reached. Your message was not sent.';
    }
    return error.message;
  }
  return error instanceof Error ? error.message : 'Something went wrong.';
}

function CompanionAvatar({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-cyan-400/40 to-violet-500/40 ring-1 ring-cyan-300/40',
        className,
      )}
    >
      <span className="absolute inset-1 rounded-full bg-navy-950/70" />
      <Sparkles className="relative h-4 w-4 text-cyan-200" />
    </span>
  );
}

function ServiceBanner({ status, error }: { status: MindChatStatus | undefined; error: unknown }) {
  if (error) {
    return (
      <p
        role="alert"
        className="flex items-start gap-2 rounded-lg border border-status-review/40 bg-status-review-bg px-3 py-2 text-sm text-ink"
        data-testid="mind-unavailable"
      >
        <WifiOff className="mt-0.5 h-4 w-4 shrink-0 text-status-review" aria-hidden="true" />
        <span>
          Mind Companion is unavailable: {errorMessage(error)} No AI replies can be generated until
          the onboard service is reachable.
        </span>
      </p>
    );
  }
  if (status && !status.model_configured) {
    return (
      <p
        role="alert"
        className="flex items-start gap-2 rounded-lg border border-status-review/40 bg-status-review-bg px-3 py-2 text-sm text-ink"
        data-testid="mind-not-configured"
      >
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-status-review" aria-hidden="true" />
        <span>
          The Mind Companion service is running, but no language model is configured on it, so
          messages cannot be answered.
        </span>
      </p>
    );
  }
  return null;
}

/**
 * AEGIS Mind Companion: AI psychological-support chat, connected to the Mind
 * Companion service and its Gemma model. Conversations belong to the signed-in
 * astronaut only; they are not shared with the Medical Officer and do not affect
 * the readiness estimate.
 */
export function MindCompanion() {
  const astronautId = useSession((s) => s.astronautId);
  const demo = useSession((s) => s.mode === 'demo');
  const missionDay = useMissionState().data?.mission_day;
  const queryClient = useQueryClient();
  const base = ['mind-chat', astronautId] as const;

  const status = useQuery({
    queryKey: [...base, 'status'],
    queryFn: () => mindChatApi.status(),
    retry: false,
    staleTime: 30_000,
  });
  const available = status.isSuccess && status.data.model_configured;

  const conversations = useQuery({
    queryKey: [...base, 'conversations'],
    queryFn: () => mindChatApi.list(),
    enabled: !!astronautId && status.isSuccess,
    retry: false,
  });

  /** undefined = follow the latest conversation; null = a new, empty one. */
  const [chosen, setChosen] = useState<string | null | undefined>(undefined);
  const activeId =
    chosen === undefined ? (conversations.data?.[0]?.conversation_id ?? null) : chosen;

  const detail = useQuery({
    queryKey: [...base, 'conversation', activeId],
    queryFn: () => mindChatApi.get(activeId!),
    enabled: !!activeId && status.isSuccess,
    retry: false,
  });

  const [pending, setPending] = useState<Pending[]>([]);
  const [draft, setDraft] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const refresh = (conversationId: string | null) => {
    void queryClient.invalidateQueries({ queryKey: [...base, 'conversations'] });
    if (conversationId) {
      void queryClient.invalidateQueries({ queryKey: [...base, 'conversation', conversationId] });
    }
  };

  const send = useMutation({
    networkMode: 'always',
    mutationFn: async (p: { clientId: string; content: string }) => {
      let id = activeId;
      if (!id) {
        const created = await mindChatApi.create();
        id = created.conversation_id;
        setChosen(id);
      }
      try {
        return await mindChatApi.send(id, {
          content: p.content,
          client_message_id: p.clientId,
          mission_day: missionDay,
        });
      } finally {
        refresh(id);
      }
    },
    onMutate: (p) =>
      setPending((list) => [
        ...list.filter((x) => x.clientId !== p.clientId),
        { ...p, state: 'sending', error: null },
      ]),
    onSuccess: (_r, p) => setPending((list) => list.filter((x) => x.clientId !== p.clientId)),
    onError: (error, p) =>
      setPending((list) =>
        list.map((x) =>
          x.clientId === p.clientId ? { ...x, state: 'not_sent', error: errorMessage(error) } : x,
        ),
      ),
  });

  const remove = useMutation({
    mutationFn: (id: string) => mindChatApi.remove(id),
    onSuccess: () => {
      setChosen(null);
      setConfirmDelete(false);
      void queryClient.invalidateQueries({ queryKey: [...base, 'conversations'] });
    },
  });

  const messages = useMemo(() => detail.data?.messages ?? [], [detail.data]);
  // A pending message the server already stored is shown from the server copy.
  const stored = new Set(messages.map((m) => m.client_message_id).filter(Boolean));
  const localPending = pending.filter((p) => !stored.has(p.clientId) || p.state === 'sending');
  const failedServer = new Map(
    messages
      .filter((m) => m.role === 'user' && m.generation_status === 'failed')
      .map((m) => [m.message_id, m]),
  );

  useEffect(() => {
    endRef.current?.scrollIntoView?.({
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
      block: 'nearest',
    });
  }, [messages.length, localPending.length]);

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    const content = draft.trim();
    if (!content || send.isPending || !available) return;
    setDraft('');
    send.mutate({ clientId: newClientId(), content });
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };
  const retry = (clientId: string, content: string) => send.mutate({ clientId, content });

  const sendingNow = localPending.some((p) => p.state === 'sending');
  const list = conversations.data ?? [];

  return (
    <section
      aria-labelledby="mind-title"
      className="surface-glass relative overflow-hidden p-5 sm:p-6"
      data-testid="mind-companion"
    >
      <div
        className="pointer-events-none absolute -left-32 -top-32 h-72 w-72 rounded-full bg-cyan-500/10 blur-3xl"
        aria-hidden="true"
      />
      <header className="relative flex flex-wrap items-start gap-3">
        <CompanionAvatar className="h-11 w-11" />
        <div className="min-w-0 flex-1">
          <h2 id="mind-title" className="text-title">
            AEGIS Mind Companion
          </h2>
          <p className="text-sm text-ink-muted">
            Your AI companion for emotional well-being, stress management, and psychological support
            during space missions.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowHistory((v) => !v)}
            aria-expanded={showHistory}
            aria-controls="mind-history"
            disabled={!status.isSuccess}
          >
            <History aria-hidden="true" /> Conversations
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setChosen(null);
              setPending([]);
            }}
            disabled={!status.isSuccess}
          >
            <MessageSquarePlus aria-hidden="true" /> New
          </Button>
        </div>
      </header>

      <p className="relative mt-3 flex items-start gap-2 text-caption text-ink-subtle">
        <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>
          An AI support tool, not a therapist or clinician; it does not diagnose or replace
          professional care. Conversations are not shared with the Medical Officer and do not affect
          your readiness estimate.
          {demo &&
            ' Demo mode: conversations are stored on the demonstration server and are not confidential.'}
        </span>
      </p>

      <div className="relative mt-4 space-y-3">
        <ServiceBanner status={status.data} error={status.error} />

        {showHistory && (
          <div
            id="mind-history"
            className="rounded-lg border border-white/[0.06] bg-navy-900/70 p-2"
            role="region"
            aria-label="Earlier conversations"
          >
            {list.length === 0 ? (
              <p className="p-2 text-sm text-ink-muted">No earlier conversations.</p>
            ) : (
              <ul className="max-h-48 space-y-1 overflow-y-auto">
                {list.map((c) => (
                  <li key={c.conversation_id}>
                    <button
                      type="button"
                      onClick={() => {
                        setChosen(c.conversation_id);
                        setPending([]);
                        setShowHistory(false);
                      }}
                      aria-current={c.conversation_id === activeId || undefined}
                      className={cn(
                        'w-full rounded-md px-3 py-2 text-left text-sm transition-colors',
                        c.conversation_id === activeId
                          ? 'bg-accent-muted/50 text-ink'
                          : 'text-ink-muted hover:bg-navy-800',
                      )}
                    >
                      <span className="block truncate">{c.preview ?? 'Empty conversation'}</span>
                      <span className="text-caption text-ink-subtle">
                        {timeOf(c.updated_at)} · {c.message_count} messages
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div
          role="log"
          aria-live="polite"
          aria-label="Conversation"
          className="h-[26rem] space-y-4 overflow-y-auto rounded-xl border border-white/[0.06] bg-navy-950/60 p-4"
          data-testid="mind-log"
        >
          {!activeId && localPending.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
              <CompanionAvatar className="h-14 w-14" />
              <p className="max-w-sm text-sm text-ink-muted">
                Share what is on your mind: mission stress, sleep, homesickness, a tense moment with
                the crew, or how your day is going.
              </p>
            </div>
          ) : detail.isPending && activeId ? (
            <p role="status" className="text-sm text-ink-muted">
              Loading conversation…
            </p>
          ) : detail.isError ? (
            <p role="alert" className="text-sm text-status-action">
              {errorMessage(detail.error)}
            </p>
          ) : null}

          {messages.map((m) => (
            <MessageBubble
              key={m.message_id}
              message={m}
              notice={m.support_notice ? (status.data?.support_notice ?? null) : null}
              onRetry={
                failedServer.has(m.message_id) && m.client_message_id && available
                  ? () => retry(m.client_message_id!, m.content)
                  : undefined
              }
              retrying={pending.some(
                (p) => p.clientId === m.client_message_id && p.state === 'sending',
              )}
            />
          ))}

          {localPending
            .filter((p) => !stored.has(p.clientId))
            .map((p) => (
              <div
                key={p.clientId}
                className="flex flex-col items-end gap-1 motion-safe:animate-fade-up"
              >
                <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-accent/15 px-4 py-2.5 text-sm text-ink ring-1 ring-accent/30">
                  {p.content}
                </div>
                {p.state === 'sending' ? (
                  <span className="text-caption text-ink-subtle">Sending…</span>
                ) : (
                  <span className="flex flex-wrap items-center justify-end gap-2 text-caption text-status-review">
                    Not sent. {p.error}
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => retry(p.clientId, p.content)}
                    >
                      <RotateCcw aria-hidden="true" /> Retry
                    </Button>
                  </span>
                )}
              </div>
            ))}

          {sendingNow && (
            <div
              className="flex items-center gap-3"
              role="status"
              aria-label="Mind Companion is replying"
            >
              <CompanionAvatar />
              <span
                className="flex gap-1 rounded-2xl rounded-bl-md bg-navy-800 px-4 py-3"
                aria-hidden="true"
              >
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    className="h-1.5 w-1.5 rounded-full bg-cyan-200 motion-safe:animate-typing-dot"
                    style={{ animationDelay: `${i * 160}ms` }}
                  />
                ))}
              </span>
            </div>
          )}
          <div ref={endRef} />
        </div>

        <form onSubmit={submit} className="flex items-end gap-2" aria-label="Send a message">
          <label htmlFor="mind-input" className="sr-only">
            Message to Mind Companion
          </label>
          <textarea
            id="mind-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            rows={2}
            maxLength={4000}
            disabled={!available}
            placeholder={
              available
                ? 'Write a message… (Enter to send, Shift+Enter for a new line)'
                : 'Mind Companion is unavailable'
            }
            className="min-h-[3rem] flex-1 resize-y rounded-xl border bg-navy-950/70 px-3 py-2.5 text-sm text-ink placeholder:text-ink-subtle focus-visible:border-accent/60 disabled:opacity-60"
          />
          <Button
            type="submit"
            size="icon"
            className="h-11 w-11 rounded-xl"
            disabled={!available || !draft.trim() || send.isPending}
            aria-label="Send message"
          >
            <SendHorizontal aria-hidden="true" />
          </Button>
        </form>

        <div className="flex flex-wrap items-center justify-between gap-2 text-caption text-ink-subtle">
          <span className="inline-flex items-center gap-1.5">
            <LifeBuoy className="h-3.5 w-3.5" aria-hidden="true" />
            Feeling unsafe? Contact the flight surgeon or crew medical officer directly.
          </span>
          {activeId && (
            <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(true)}>
              <Trash2 aria-hidden="true" /> Delete conversation
            </Button>
          )}
        </div>
      </div>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this conversation?</DialogTitle>
            <DialogDescription>
              The conversation and all its messages are permanently removed from the mission server.
            </DialogDescription>
          </DialogHeader>
          {remove.isError && (
            <p role="alert" className="text-sm text-status-action">
              {errorMessage(remove.error)}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => activeId && remove.mutate(activeId)}
              disabled={remove.isPending}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function MessageBubble({
  message: m,
  notice,
  onRetry,
  retrying,
}: {
  message: ChatMessage;
  notice: string | null;
  onRetry?: () => void;
  retrying: boolean;
}) {
  if (m.role === 'user') {
    return (
      <div
        className="flex flex-col items-end gap-1 motion-safe:animate-fade-up"
        data-testid="msg-user"
      >
        <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-accent/15 px-4 py-2.5 text-sm text-ink ring-1 ring-accent/30">
          {m.content}
        </div>
        <span className="text-caption text-ink-subtle">
          You · <time dateTime={m.timestamp}>{timeOf(m.timestamp)}</time>
          {m.generation_status === 'failed' && !retrying && ' · No reply was generated'}
          {retrying && ' · Retrying…'}
        </span>
        {onRetry && !retrying && (
          <Button size="sm" variant="outline" onClick={onRetry}>
            <RotateCcw aria-hidden="true" /> Retry
          </Button>
        )}
        {notice && (
          <p
            role="note"
            className="max-w-[85%] rounded-lg border border-status-review/40 bg-status-review-bg px-3 py-2 text-caption text-ink"
            data-testid="support-notice"
          >
            <span className="font-medium text-status-review">AEGIS notice: </span>
            {notice}
          </p>
        )}
      </div>
    );
  }
  return (
    <div className="flex items-start gap-3 motion-safe:animate-fade-up" data-testid="msg-assistant">
      <CompanionAvatar />
      <div className="flex max-w-[85%] flex-col gap-1">
        {m.generation_status === 'withheld' ? (
          <div className="rounded-2xl rounded-tl-md border border-status-review/40 bg-status-review-bg px-4 py-2.5 text-sm text-ink">
            The model&apos;s reply was withheld by the AEGIS safety check. Try rephrasing, or
            contact crew medical support.
          </div>
        ) : (
          <div className="whitespace-pre-wrap rounded-2xl rounded-tl-md bg-navy-800/90 px-4 py-2.5 text-sm leading-relaxed text-ink ring-1 ring-white/[0.06]">
            {m.content}
          </div>
        )}
        <span className="text-caption text-ink-subtle">
          Mind Companion (AI{m.model_id ? ` · ${m.model_id}` : ''}) ·{' '}
          <time dateTime={m.timestamp}>{timeOf(m.timestamp)}</time>
        </span>
      </div>
    </div>
  );
}
