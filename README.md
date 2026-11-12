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
