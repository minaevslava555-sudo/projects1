"use client";

import { FormEvent, useEffect, useState } from "react";

type AgentPayload = {
  prompt: string;
  model: string;
  models: string[];
};

export default function AdminPage() {
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [status, setStatus] = useState("Загрузка...");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/agent")
      .then((res) => {
        if (!res.ok) throw new Error("Не удалось загрузить настройки");
        return res.json() as Promise<AgentPayload>;
      })
      .then((data) => {
        setPrompt(data.prompt);
        setModel(data.model);
        setModels(data.models);
        setStatus("Настройки загружены из data/agent.json");
      })
      .catch((error: Error) => {
        setStatus(error.message);
      });
  }, []);

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
      if (!res.ok) throw new Error("Не удалось сохранить");
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

  return (
    <main className="admin">
      <h1>Админка агента</h1>
      <p className="hint">
        Промпт и модель хранятся в файле <code>data/agent.json</code>. Telegram-бот
        работает локально через polling, без webhook.
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

        <button type="submit" disabled={saving}>
          {saving ? "Сохраняю..." : "Сохранить"}
        </button>
      </form>
      <p className="status">{status}</p>
    </main>
  );
}
