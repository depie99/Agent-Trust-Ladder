import fs from "node:fs";
import readline from "node:readline";

const output = process.env.ATL_FAKE_APP_SERVER_LOG;
const write = (value) => fs.appendFileSync(output, `${JSON.stringify(value)}\n`);
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", (line) => {
  const message = JSON.parse(line);
  write(message);
  if (!message.id) return;
  const result = message.method === "thread/resume"
    ? { thread: { id: message.params.threadId, ephemeral: false } }
    : message.method === "thread/start"
      ? { thread: { id: "thread-dedicated", sessionId: "thread-dedicated", ephemeral: false } }
      : {};
  process.stdout.write(`${JSON.stringify({ id: message.id, result })}\n`);
});
