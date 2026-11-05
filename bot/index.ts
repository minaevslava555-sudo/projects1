import { config as loadEnv } from "dotenv";
import { startTelegramPolling } from "./telegram";

loadEnv({ path: ".env.local" });

if (!process.env.TOKEN_TELEGRAM) {
  throw new Error("Не задан TOKEN_TELEGRAM");
}

startTelegramPolling().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
