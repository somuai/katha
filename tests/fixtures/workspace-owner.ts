import { createKatha } from "../../src/core/index.ts";
const [directory, mode] = process.argv.slice(2);
try {
  const app = createKatha({
    directory,
    model: {
      generate: ({ signal }) =>
        new Promise((_, reject) =>
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          }),
        ),
    },
  });
  if (mode === "hold") {
    const chat = await app.workspace.createConversation();
    const receipt = await app.turns.start({
      conversationId: chat.id,
      clientRequestId: "crash-owner",
      expectedTailId: null,
      text: "Crash-persistent accepted input.",
    });
    for await (const event of app.turns.events(receipt.turnId))
      if (event.type === "status" && (event.data as any).status === "RUNNING")
        break;
    process.stdout.write(
      JSON.stringify({
        ok: true,
        conversationId: chat.id,
        turnId: receipt.turnId,
      }) + "\n",
    );
    setInterval(() => {}, 1000);
  } else {
    app.close();
    process.stdout.write(JSON.stringify({ ok: true }) + "\n");
  }
} catch (error: any) {
  process.stdout.write(
    JSON.stringify({ ok: false, code: error.code, message: error.message }) +
      "\n",
  );
}
