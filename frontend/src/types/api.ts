import type { Manifest, Report } from './schema';

export interface ConfigResponse {
  llm_configured: boolean;
  provider: string;
  model: string;
}

export interface ResultsListResponse {
  results: Manifest[];
}

export interface Advice {
  text: string;
  provider: string;
  model: string;
  source: string;
  result_id: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
  provider?: string;
  model?: string;
}

export interface ChatState {
  messages: ChatMessage[];
}

export interface ResultDetailResponse extends Manifest {
  report: Report;
  chat: ChatState;
  advice: Advice | null;
}
