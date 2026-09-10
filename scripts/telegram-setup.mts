import "dotenv/config";

/**
 * Finds the chat id for the alert bot and sends a test message.
 *
 *   npm run telegram -- --token 8123:AA...        # verify the token, list chats it can see
 *   npm run telegram -- --token 8123:AA... --chat -1001234567890   # send a test message
 *
 * With TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID already in the environment the flags
 * can be omitted. Nothing is stored: paste the values into the host's env yourself.
 */

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const token = arg("token") ?? process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error("No bot token. Pass --token <token> or set TELEGRAM_BOT_TOKEN.");
  console.error("Get one from @BotFather in Telegram: /newbot");
  process.exit(1);
}

async function call<T>(method: string, body?: unknown): Promise<T> {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await res.json()) as { ok: boolean; result?: T; description?: string };
  if (!json.ok) throw new Error(`${method}: ${json.description ?? res.status}`);
  return json.result as T;
}

interface Chat {
  id: number;
  type: string;
  title?: string;
  username?: string;
  first_name?: string;
}

const me = await call<{ username: string; first_name: string }>("getMe");
console.log(`✓ Bot: @${me.username} (${me.first_name})`);

const chatId = arg("chat") ?? process.env.TELEGRAM_CHAT_ID;

if (!chatId) {
  const updates = await call<{ message?: { chat: Chat } }[]>("getUpdates");
  const chats = new Map<number, Chat>();
  for (const u of updates) if (u.message?.chat) chats.set(u.message.chat.id, u.message.chat);

  if (chats.size === 0) {
    console.log("\nNo chats found yet. Do this, then run the command again:");
    console.log("  1. Create a group in Telegram for the alerts");
    console.log(`  2. Add @${me.username} to it`);
    console.log("  3. Write any message in that group");
    console.log("\nNote: Telegram only keeps recent updates, so send the message shortly before re-running.");
    process.exit(0);
  }

  console.log("\nChats this bot can see:");
  for (const c of chats.values()) {
    const name = c.title ?? c.username ?? c.first_name ?? "(no name)";
    console.log(`  ${String(c.id).padStart(16)}  ${c.type.padEnd(10)} ${name}`);
  }
  const [first] = chats.values();
  console.log(`\nPick the group and re-run with --chat <id>, e.g. --chat ${first.id}`);
  process.exit(0);
}

await call("sendMessage", {
  chat_id: chatId,
  text: "✅ Qimby is connected. Temperature alerts will arrive here.",
  disable_web_page_preview: true,
});
console.log(`✓ Test message sent to ${chatId}`);
console.log("\nPut these into the host environment (Render → Environment):");
console.log(`  TELEGRAM_BOT_TOKEN=${token}`);
console.log(`  TELEGRAM_CHAT_ID=${chatId}`);
