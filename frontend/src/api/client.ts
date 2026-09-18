import type {
  Advice,
  ChatState,
  ConfigResponse,
  ResultDetailResponse,
  ResultsListResponse,
} from '../types/api';
import type { Manifest, Report } from '../types/schema';

class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, options);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(res.status, body.error || res.statusText);
  }
  return res.json();
}

export function getConfig(): Promise<ConfigResponse> {
  return api('/api/config');
}

export function getResults(): Promise<ResultsListResponse> {
  return api('/api/results');
}

export function getResult(id: string): Promise<ResultDetailResponse> {
  return api(`/api/results/${id}`);
}

export function saveResult(report: Report, videoMime: string, rawMime: string): Promise<Manifest> {
  return api('/api/results', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ report, video_mime: videoMime, raw_mime: rawMime }),
  });
}

export function uploadVideo(id: string, filename: string, blob: Blob): Promise<void> {
  return fetch(`/api/results/${id}/${filename}`, {
    method: 'PUT',
    body: blob,
  }).then((res) => {
    if (!res.ok) throw new ApiError(res.status, 'Video upload failed');
  });
}

export function completeResult(id: string): Promise<Manifest> {
  return api(`/api/results/${id}/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
}

export function getAdvice(id: string, regenerate = false): Promise<Advice> {
  return api(`/api/results/${id}/advice`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(regenerate ? { regenerate: true } : {}),
  });
}

export function sendChat(id: string, message: string): Promise<ChatState> {
  return api(`/api/results/${id}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  });
}

export { ApiError };
