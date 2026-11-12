import { createProviders } from "./index.ts";
/** Opt-in benchmark adapter only; the application does not select it automatically. */
export function createGeminiBenchmarkProvider(
  key: string,
  model = "gemini-3.8-flash",
  fetcher: typeof fetch = fetch,
) {
  return createProviders({
    groqKey: "gemini-benchmark-adapter",
    model,
    fetcher: async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      const response = await fetcher(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": key,
          },
          body: JSON.stringify({
            systemInstruction: {
              parts: [
                {
                  text: body.messages
                    .filter((m: any) => m.role === "system")
                    .map((m: any) => m.content)
                    .join("\n"),
                },
              ],
            },
            contents: body.messages
              .filter((m: any) => m.role !== "system")
              .map((m: any) => ({
                role: m.role === "assistant" ? "model" : "user",
                parts: [{ text: m.content }],
              })),
            generationConfig: {
              responseMimeType: "application/json",
              temperature: 0,
              maxOutputTokens: body.max_tokens,
            },
          }),
          signal: init?.signal,
        },
      );
      if (!response.ok) return response;
      const data: any = await response.json();
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: data.candidates?.[0]?.content?.parts
                  ?.filter((p: any) => !p.thought)
                  .map((p: any) => p.text || "")
                  .join(""),
              },
            },
          ],
          usage: {
            prompt_tokens: data.usageMetadata?.promptTokenCount || 0,
            completion_tokens: data.usageMetadata?.candidatesTokenCount || 0,
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    },
  });
}
