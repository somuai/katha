# Ask Katha

A local-first chat agent that remembers dated conversations and checks what changed through one web-search tool.

## Run

Use Node 24 LTS (`nvm use`). Run `npm install`, copy `.env.example` to `.env`, set `GROQ_API_KEY` and `TAVILY_API_KEY`, then `npm run dev`. Open http://localhost:3000. Without keys, the app still retains sources and supports deterministic historical recall; live answers/search/transcription require provider access. Never put keys in client code.

Models: configurable Groq Qwen reasoning/vision, Whisper transcription, local MiniLM semantic recall. Providers have limited free quotas; no unlimited-free claim. First embeddings download weights to the workspace data directory. Set `KATHA_EMBEDDINGS=off` for lexical-only mode. Katha stores private local history in `data/` (ignored by git). The original files and extracted descriptions remain distinguishable.

## Check

`npm test` runs deterministic public-interface tests with real temporary SQLite databases and external-provider fixtures. `npm run check` checks TypeScript; `npm run build` builds the interface. See DESIGN.md for architecture and docs/STATUS.md for honest implementation limits. All runtime data starts empty; tests do not seed your history.

## Try

Upload dated Markdown notes, then ask “What did we shortlist on 3 November?” Ask whether it changed today. Inspect sources and the answer audit. Dates inferred from conversation references are resolved in your selected timezone; confirm imported historical dates explicitly. Voice requires microphone permission and sends a short clip to Groq; review the transcript before Send. Uploaded image/scanned-page descriptions are model-derived evidence.

## Local development storage

This copy lives on an APFS image on the owner's SSD to avoid filling the laptop. A normal clone uses a normal local folder; no disk-image setup is required for judges. The green mat and Instrument Serif assets are reused from the owner's portfolio with permission; no portfolio application code or private data is imported.

## Evidence and configuration

`npm run eval` reruns the forty-case retrieval ablation. `npm run eval:live` explicitly consumes configured Groq/Tavily quotas; it is never run by `npm test`. See [evaluation notes](docs/evaluations/README.md), including failures and unpassed release gates. Live captures and raw history stay in ignored `data/`.

Set keys in the root `.env` file, using the names in `.env.example`. The desktop copy's convenient path is `/Users/soumyajitghosh/Downloads/files/katha/.env`; a judge uses their own clone's `.env`. Do not paste keys in chat or add them to Git. Restart `npm run dev` after changing keys.

`npm run test:browser` uses a Playwright-installed Chromium (`npx playwright install chromium`). Optionally set `CHROME_PATH` to a local Chrome executable, or `BROWSER=webkit` after installing WebKit. Browser tests use isolated temporary history and blank provider credentials. `npm run lint` checks formatting. CI defines Node 24 checks for macOS, Windows and Linux; those jobs must actually run before declaring platform support verified.

## External sources

Use **Connections** in the sidebar, or type **@** → **Connect a source**. Notion and Canva use their official MCP servers with OAuth. Notion dynamically registers this client; Canva requires the owner's registered MCP application credentials. Gmail and HubSpot additionally offer read-only API adapters after OAuth app setup. Visitors authorize their own account and explicitly choose imports. Custom MCP resources are under Advanced. See [connection setup and permissions](docs/MCP.md). This remains a single local workspace, not a shared multi-user service. HubSpot and Salesforce official MCP imports require registered provider apps and live account verification; Salesforce currently imports recently viewed IDs and names and may incur Flex Credit charges. Gmail/HubSpot API adapters are explicitly distinguished from official MCP integrations. The agent itself still exposes only web search.

Katha chooses retained evidence versus web search automatically. Explicit sources-only requests stay local; current public information can search without a special keyword. The answer audit shows the routing decision. Private-source freshness questions are not a reason to export their content into web queries.

`npx tsx evaluations/metrics.ts INPUT.json OUTPUT.json evaluations/answer-cases.json` reports completion, reviewed factual precision, task success, evidence-review coverage and latency separately. The 90% gate cannot pass with missing cases or unreviewed claims. Existing live outputs still need human claim review; retrieval scores are not answer-support scores.
