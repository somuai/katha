import React, { useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";

type Item = {
  id: string;
  title?: string;
  name?: string;
  filename?: string;
  createdAt?: string;
  deletedAt?: string | null;
  status?: string;
  [key: string]: any;
};
type Message = Item & {
  role: string;
  content?: string;
  text?: string;
  answer?: string;
  sourceIds?: string[];
  sources?: Item[];
};
const date = (value: any) =>
  value
    ? new Date(value).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      })
    : "";
async function api(path: string, init: RequestInit = {}) {
  const response = await fetch(path, {
    ...init,
    headers:
      init.body instanceof FormData
        ? init.headers
        : { "Content-Type": "application/json", ...init.headers },
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(
      data.error?.message ||
        data.error ||
        data.message ||
        "The request could not finish.",
    );
  return data;
}
const Icon = ({ name }: { name: string }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {name === "plus" ? (
      <path d="M12 4v16M4 12h16" />
    ) : name === "send" ? (
      <path d="M12 19V5m-6 6 6-6 6 6" />
    ) : name === "clip" ? (
      <path d="m9 13 6-6a3 3 0 0 1 4 4l-8 8a5 5 0 0 1-7-7l8-8" />
    ) : name === "mic" ? (
      <>
        <rect x="9" y="3" width="6" height="12" rx="3" />
        <path d="M6 11v2a6 6 0 0 0 12 0v-2M12 19v3m-3 0h6" />
      </>
    ) : name === "menu" ? (
      <path d="M4 6h16M4 12h16M4 18h16" />
    ) : name === "search" ? (
      <>
        <circle cx="10" cy="10" r="6" />
        <path d="m15 15 5 5" />
      </>
    ) : name === "trash" ? (
      <>
        <path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7" />
      </>
    ) : name === "close" ? (
      <path d="m6 6 12 12M6 18 18 6" />
    ) : name === "file" ? (
      <>
        <path d="M5 2h9l5 5v15H5zM14 2v6h5M8 12h8M8 16h6" />
      </>
    ) : (
      <>
        <path d="M4 5h16v12H8l-4 4z" />
      </>
    )}
  </svg>
);

export default function App() {
  const [conversations, setConversations] = useState<Item[]>([]),
    [sources, setSources] = useState<Item[]>([]),
    [configured, setConfigured] = useState<any>({}),
    [chat, setChat] = useState<Item | null>(null),
    [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState(""),
    [attachments, setAttachments] = useState<Item[]>([]),
    [search, setSearch] = useState(""),
    [tab, setTab] = useState("chats"),
    [drawer, setDrawer] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [uploading, setUploading] = useState(false),
    [scope, setScope] = useState("workspace"),
    [sourceDate, setSourceDate] = useState("");
  const [turn, setTurn] = useState<string | null>(null),
    [status, setStatus] = useState(""),
    [stream, setStream] = useState(""),
    [evidence, setEvidence] = useState<Item[]>([]),
    [inspection, setInspection] = useState<any>(null),
    [audit, setAudit] = useState<any>(null),
    [showAudit, setShowAudit] = useState(false),
    [recording, setRecording] = useState(false),
    [transcribing, setTranscribing] = useState(false),
    [jump, setJump] = useState(false);
  const lastSubmitted = useRef(""),
    requestDraft = useRef<{
      fingerprint: string;
      requestId: string;
      expectedTailId: string | null;
    } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null),
    field = useRef<HTMLTextAreaElement>(null),
    log = useRef<HTMLDivElement>(null),
    events = useRef<EventSource | null>(null),
    recorder = useRef<MediaRecorder | null>(null),
    media = useRef<MediaStream | null>(null),
    recordTimer = useRef<any>(null),
    abortRecording = useRef(false),
    mobileClose = useRef<HTMLButtonElement>(null);
  const hasConversation = messages.length > 0 || !!turn;
  async function refresh() {
    try {
      const data = await api("/api/workspace");
      setConversations(data.conversations || data.chats || []);
      setSources(data.sources || []);
      setConfigured(data.configured || data.configuration || {});
    } catch (e: any) {
      setError(e.message);
    }
  }
  useEffect(() => {
    refresh();
    return () => {
      events.current?.close();
      abortRecording.current = true;
      clearTimeout(recordTimer.current);
      recorder.current?.state === "recording" && recorder.current.stop();
      media.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);
  useEffect(() => {
    if (!jump)
      log.current?.scrollTo({
        top: log.current.scrollHeight,
        behavior: "instant" as ScrollBehavior,
      });
  }, [messages, stream, status]);
  useEffect(() => {
    if (drawer) mobileClose.current?.focus();
  }, [drawer]);
  function newChat() {
    if (busy) return;
    setChat(null);
    setMessages([]);
    setEvidence([]);
    setStream("");
    setDraft("");
    setAudit(null);
    setDrawer(false);
    setError("");
    setTimeout(() => field.current?.focus(), 0);
  }
  async function openChat(c: Item) {
    if (busy) return;
    try {
      const data = await api("/api/conversations/" + c.id);
      setChat(data.conversation || c);
      setMessages(data.messages || []);
      setEvidence([]);
      setAudit(null);
      setDrawer(false);
      setError("");
      setJump(false);
    } catch (e: any) {
      setError(e.message);
    }
  }
  async function inspect(id: string) {
    try {
      setInspection(await api("/api/sources/" + id));
    } catch (e: any) {
      setError(e.message);
    }
  }
  async function sourceAction(id: string, action: string) {
    try {
      await api(
        "/api/sources/" + id + (action === "permanent" ? "" : "/" + action),
        { method: action === "permanent" ? "DELETE" : "POST" },
      );
      setInspection(null);
      await refresh();
    } catch (e: any) {
      setError(e.message);
    }
  }
  async function finish(id: string) {
    events.current?.close();
    events.current = null;
    try {
      const result = await api("/api/turns/" + id);
      setAudit(
        result.audit || result.verification || { ...result.trace, ...result },
      );
      if (result.sources) setEvidence(result.sources);
      if (chat) {
        const data = await api("/api/conversations/" + chat.id);
        setMessages(data.messages || []);
        setChat(data.conversation || chat);
      } else if (result.conversationId) {
        const data = await api("/api/conversations/" + result.conversationId);
        setMessages(data.messages || []);
        setChat(data.conversation);
      }
      if (result.error)
        setError(
          typeof result.error === "string"
            ? result.error
            : result.error.message,
        );
    } catch (e: any) {
      setError(e.message);
    }
    setTurn(null);
    setBusy(false);
    setStream("");
    setStatus("");
    refresh();
  }
  function watch(id: string, conversation: Item) {
    events.current?.close();
    const connection = new EventSource("/api/turns/" + id + "/events");
    events.current = connection;
    const handle = (raw: MessageEvent) => {
      if (typeof raw.data !== "string") return;
      try {
        const data = JSON.parse(raw.data),
          kind = data.type || data.kind || raw.type,
          payload = data.data || data;
        if (kind === "snapshot") {
          setStream(payload.answer || payload.text || "");
          setStatus(payload.status || "");
          if (payload.sources) setEvidence(payload.sources);
          if (
            [
              "COMPLETED",
              "PARTIAL",
              "FAILED",
              "CANCELLED",
              "INTERRUPTED",
              "completed",
              "partial",
              "failed",
              "cancelled",
            ].includes(payload.status)
          ) {
            finishTurn();
          }
        } else if (["delta", "answer", "answer_delta"].includes(kind)) {
          setStream((prev) =>
            kind === "delta" || kind === "answer_delta"
              ? prev + (payload.delta || payload.text || "")
              : (payload.answer ?? payload.text ?? prev),
          );
        } else if (["status", "progress"].includes(kind)) {
          setStatus(
            payload.status || payload.label || payload.message || "Working",
          );
        } else if (kind === "sources" || kind === "evidence") {
          setEvidence(payload.sources || payload.evidence || []);
        } else if (kind === "verification" || kind === "audit") {
          setAudit(payload.verification || payload.audit || payload);
        } else if (
          [
            "done",
            "complete",
            "completed",
            "error",
            "cancelled",
            "terminal",
          ].includes(kind)
        ) {
          if (payload.error)
            setError(
              typeof payload.error === "string"
                ? payload.error
                : payload.error.message,
            );
          finishTurn();
        }
      } catch {
        setError(
          "A response update could not be read. Your conversation is saved.",
        );
      }
    };
    let ending = false;
    async function finishTurn() {
      if (ending) return;
      ending = true;
      connection.close();
      try {
        const result = await api("/api/turns/" + id);
        setAudit(
          result.audit || result.verification || { ...result.trace, ...result },
        );
        setEvidence(result.sources || []);
        const data = await api("/api/conversations/" + conversation.id);
        setMessages(data.messages || []);
        setChat(data.conversation || conversation);
        if (result.error)
          setError(
            typeof result.error === "string"
              ? result.error
              : result.error.message,
          );
      } catch (e: any) {
        setError(e.message);
      }
      setTurn(null);
      setBusy(false);
      setStream("");
      setStatus("");
      refresh();
    }
    connection.onmessage = handle;
    for (const type of [
      "snapshot",
      "delta",
      "answer",
      "answer_delta",
      "status",
      "progress",
      "sources",
      "evidence",
      "verification",
      "audit",
      "done",
      "complete",
      "completed",
      "error",
      "cancelled",
      "terminal",
    ])
      connection.addEventListener(type, handle as EventListener);
    connection.onerror = () => {
      if (!ending) setStatus("Reconnecting to your saved answer…");
    };
  }
  async function send(event?: React.FormEvent) {
    event?.preventDefault();
    if (busy || uploading || (!draft.trim() && !attachments.length)) return;
    setError("");
    setBusy(true);
    setStream("");
    setAudit(null);
    setEvidence([]);
    setJump(false);
    let current = chat;
    try {
      if (!current) {
        const data = await api("/api/conversations", {
          method: "POST",
          body: JSON.stringify({
            title: draft.trim().slice(0, 65) || "A new conversation",
          }),
        });
        current = data.conversation || data;
        setChat(current);
      }
      const text = draft.trim(),
        used = attachments;
      lastSubmitted.current = text;
      const fingerprint = JSON.stringify([
        current!.id,
        text,
        used.map((a) => a.id),
        scope,
      ]);
      if (requestDraft.current?.fingerprint !== fingerprint)
        requestDraft.current = {
          fingerprint,
          requestId: crypto.randomUUID(),
          expectedTailId: current!.tailId ?? null,
        };
      setMessages((old) => [
        ...old,
        {
          id: "pending-" + Date.now(),
          role: "user",
          content: text,
          attachments: used,
        },
      ]);
      const response = await api(
        "/api/conversations/" + current!.id + "/turns",
        {
          method: "POST",
          body: JSON.stringify({
            clientRequestId: requestDraft.current!.requestId,
            expectedTailId: requestDraft.current!.expectedTailId,
            text,
            sourceIds: used.map((a) => a.id),
            attachmentIds: used.map((a) => a.id),
            memoryScope: scope,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          }),
        },
      );
      requestDraft.current = null;
      setDraft("");
      setAttachments([]);
      setTurn(response.turnId || response.id);
      setStatus("Finding the thread…");
      watch(response.turnId || response.id, current!);
      refresh();
    } catch (e: any) {
      setBusy(false);
      setError(e.message);
      if (current) {
        try {
          const saved = await api("/api/conversations/" + current.id);
          setMessages(saved.messages || []);
          setChat(saved.conversation || current);
        } catch {}
      }
    }
  }
  async function upload(files: FileList | File[] | null) {
    if (!files?.length) return;
    setUploading(true);
    setError("");
    try {
      const added: Item[] = [];
      for (const file of Array.from(files)) {
        if (attachments.length + added.length >= 5)
          throw new Error("Attach up to five files per message.");
        const body = new FormData();
        body.append("file", file);
        if (sourceDate) body.append("occurredAt", sourceDate);
        const data = await api("/api/sources", { method: "POST", body });
        const source = data.source || data;
        added.push({ ...source, name: source.name || file.name });
      }
      setAttachments((old) => [...old, ...added]);
      refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }
  async function record() {
    if (recording) {
      recorder.current?.stop();
      return;
    }
    setError("");
    if (
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      setError(
        "Recording is unavailable here. You can upload an audio file or type.",
      );
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      media.current = stream;
      abortRecording.current = false;
      const chunks: BlobPart[] = [];
      const mime = ["audio/webm", "audio/mp4"].find((t) =>
        MediaRecorder.isTypeSupported(t),
      );
      const rec = new MediaRecorder(
        stream,
        mime ? { mimeType: mime } : undefined,
      );
      recorder.current = rec;
      rec.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data);
      };
      rec.onstop = async () => {
        clearTimeout(recordTimer.current);
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        if (abortRecording.current) return;
        setTranscribing(true);
        try {
          const ext = rec.mimeType.includes("mp4") ? "m4a" : "webm";
          const file = new File(chunks, "Voice note." + ext, {
            type: rec.mimeType,
          });
          const body = new FormData();
          body.append("file", file);
          const data = await api("/api/sources", { method: "POST", body });
          const source = data.source || data;
          const text = source.text || source.content || data.transcript;
          if (text) setDraft((prev) => [prev, text].filter(Boolean).join("\n"));
          else
            setAttachments((old) => [
              ...old,
              { ...source, name: "Voice note" },
            ]);
          refresh();
        } catch (e: any) {
          setError(e.message);
        }
        setTranscribing(false);
      };
      rec.start();
      setRecording(true);
      recordTimer.current = setTimeout(
        () => rec.state === "recording" && rec.stop(),
        60000,
      );
    } catch (e: any) {
      setError(
        e.name === "NotAllowedError"
          ? "Microphone permission was denied. You can type or attach an audio file."
          : e.message,
      );
    }
  }
  const shownConversations = conversations.filter(
    (c) =>
      !c.deletedAt &&
      (c.title || "").toLowerCase().includes(search.toLowerCase()),
  );
  const visibleSources = sources.filter((s) =>
    tab === "trash" ? !!s.deletedAt : !s.deletedAt,
  );
  const statusText = status.replace(/_/g, " ").toLowerCase();
  return (
    <div
      className={
        "app " +
        (hasConversation ? "in-chat" : "") +
        (drawer ? " drawer-open" : "")
      }
    >
      <div className="mat" aria-hidden="true" />
      {drawer && (
        <button
          className="drawer-scrim"
          aria-label="Close history"
          onClick={() => setDrawer(false)}
        />
      )}
      <aside
        className="sidebar"
        aria-label="Conversation history"
        onKeyDown={(e) => {
          if (e.key === "Escape") setDrawer(false);
          if (drawer && e.key === "Tab") {
            const nodes = Array.from(
              e.currentTarget.querySelectorAll<HTMLElement>("button,input,a"),
            ).filter((n) => !n.hasAttribute("disabled"));
            if (e.shiftKey && document.activeElement === nodes[0]) {
              e.preventDefault();
              nodes.at(-1)?.focus();
            } else if (!e.shiftKey && document.activeElement === nodes.at(-1)) {
              e.preventDefault();
              nodes[0]?.focus();
            }
          }
        }}
      >
        <div className="brand-row">
          <button className="brand" onClick={newChat}>
            Katha
          </button>
          <button
            ref={mobileClose}
            className="icon mobile-only"
            aria-label="Close history"
            onClick={() => setDrawer(false)}
          >
            <Icon name="close" />
          </button>
        </div>

        <button className="new-chat" onClick={newChat} disabled={busy}>
          <Icon name="plus" />
          New chat
        </button>
        <label className="history-search">
          <Icon name="search" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Find a conversation"
            aria-label="Find a conversation"
          />
        </label>
        <div className="side-tabs">
          <button
            className={tab === "chats" ? "selected" : ""}
            onClick={() => setTab("chats")}
          >
            Conversations
          </button>
          <button
            className={tab === "files" ? "selected" : ""}
            onClick={() => setTab("files")}
          >
            Files
          </button>
        </div>
        <div className="history-list">
          {tab === "chats" ? (
            <>
              {!shownConversations.length && (
                <p className="empty-history">
                  Your conversations will live here.
                </p>
              )}
              {shownConversations.map((c) => (
                <button
                  key={c.id}
                  className={
                    "history-item " + (chat?.id === c.id ? "active" : "")
                  }
                  onClick={() => openChat(c)}
                  disabled={busy}
                >
                  <span>{c.title || "Untitled conversation"}</span>
                  <small>{date(c.createdAt)}</small>
                </button>
              ))}
            </>
          ) : (
            <>
              {tab === "trash" && (
                <h3 className="side-heading">Deleted files</h3>
              )}
              {!visibleSources.length && (
                <p className="empty-history">
                  {tab === "trash"
                    ? "Nothing in the trash."
                    : "Files you share will appear here."}
                </p>
              )}
              {visibleSources.map((s) => (
                <div className="source-list-item" key={s.id}>
                  <button onClick={() => inspect(s.id)}>
                    <Icon name="file" />
                    <span>
                      {s.name || s.filename || s.title || "Source"}
                      <small>{s.status || s.kind || "File"}</small>
                    </span>
                  </button>
                  {tab === "trash" ? (
                    <button
                      className="tiny-link"
                      onClick={() => sourceAction(s.id, "restore")}
                    >
                      Restore
                    </button>
                  ) : (
                    <button
                      className="icon small"
                      aria-label={"Delete " + (s.name || "file")}
                      onClick={() => sourceAction(s.id, "trash")}
                    >
                      <Icon name="trash" />
                    </button>
                  )}
                </div>
              ))}
            </>
          )}
        </div>
        <div className="side-footer">
          <button
            className={tab === "trash" ? "selected" : ""}
            onClick={() => setTab("trash")}
          >
            <Icon name="trash" />
            Deleted files
          </button>
          <div className="local-label">
            <i />
            Saved on this device
          </div>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <button
            className="icon mobile-only"
            aria-label="Open history"
            onClick={() => setDrawer(true)}
          >
            <Icon name="menu" />
          </button>
          <span>
            {hasConversation ? chat?.title || "A new conversation" : ""}
          </span>
        </header>
        <section
          className="conversation-stage"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            upload(e.dataTransfer.files);
          }}
        >
          {!hasConversation && (
            <div className="welcome">
              <h1 aria-label="Ask Katha" tabIndex={0}>
                {Array.from("Ask Katha").map((letter, i) => (
                  <span
                    key={i}
                    aria-hidden="true"
                    style={{ "--letter": i } as React.CSSProperties}
                  >
                    {letter === " " ? "\u00a0" : letter}
                  </span>
                ))}
              </h1>
              <p>Ask a question. Pick up where you left off.</p>
              {(configured.model === false || configured.search === false) && (
                <div className="setup-note">
                  {configured.model === false
                    ? "Add GROQ_API_KEY to enable answers. "
                    : ""}
                  {configured.search === false
                    ? "Add TAVILY_API_KEY to enable web search."
                    : ""}{" "}
                  Your saved history stays available.
                </div>
              )}
            </div>
          )}
          {hasConversation && (
            <div
              className="message-log"
              role="log"
              aria-label="Conversation"
              ref={log}
              onScroll={() => {
                const l = log.current;
                if (l)
                  setJump(l.scrollHeight - l.scrollTop - l.clientHeight > 120);
              }}
            >
              <div className="messages-inner">
                {messages.map((m) => (
                  <article className={"message message--" + m.role} key={m.id}>
                    <div className="message-label">
                      {m.role === "user" ? "YOU" : "KATHA"}
                      {m.createdAt && (
                        <time>
                          {new Date(m.createdAt).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </time>
                      )}
                    </div>
                    <div className="message-content">
                      <Markdown>
                        {m.content || m.text || m.answer || ""}
                      </Markdown>
                    </div>
                    {m.attachments?.length > 0 && (
                      <div className="attached-files">
                        {m.attachments.map((a: Item) => (
                          <button key={a.id} onClick={() => inspect(a.id)}>
                            <Icon name="file" />
                            {a.name || a.filename || "Attachment"}
                          </button>
                        ))}
                      </div>
                    )}
                    {m.sources?.length ? (
                      <div className="citations">
                        {m.sources.map((s: Item, i: number) => (
                          <button
                            key={s.id || i}
                            onClick={() =>
                              s.id ? inspect(s.id) : setInspection(s)
                            }
                          >
                            {i + 1}. {s.title || s.name || s.url || "Source"}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </article>
                ))}
                {turn && (
                  <article className="message message--assistant">
                    <div className="message-label">
                      KATHA <span className="live-dot" />
                    </div>
                    {stream ? (
                      <div className="message-content">
                        <Markdown>{stream}</Markdown>
                      </div>
                    ) : (
                      <div className="working">
                        <span />
                        <span />
                        <span />
                      </div>
                    )}
                    <p className="progress" role="status">
                      {statusText || "Picking up the thread…"}
                    </p>
                  </article>
                )}
                {evidence.length > 0 && (
                  <div className="citations">
                    {evidence.map((s, i) => (
                      <button
                        key={s.id || i}
                        onClick={() =>
                          s.id ? inspect(s.id) : setInspection(s)
                        }
                      >
                        {i + 1}. {s.title || s.name || s.url || "Source"}
                      </button>
                    ))}
                  </div>
                )}
                {audit?.comparisons?.length > 0 && (
                  <div className="comparison-list">
                    {audit.comparisons.map((c: any, i: number) => (
                      <section key={i}>
                        <span>
                          {String(c.status || "UNVERIFIED")
                            .replace(/_/g, " ")
                            .toLowerCase()}
                        </span>
                        <h3>{c.claim}</h3>
                        <p>{c.explanation}</p>
                      </section>
                    ))}
                  </div>
                )}
                {audit && (
                  <button
                    className="audit-trigger"
                    onClick={() => setShowAudit(true)}
                  >
                    Why this answer? <span>↗</span>
                  </button>
                )}
                <div className="log-bottom" />
              </div>
            </div>
          )}
          {jump && hasConversation && (
            <button
              className="jump"
              onClick={() => {
                setJump(false);
                log.current?.scrollTo({
                  top: log.current.scrollHeight,
                  behavior: "smooth",
                });
              }}
            >
              Jump to latest ↓
            </button>
          )}
          <div className="composer-wrap">
            <form className="composer" onSubmit={send}>
              {attachments.length > 0 && (
                <div className="file-chips">
                  {attachments.map((a) => (
                    <span key={a.id}>
                      <Icon name="file" />
                      {a.name || a.filename || "Attachment"}
                      <button
                        type="button"
                        onClick={() =>
                          setAttachments((old) =>
                            old.filter((x) => x.id !== a.id),
                          )
                        }
                        aria-label={"Remove " + a.name}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <textarea
                ref={field}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (
                    e.key === "Enter" &&
                    !e.shiftKey &&
                    !e.nativeEvent.isComposing
                  ) {
                    e.preventDefault();
                    send();
                  }
                }}
                placeholder={
                  hasConversation
                    ? "Follow the thread…"
                    : "Ask anything. Or pick up where you left off…"
                }
                aria-label="Message Katha"
                rows={hasConversation ? 2 : 3}
                disabled={recording}
              />
              <div className="composer-tools">
                <div className="composer-left">
                  <input
                    ref={fileInput}
                    type="file"
                    multiple
                    hidden
                    accept=".txt,.md,.csv,.json,.pdf,image/png,image/jpeg,image/webp,audio/*"
                    onChange={(e) => upload(e.target.files)}
                  />
                  <button
                    type="button"
                    className="icon"
                    aria-label="Attach files or images"
                    title="Attach files or images"
                    onClick={() => fileInput.current?.click()}
                    disabled={uploading || busy}
                  >
                    <Icon name="clip" />
                  </button>
                  <button
                    type="button"
                    className={"icon " + (recording ? "recording" : "")}
                    aria-label={
                      recording
                        ? "Stop recording and transcribe"
                        : "Record voice — sent to Groq for transcription"
                    }
                    title="Voice is transcribed by Groq. Review before sending."
                    onClick={record}
                    disabled={transcribing || busy}
                  >
                    <Icon name="mic" />
                  </button>
                  <label className="scope-select">
                    <select
                      value={scope}
                      onChange={(e) => setScope(e.target.value)}
                      aria-label="Memory scope"
                    >
                      <option value="workspace">All conversations</option>
                      <option value="conversation">This chat only</option>
                    </select>
                    <span>⌄</span>
                  </label>
                </div>
                {turn ? (
                  <button
                    type="button"
                    className="stop-button"
                    onClick={() =>
                      api("/api/turns/" + turn + "/cancel", {
                        method: "POST",
                      }).catch((e) => setError(e.message))
                    }
                  >
                    <i />
                    Stop
                  </button>
                ) : (
                  <button
                    type="submit"
                    className="send-button"
                    aria-label="Send message"
                    disabled={
                      busy ||
                      uploading ||
                      recording ||
                      transcribing ||
                      (!draft.trim() && !attachments.length)
                    }
                  >
                    <Icon name="send" />
                  </button>
                )}
              </div>
              {(uploading || transcribing || recording) && (
                <div className="input-status" role="status">
                  {recording
                    ? "Recording · up to 60 seconds. Tap the microphone to stop."
                    : transcribing
                      ? "Transcribing your voice… Review the text before sending."
                      : "Preparing your files…"}
                </div>
              )}
              {error && (
                <div className="error" role="alert">
                  <span>
                    {error}
                    {lastSubmitted.current && !busy && (
                      <button
                        type="button"
                        className="retry-draft"
                        onClick={() => {
                          setDraft(lastSubmitted.current);
                          setError("");
                          field.current?.focus();
                        }}
                      >
                        Edit & retry ↗
                      </button>
                    )}
                  </span>
                  <button
                    type="button"
                    aria-label="Dismiss error"
                    onClick={() => setError("")}
                  >
                    ×
                  </button>
                </div>
              )}
            </form>
            <div className="composer-note">
              <span>
                {hasConversation
                  ? "Katha can be wrong. Follow the sources."
                  : ""}
              </span>
              <button
                onClick={() =>
                  setInspection({
                    title: "Your files & privacy",
                    text: "Chats and files are saved on this device. Selected content is sent to the configured model provider to answer questions. Voice recordings are sent to Groq for transcription. Web search sends queries to Tavily. Deleted files are excluded from future recall; previous answers may still contain quoted material.",
                  })
                }
              >
                Privacy & sources
              </button>
            </div>
            {
              <label className="event-date">
                Attachment date{" "}
                <input
                  type="date"
                  value={sourceDate}
                  onChange={(e) => setSourceDate(e.target.value)}
                />{" "}
                <span>Optional · set before adding a file.</span>
              </label>
            }
          </div>
          {!hasConversation && (
            <div className="suggestions">
              {[
                "What did we decide last time?",
                "Is that still true today?",
                "Help me think this through.",
              ].map((text) => (
                <button
                  key={text}
                  onClick={() => {
                    setDraft(text);
                    field.current?.focus();
                  }}
                >
                  {text}
                </button>
              ))}
            </div>
          )}
        </section>
      </main>
      {(inspection || showAudit) && (
        <div
          className="inspector-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setInspection(null);
              setShowAudit(false);
            }
          }}
        >
          <section
            className="inspector"
            role="dialog"
            aria-modal="true"
            aria-labelledby="inspector-title"
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setInspection(null);
                setShowAudit(false);
              }
              if (e.key === "Tab") {
                const items = Array.from(
                  e.currentTarget.querySelectorAll<HTMLElement>(
                    "button,a,input",
                  ),
                );
                if (e.shiftKey && document.activeElement === items[0]) {
                  e.preventDefault();
                  items.at(-1)?.focus();
                } else if (
                  !e.shiftKey &&
                  document.activeElement === items.at(-1)
                ) {
                  e.preventDefault();
                  items[0]?.focus();
                }
              }
            }}
          >
            <button
              className="icon inspector-close"
              aria-label="Close source inspector"
              onClick={() => {
                setInspection(null);
                setShowAudit(false);
              }}
              autoFocus
            >
              <Icon name="close" />
            </button>
            <p className="inspector-eyebrow">
              {showAudit ? "THE THREAD BEHIND THE ANSWER" : "EVIDENCE LIBRARY"}
            </p>
            <h2 id="inspector-title">
              {showAudit
                ? "Why this answer?"
                : inspection?.title ||
                  inspection?.name ||
                  inspection?.filename ||
                  "Source"}
            </h2>
            {showAudit ? (
              <Audit data={audit} />
            ) : (
              <>
                <dl>
                  {[
                    ["Source date", inspection?.occurredAt],
                    ["Added", inspection?.recordedAt || inspection?.createdAt],
                    ["Status", inspection?.status],
                    ["Method", inspection?.extractionMethod],
                  ]
                    .filter((x) => x[1])
                    .map(([label, value]) => (
                      <div key={label}>
                        <dt>{label}</dt>
                        <dd>{String(value)}</dd>
                      </div>
                    ))}
                </dl>
                {inspection?.url && /^https?:\/\//.test(inspection.url) && (
                  <a href={inspection.url} target="_blank" rel="noreferrer">
                    Open original source ↗
                  </a>
                )}
                <div className="source-content">
                  <Markdown>
                    {inspection?.text ||
                      inspection?.content ||
                      inspection?.excerpt ||
                      inspection?.error ||
                      "This source has no extracted text yet."}
                  </Markdown>
                </div>
                {inspection?.id && (
                  <div className="inspector-actions">
                    {inspection.deletedAt ? (
                      <>
                        <button
                          onClick={() => sourceAction(inspection.id, "restore")}
                        >
                          Restore file
                        </button>
                        <button
                          onClick={() => {
                            if (
                              confirm(
                                "Permanently delete this file and its indexes? Earlier answers may contain quotations.",
                              )
                            )
                              sourceAction(inspection.id, "permanent");
                          }}
                        >
                          Delete permanently
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => sourceAction(inspection.id, "trash")}
                      >
                        Move to deleted files
                      </button>
                    )}
                  </div>
                )}
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
function Audit({ data }: { data: any }) {
  if (!data) return <p>No audit record is available.</p>;
  return (
    <div className="audit">
      {data.resolvedWindow && (
        <section>
          <h3>Time interpreted</h3>
          <p>
            {typeof data.resolvedWindow === "string"
              ? data.resolvedWindow
              : JSON.stringify(data.resolvedWindow)}
          </p>
        </section>
      )}
      {data.status && (
        <section>
          <h3>Result</h3>
          <p>{data.status}</p>
        </section>
      )}
      {(data.queries || data.searches)?.length > 0 && (
        <section>
          <h3>Searches</h3>
          <ul>
            {(data.queries || data.searches).map((q: any, i: number) => (
              <li key={i}>{typeof q === "string" ? q : q.query}</li>
            ))}
          </ul>
        </section>
      )}
      {(data.sources || data.baselineSourceIds)?.length > 0 && (
        <section>
          <h3>Evidence used</h3>
          <p>
            {(data.sources || data.baselineSourceIds).length} sources selected.
          </p>
        </section>
      )}
      {data.coverage && (
        <section>
          <h3>Coverage</h3>
          <p>
            {typeof data.coverage === "string"
              ? data.coverage
              : JSON.stringify(data.coverage)}
          </p>
        </section>
      )}
      <p className="audit-foot">
        A record of selected evidence and execution. This does not expose
        private model reasoning.
      </p>
    </div>
  );
}
