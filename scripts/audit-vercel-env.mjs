import { readFileSync, unlinkSync } from "fs";

const path = process.argv[2] || ".env.vercel.production.check";
const raw = readFileSync(path, "utf8");
const lines = raw.split(/\r?\n/).filter((l) => l && !l.startsWith("#") && l.includes("="));
const env = Object.fromEntries(
  lines.map((l) => {
    const i = l.indexOf("=");
    let v = l.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    return [l.slice(0, i), v];
  }),
);

function role(jwt) {
  try {
    return JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString()).role;
  } catch {
    return null;
  }
}

function kind(v) {
  if (!v) return "MISSING";
  if (v === "[SENSITIVE]") return "HIDDEN_SECRET_PLACEHOLDER";
  if (v.startsWith("eyJ")) return "JWT_LIKE";
  if (v.startsWith("http")) return "URL_LIKE";
  return `OTHER_len_${v.length}`;
}

console.log("ALL_KEYS", Object.keys(env).sort().join(", "));

const keys = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "TOKEN_TELEGRAM",
  "TELEGRAM_ADMIN_CHAT_ID",
  "API_GPT",
];

for (const k of keys) {
  const v = env[k];
  const info = { name: k, kind: kind(v), len: v ? v.length : 0 };
  if (v && v !== "[SENSITIVE]" && k.includes("SUPABASE_URL")) {
    try {
      info.host = new URL(v).host;
    } catch {
      info.host = "INVALID_URL";
    }
  }
  if (v && v !== "[SENSITIVE]" && k.includes("KEY")) {
    info.role = role(v);
    info.dotParts = v.split(".").length;
  }
  console.log(JSON.stringify(info));
}

if (process.argv.includes("--cleanup")) {
  unlinkSync(path);
  console.log("CLEANED", path);
}
