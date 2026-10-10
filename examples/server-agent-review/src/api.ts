export interface Config {
  url: string;
  token: string;
  ai: boolean;
}
export interface Room {
  roomId: string;
  title: string;
}
export type Job = {
  id: string;
  version: number;
  epoch: string;
  state:
    | 'connecting'
    | 'reading'
    | 'proposing'
    | 'syncing'
    | 'completed'
    | 'cancelled'
    | 'interrupted'
    | 'failed';
  message: string;
  proposals: number;
  mode: 'scripted' | 'ai';
  instruction: string;
};
export const activeJob = (job: Job | null) =>
  Boolean(job && ['connecting', 'reading', 'proposing', 'syncing'].includes(job.state));
export async function api<T>(config: Config, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: { 'x-review-token': config.token, ...init.headers },
  });
  if (!response.ok) throw new Error((await response.json()).error ?? 'Request failed');
  return response.json();
}

/** HTTP responses and reconnect snapshots may arrive after newer SSE events. */
export function newerJob(
  current: Job | null,
  incoming: Job | null,
  source: 'stream' | 'response' = 'response'
): Job | null {
  if (!incoming) return current;
  if (!current) return incoming;
  // EventSource delivers in stream order across reconnects. A new worker can have lost
  // unsaved versions; its stream establishes the new epoch. Late HTTP cannot restore it.
  if (incoming.epoch !== current.epoch) return source === 'stream' ? incoming : current;
  return incoming.version > current.version ? incoming : current;
}
