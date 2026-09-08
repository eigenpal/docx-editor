import path from 'node:path';
export const DATA_DIR = process.env.REVIEW_DATA_DIR ?? path.join(import.meta.dirname, '../.data');
export const COLLAB_PORT = Number(process.env.COLLAB_PORT ?? 1280);
export const COLLAB_URL = process.env.COLLAB_URL ?? `ws://127.0.0.1:${COLLAB_PORT}`;
export const USER_TOKEN = process.env.COLLAB_TOKEN ?? 'review-demo-token';
export const AGENT_TOKEN = process.env.AGENT_COLLAB_TOKEN ?? 'review-agent-token';
export const API_PORT = Number(process.env.REVIEW_API_PORT ?? 3180);
export const ROOM_ID = /^[A-Za-z0-9_-]{24,256}$/;
export function requireRoomId(id: string) {
  if (!ROOM_ID.test(id)) throw new Error('Invalid room ID');
  return id;
}
