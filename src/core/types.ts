import type { PriceTerms } from "./pricing.js";
export type TurnStatus =
  | "QUEUED"
  | "WAITING_FOR_SOURCES"
  | "RUNNING"
  | "WAITING_FOR_QUOTA"
  | "COMPLETED"
  | "PARTIAL"
  | "FAILED"
  | "CANCELLED"
  | "INTERRUPTED";
export type ComparisonStatus =
  | "CURRENTLY_MATCHES"
  | "DIFFERS_CHANGE_TIME_UNKNOWN"
  | "CHANGED_WITH_DATED_EVIDENCE"
  | "CONFLICTING"
  | "UNVERIFIED";
export interface Conversation {
  id: string;
  title: string;
  createdAt: string;
  tailId: string | null;
  deletedAt: string | null;
}
export interface Source {
  interpretation?: string;
  interpretationSourceIds?: string[];
  matches?: { text: string; startToken: number; endToken: number }[];
  id: string;
  kind: "message" | "attachment" | "web" | "correction";
  role: "user" | "assistant" | "document" | "web";
  conversationId: string | null;
  turnId: string | null;
  title: string;
  content: string;
  recordedAt: string;
  occurredAt: string | null;
  occurredEnd: string | null;
  dateProvenance: string;
  version: number;
  deletedAt: string | null;
  invalidated: boolean;
  metadata: Record<string, unknown>;
}
export interface Citation {
  sourceId: string;
  label?: string;
}
export interface Comparison {
  effectiveAt?: string;
  effectiveDateEvidence?: { sourceId: string; quote: string };
  baselinePrice?: PriceTerms;
  currentPrice?: PriceTerms;
  priceCheck?: ReturnType<typeof import("./pricing.js").comparePrices>;
  claim: string;
  status: ComparisonStatus;
  baselineSourceIds: string[];
  evidenceSourceIds: string[];
  explanation: string;
}
export interface TurnInput {
  conversationId: string;
  clientRequestId: string;
  expectedTailId: string | null;
  text: string;
  attachmentIds?: string[];
  memoryScope?: "workspace" | "conversation";
  timezone?: string;
  retryOf?: string;
}
export interface TurnReceipt {
  turnId: string;
  status: TurnStatus;
  chatTail: string;
}
export interface TurnEvent {
  id: number;
  turnId: string;
  type: string;
  data: unknown;
  createdAt: string;
}
export interface TurnSnapshot {
  id: string;
  conversationId: string;
  status: TurnStatus;
  text: string;
  answer: string;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  citations: Citation[];
  comparisons: Comparison[];
  sources: Source[];
  trace: Record<string, unknown>;
}
export interface SearchResult {
  title: string;
  url: string;
  content: string;
  snippet?: string;
  publishedAt?: string | null;
  effectiveAt?: string | null;
  observedAt?: string;
}
export interface SearchAdapter {
  search(
    query: string,
    options: { signal: AbortSignal; fresh: boolean },
  ): Promise<SearchResult[]>;
}
export interface ModelContext {
  question: string;
  history: Source[];
  evidence: Source[];
  baseline?: Source[];
  timezone?: string;
  now?: string;
  verification: boolean;
  signal: AbortSignal;
  onDelta?: (delta: string) => void;
}
export interface ModelAdapter {
  generate(context: ModelContext): Promise<{
    answer: string;
    usage?: { inputTokens: number; outputTokens: number };
    citations?: Citation[];
    comparisons?: Comparison[];
  }>;
  plan?(context: Omit<ModelContext, "onDelta">): Promise<{
    queries: string[];
    clarification?: string;
    mode?: "general" | "recall" | "current" | "verify";
  }>;
}
export interface EmbeddedSegment {
  text: string;
  startToken: number;
  endToken: number;
  vector: number[];
}
export interface Embedder {
  segment?(text: string): Promise<EmbeddedSegment[]>;
  embed(text: string): Promise<number[]>;
  modelId: string;
}
export interface ImportInput {
  name: string;
  content: string;
  conversationId?: string;
  occurredAt?: string;
  timezone?: string;
  mimeType?: string;
  metadata?: Record<string, unknown>;
}
export interface RecallQuery {
  asOf?: string;
  text?: string;
  conversationId?: string;
  from?: string;
  to?: string;
  timeField?: "recorded" | "occurred";
  limit?: number;
  offset?: number;
  original?: boolean;
}
export interface CorrectionInput {
  assertionId?: string;
  sourceId: string;
  content: string;
  mode: "CORRECT_PAST_RECORD" | "CHANGE_FROM_NOW";
  effectiveAt?: string;
}
export interface KathaOptions {
  /** Evaluation ablation only; production defaults to hybrid. */
  retrievalStrategy?: "recent" | "lexical" | "hybrid";
  directory: string;
  clock?: () => Date;
  model?: ModelAdapter;
  search?: SearchAdapter;
  embedder?: Embedder;
  maxActiveTurns?: number;
  searchAttempts?: number;
  activeTimeoutMs?: number;
}
export class KathaError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message);
    this.name = "KathaError";
  }
}
