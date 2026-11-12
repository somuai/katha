import type { ProviderOptions } from "./types.ts";
export type ProviderSetup = {
  groq: {
    configured: boolean;
    model: string;
    availability: "not_checked" | "available" | "unavailable";
    message?: string;
  };
  tavily: { configured: boolean; message?: string };
};
export async function validateProviderSetup(
  options: ProviderOptions = {},
  dryRun = true,
): Promise<ProviderSetup> {
  const result: ProviderSetup = {
    groq: {
      configured: !!options.groqKey,
      model: options.model || "qwen/qwen3.8-27b",
      availability: "not_checked",
    },
    tavily: { configured: !!options.tavilyKey },
  };
  if (!options.groqKey)
    result.groq.message =
      "Set GROQ_API_KEY to enable generation, image interpretation and transcription.";
  if (!options.tavilyKey)
    result.tavily.message = "Set TAVILY_API_KEY to verify current information.";
  if (dryRun || !options.groqKey) return result;
  try {
    const response = await (options.fetcher || fetch)(
      "https://api.groq.com/openai/v1/models",
      {
        headers: { Authorization: `Bearer ${options.groqKey}` },
        signal: AbortSignal.timeout(10000),
      },
    );
    if (!response.ok) {
      result.groq.availability = "unavailable";
      result.groq.message = `Model availability check failed (${response.status}).`;
      return result;
    }
    const data: any = await response.json();
    result.groq.availability = data.data?.some(
      (m: any) => m.id === result.groq.model,
    )
      ? "available"
      : "unavailable";
    if (result.groq.availability === "unavailable")
      result.groq.message =
        "The configured model is not available on this account. Select an available image-capable model explicitly; no paid fallback was enabled.";
  } catch {
    result.groq.availability = "unavailable";
    result.groq.message =
      "Could not connect to the model catalog. Existing local history is still available.";
  }
  return result;
}
