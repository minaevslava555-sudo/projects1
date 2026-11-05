"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";

type AgentPayload = {
  prompt: string;
  model: string;
  models: string[];
  error?: string;
};

export default function AdminPage() {
  const [authed, setAuthed] = useState(false);
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [status, setStatus] = useState("Проверяю доступ...");
  const [saving, setSaving] = useState(false);
  const [loggingIn, setLoggingIn] = useState(false);

  async function loadSettings() {
    const res = await fetch("/api/agent");
    const data = (await res.json()) as AgentPayload;
    if (res.status === 401) {
      setAuthed(false);
      setStatus("Введите логин и пароль");
      return false;
    }
    if (!res.ok) throw new Error(data.error || "Не удалось загрузить настройки");
    setPrompt(data.prompt);
    setModel(data.model);
    setModels(data.models);
    setAuthed(true);
    setStatus("Настройки загружены из data/agent.json");
    return true;
  }

  useEffect(() => {
    loadSettings().catch((error: Error) => {
      setStatus(error.message);
    });
  }, []);

  async function onLogin(event: FormEvent) {
    event.preventDefault();
    setLoggingIn(true);
    setStatus("Вход...");
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ login, password }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || "Не удалось войти");
      setPassword("");
      await loadSettings();
    } catch (error) {
      setAuthed(false);
      setStatus(error instanceof Error ? error.message : "Не удалось войти");
    } finally {
      setLoggingIn(false);
    }
  }

  async function onLogout() {
    await fetch("/api/admin/logout", { method: "POST" });
    setAuthed(false);
    setPrompt("");
    setModel("");
    setModels([]);
    setStatus("Введите логин и пароль");
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setStatus("Сохранение...");
    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, model }),
      });
      const data = (await res.json()) as AgentPayload;
      if (res.status === 401) {
        setAuthed(false);
        setStatus("Введите логин и пароль");
        return;
      }
      if (!res.ok) throw new Error(data.error || "Не удалось сохранить");
      setPrompt(data.prompt);
      setModel(data.model);
      setModels(data.models);
      setStatus("Сохранено. Бот подхватит промпт и модель на следующем сообщении.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Ошибка сохранения");
    } finally {
      setSaving(false);
    }
  }

  if (!authed) {
    return (
      <main className="admin">
        <h1>Вход в админку</h1>
        <p className="hint">
          <Link href="/">Назад к чату</Link>
        </p>
        <form onSubmit={onLogin}>
          <label htmlFor="admin-login">Логин</label>
          <input
            id="admin-login"
            type="text"
            autoComplete="username"
            value={login}
            onChange={(event) => setLogin(event.target.value)}
            required
          />
          <label htmlFor="admin-password">Пароль</label>
          <input
            id="admin-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
          <button type="submit" disabled={loggingIn}>
            {loggingIn ? "Вхожу..." : "Войти"}
          </button>
        </form>
        <p className="status">{status}</p>
      </main>
    );
  }

  return (
    <main className="admin">
      <h1>Админка агента</h1>
      <p className="hint">
        Промпт и модель хранятся в файле <code>data/agent.json</code>. Веб-чат и
        Telegram используют одни и те же настройки.{" "}
        <Link href="/">Чат</Link>
      </p>
      <form onSubmit={onSubmit}>
        <label htmlFor="model">Модель</label>
        <select
          id="model"
          value={model}
          onChange={(event) => setModel(event.target.value)}
          required
        >
          {model && !models.includes(model) ? <option value={model}>{model}</option> : null}
          {models.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>

        <label htmlFor="prompt">Системный промпт</label>
        <textarea
          id="prompt"
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          rows={12}
          required
        />

        <div className="admin-actions">
          <button type="submit" disabled={saving}>
            {saving ? "Сохраняю..." : "Сохранить"}
          </button>
          <button type="button" className="chat-ghost" onClick={onLogout}>
            Выйти
          </button>
        </div>
      </form>
      <p className="status">{status}</p>
    </main>
  );
}
