# Ask Katha

A local-first chat agent that remembers dated conversations and checks what changed through one web-search tool.

Current release proof: [complete default-model evaluation](docs/evaluations/default-fd37213-evening-review.md) records **59/63 supported factual claims (93.7%), 37/40 successful tasks and no execution errors**. This passes the agreed 90% fixed-evidence gate under coding-agent review; it is not production accuracy. Three failed web explanations and all earlier quota failures remain visible.

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

`npm run eval` reruns the forty-case retrieval ablation. `npm run eval:live` explicitly consumes configured Groq/Tavily quotas; it is never run by `npm test`. See [evaluation notes](docs/evaluations/README.md), including failures and the exact scope of each release gate. Live captures and raw history stay in ignored `data/`.

Set keys in the root `.env` file, using the names in `.env.example`. The desktop copy's convenient path is `/Users/soumyajitghosh/Downloads/files/katha/.env`; a judge uses their own clone's `.env`. Do not paste keys in chat or add them to Git. Restart `npm run dev` after changing keys.

`npm run test:browser` uses a Playwright-installed Chromium (`npx playwright install chromium`). Optionally set `CHROME_PATH` to a local Chrome executable, or `BROWSER=webkit` after installing WebKit. Browser tests use isolated temporary history and blank provider credentials. `npm run lint` checks formatting. CI defines Node 24 checks for macOS, Windows and Linux; those jobs must actually run before declaring platform support verified.

The [attachment audit](docs/ATTACHMENT_AUDIT.md) records PDF contributor/pronoun checks, exact CSV calculations and image restart/trash/restore checks. When inference is unavailable, eligible retained evidence can still be shown as an explicitly labelled partial response. That is evidence access, not a generated answer or completed verification.

## External sources

Use **Connections** in the sidebar, or type **@** → **Connect a source**. Notion and Canva use their official MCP servers with OAuth. Notion dynamically registers this client; Canva requires the owner's registered MCP application credentials. Gmail and HubSpot additionally offer read-only API adapters after OAuth app setup. Visitors authorize their own account and explicitly choose imports. Custom MCP resources are under Advanced. See [connection setup and permissions](docs/MCP.md). This remains a single local workspace, not a shared multi-user service. HubSpot and Salesforce official MCP imports require registered provider apps and live account verification; Salesforce currently imports recently viewed IDs and names and may incur Flex Credit charges. Gmail/HubSpot API adapters are explicitly distinguished from official MCP integrations. The agent itself still exposes only web search.

Katha chooses retained evidence versus web search automatically. Explicit sources-only requests stay local; current public information can search without a special keyword. The answer audit shows the routing decision. Private-source freshness questions are not a reason to export their content into web queries.

`npx tsx evaluations/metrics.ts INPUT.json OUTPUT.json evaluations/answer-cases.json` reports factual support, complete tasks, review coverage, execution limitations, latency and reported usage separately. The [versioned release review](docs/evaluations/release-review.md) includes a two-model comparison and the frozen `936da48` default run (50/52 supported delivered claims, 30/40 complete tasks, eight quota failures). The latter gate is **EXECUTION_LIMITED**, not passed. The latest focused five-vendor mixed-price/release fixture passes all ten outcomes; that is not live market research or production accuracy.

The [release evidence matrix](docs/RELEASE_READINESS.md) maps the agreed requirements to implementation, tests and explicit deferrals. Quota-limited runs, source-only recovery and model-generated task completion are reported separately.

The [historical source-qualification follow-up](docs/evaluations/qualified-prose-review.md) retains earlier failed candidate replays. The complete current-default result linked above supersedes its old release status without changing those captured failures.

## Reproduce the complete answer evaluation

With your own configured keys, `EVAL_MODELS=qwen/qwen3.8-27b npx tsx evaluations/answers.ts --run-live` captures fresh web observations and runs all forty cases. It consumes quota; new observations and model sampling can change the result.

To replay the exact published observations instead, export them from the public reviewed ledger (no keys or network needed):

```sh
npx tsx evaluations/export-evidence.ts docs/evaluations/default-fd37213-evening-reviewed.json data/evaluations/published-evidence
```

The command verifies the original capture hash and requires a new output directory. Then, with keys and sufficient quota:

```sh
EVAL_MODELS=qwen/qwen3.8-27b EVAL_CAPTURE_DIR=data/evaluations/published-evidence EVAL_OUTPUT=data/evaluations/my-replay npx tsx evaluations/answers.ts --run-live
```

Use fresh experiment directories. Review every answer before computing claim support; fixtures and status/keyword checks do not establish factual truth. The public ledger contains synthetic records and public documentation, not the owner's private PDFs or history.
