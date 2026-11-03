import type { AgentConfig, ChatMessage } from "./agent-store";

export async function askAgent(
  config: AgentConfig,
  history: ChatMessage[],
  userText: string,
): Promise<string> {
  const apiKey = process.env.API_GPT;
  if (!apiKey) {
    throw new Error("Не задан API_GPT в .env.local");
  }

  const messages = [
    { role: "system", content: config.prompt },
    ...history,
    { role: "user", content: userText },
  ];

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      temperature: 0.7,
    }),
  });

  const payload = (await response.json()) as {
    error?: { message?: string };
    choices?: Array<{ message?: { content?: string } }>;
  };

  if (!response.ok) {
    throw new Error(payload.error?.message || `OpenAI HTTP ${response.status}`);
  }

  const text = payload.choices?.[0]?.message?.content?.trim();
  if (!text) {
    throw new Error("Пустой ответ модели");
  }

  return text;
}
