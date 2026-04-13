// Lightweight per-tab identity. Persisted to sessionStorage so a refresh
// keeps the same user, but a new tab gets a fresh persona — handy for demoing
// multi-user collaboration in two browser windows side by side.

const NAMES = [
  'Ada',
  'Grace',
  'Linus',
  'Hedy',
  'Margaret',
  'Tim',
  'Donald',
  'Barbara',
  'Alan',
  'Radia',
];

const COLORS = [
  '#ef4444',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#06b6d4',
  '#3b82f6',
  '#8b5cf6',
  '#ec4899',
];

export interface User {
  name: string;
  color: string;
}

const STORAGE_KEY = 'docx-editor-collab-user';

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

export function loadOrCreateUser(): User {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as User;
  } catch {}
  // Single-name display so initials in AvatarStack render cleanly (e.g. "AD"
  // instead of "A4" when a numeric suffix would otherwise leak in).
  const user: User = {
    name: pick(NAMES),
    color: pick(COLORS),
  };
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(user));
  } catch {}
  return user;
}

export function getOrCreateRoomFromUrl(): string {
  if (typeof window === 'undefined') return 'default';
  const hash = window.location.hash.replace(/^#/, '');
  if (hash) return hash;
  const room = `room-${Math.random().toString(36).slice(2, 10)}`;
  window.history.replaceState(null, '', `#${room}`);
  return room;
}
