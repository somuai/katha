import type { PriceTerms } from "../core/pricing.js";
export type Evidence = {
  extractionMethod?: string;
  id: string;
  csvSummary?: string;
  title: string;
  url?: string;
  text: string;
  /** Server-only original passage for exact quote reconstruction; never sent as extra model context. */
  sourceText?: string;
  observedAt: string;
  publishedAt?: string;
  query?: string;
};
export type SearchQuery = {
  query: string;
  startDate?: string;
  endDate?: string;
};
export type SearchResult = {
  query: string;
  evidence: Evidence[];
  cached: boolean;
  error?: string;
};
export type Plan = {
  mode: "general" | "recall" | "current" | "verify";
  queries: SearchQuery[];
  clarification?: string;
};
export type Comparison = {
  extractionMethod?: "explicit-offer-parser";
  effectiveAt?: string;
  effectiveDateEvidence?: { sourceId: string; quote: string };
  baselinePrice?: PriceTerms;
  currentPrice?: PriceTerms;
  currentAlternatives?: PriceTerms[];
  claim: string;
  baselineSourceIds: string[];
  evidenceIds: string[];
  status:
    | "CURRENTLY_MATCHES"
    | "DIFFERS_CHANGE_TIME_UNKNOWN"
    | "CHANGED_WITH_DATED_EVIDENCE"
    | "CONFLICTING"
    | "UNVERIFIED";
  explanation: string;
};
export type Answer = {
  text: string;
  comparisons: Comparison[];
  citations: string[];
  usage?: { inputTokens: number; outputTokens: number };
};
export type ModelInput = {
  activeSourceIds?: string[];
  retrievalHint?: string;
  question: string;
  history?: string;
  evidence?: Evidence[];
  baseline?: Evidence[];
  timezone?: string;
  now?: string;
  signal?: AbortSignal;
};
export interface SearchCache {
  get(key: string): { value: SearchResult; expiresAt: number } | undefined;
  set(key: string, value: SearchResult, expiresAt: number): void;
}
export interface CreditBudget {
  consume(credits: number): boolean;
}
export type ProviderOptions = {
  groqKey?: string;
  tavilyKey?: string;
  model?: string;
  fetcher?: typeof fetch;
  clock?: () => number;
  cache?: SearchCache;
  budget?: CreditBudget;
  searchRetries?: number;
  onWait?: (retryAt: number) => void;
};
