"use client";

import Link from "next/link";
import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from "react";

type Role = "user" | "assistant";

type ChatMessage = {
  role: Role;
  content: string;
};

type ChatPayload = {
  messages?: ChatMessage[];
  model?: string;
  error?: string;
};

const SESSION_KEY = "web-agent-session";
const SESSION_RE = /^web-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function createSessionId() {
  return `web-${crypto.randomUUID()}`;
}

export default function AgentChat() {
  const [sessionId, setSessionId] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [model, setModel] = useState("");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const threadRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const stored = localStorage.getItem(SESSION_KEY);
    const id = stored && SESSION_RE.test(stored) ? stored : createSessionId();
    if (id !== stored) localStorage.setItem(SESSION_KEY, id);
    setSessionId(id);

    fetch(`/api/chat?sessionId=${encodeURIComponent(id)}`)
      .then(async (res) => {
        const data = (await res.json()) as ChatPayload;
        if (!res.ok) throw new Error(data.error || "Не удалось загрузить диалог");
        setMessages(data.messages ?? []);
        setModel(data.model ?? "");
      })
      .catch((loadError: Error) => {
        setError(loadError.message);
      })
      .finally(() => {
        setReady(true);
      });
  }, []);

  useEffect(() => {
    const thread = threadRef.current;
    if (!thread) return;
    thread.scrollTop = thread.scrollHeight;
  }, [messages, sending, error]);

  useEffect(() => {
    if (ready) inputRef.current?.focus();
  }, [ready]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || !sessionId || sending) return;

    setDraft("");
    setError("");
    setMessages((current) => [...current, { role: "user", content: text }]);
    setSending(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, text }),
      });
      const data = (await res.json()) as ChatPayload;
      if (!res.ok) throw new Error(data.error || "Не удалось ответить");
      setMessages(data.messages ?? []);
      if (data.model) setModel(data.model);
    } catch (sendError) {
      setMessages((current) => current.slice(0, -1));
      setDraft(text);
      setError(sendError instanceof Error ? sendError.message : "Не удалось ответить");
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  }

  async function clearChat() {
    if (!sessionId || sending || clearing) return;
    setClearing(true);
    setError("");
    try {
      const res = await fetch("/api/chat", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
      const data = (await res.json()) as ChatPayload;
      if (!res.ok) throw new Error(data.error || "Не удалось очистить диалог");
      setMessages([]);
      if (data.model) setModel(data.model);
    } catch (clearError) {
      setError(clearError instanceof Error ? clearError.message : "Не удалось очистить диалог");
    } finally {
      setClearing(false);
      inputRef.current?.focus();
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  return (
    <div className="chat">
      <header className="chat-bar">
        <div className="chat-title">
          <strong>ИИ-агент</strong>
          {model ? <span className="chat-model">{model}</span> : null}
        </div>
        <div className="chat-actions">
          <button type="button" className="chat-ghost" onClick={clearChat} disabled={!ready || clearing || sending}>
            {clearing ? "Очищаю..." : "Новый диалог"}
          </button>
          <Link href="/admin">Настройки</Link>
        </div>
      </header>

      <div className="chat-thread" ref={threadRef}>
        <div className="chat-column">
          {!ready ? <p className="chat-empty">Загрузка диалога...</p> : null}
          {ready && messages.length === 0 && !sending ? (
            <div className="chat-empty">
              <h1>Чем могу помочь?</h1>
              <p>Напишите сообщение. Агент использует модель и системный промпт из настроек.</p>
            </div>
          ) : null}
          {messages.map((message, index) => (
            <article
              key={`${message.role}-${index}`}
              className={message.role === "user" ? "bubble bubble-user" : "bubble bubble-agent"}
            >
              <span className="bubble-role">{message.role === "user" ? "Вы" : "Агент"}</span>
              <p>{message.content}</p>
            </article>
          ))}
          {sending ? (
            <article className="bubble bubble-agent bubble-pending" aria-live="polite">
              <span className="bubble-role">Агент</span>
              <p>Печатает...</p>
            </article>
          ) : null}
          {error ? <p className="chat-error">{error}</p> : null}
        </div>
      </div>

      <form className="chat-composer" onSubmit={onSubmit}>
        <div className="chat-column chat-compose-row">
          <label className="sr-only" htmlFor="chat-input">
            Сообщение
          </label>
          <textarea
            id="chat-input"
            ref={inputRef}
            value={draft}
            rows={1}
            placeholder="Напишите сообщение"
            maxLength={4000}
            disabled={!ready || sending}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
          />
          <button type="submit" disabled={!ready || sending || !draft.trim()}>
            {sending ? "Жду ответ..." : "Отправить"}
          </button>
        </div>
      </form>
    </div>
  );
}
