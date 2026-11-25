import type { UIMessage } from "ai";
import type { Citation } from "./domain";

/** Result of server-side citation validation, streamed after the answer text. */
export interface AnswerValidation {
  citations: Citation[];
  /** Markers like [S9] the model produced that do not correspond to any retrieved source. */
  invalidMarkers: string[];
  /** Page numbers mentioned in the answer that do not exist in any retrieved source's metadata. */
  unsupportedPageRefs: number[];
  /** True when no relevant evidence was retrieved and the assistant declined to answer. */
  abstained: boolean;
  /** Fraction of substantive sentences carrying at least one citation (0–1). */
  citationCoverage: number;
}

export type ChatDataParts = {
  citations: AnswerValidation;
  conversation: { id: string };
  status: { stage: "retrieving" | "generating" };
};

export type CasePilotUIMessage = UIMessage<never, ChatDataParts>;

/** Request body sent by the chat client (only the new message – history is loaded server-side). */
export interface ChatRequestBody {
  conversationId?: string;
  documentId: string;
  text: string;
}
