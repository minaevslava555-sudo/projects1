export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startTelegramChannel } = await import("./bot/telegram");
  await startTelegramChannel();
}
