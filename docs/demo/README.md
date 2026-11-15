# README demo

`katha.gif` is a 20-second, 1120 × 630 GIF assembled from actual browser screenshots of the locally running app. It shows the opening screen, typing a synthetic shortlist, acknowledging the saved note, asking a follow-up, receiving a model-generated answer, and inspecting the original source.

The workspace was empty and isolated from the author's real history and account connections. The three vendor names and team size are demonstration inputs, not a real purchasing decision. The `Remember:` acknowledgement is deterministic; the follow-up uses the configured Groq model (`qwen/qwen3.8-27b`). The clip demonstrates retained conversational context, not web search, attachment accuracy or measured performance.

Typing cadence and pauses are shortened for readability. No generated answer was substituted or typed into the rendered page. A fully loaded opening frame was used instead of the transient asset-loading frame. FFmpeg applies a shared palette and delta compression; the GIF loops and contains no audio.

During the first recording attempt, the model incorrectly denied having an earlier record when receiving a new note. That failure led to a regression test and a saved-original acknowledgement path. The published capture was made after that fix; it does not retroactively make the first response correct.
