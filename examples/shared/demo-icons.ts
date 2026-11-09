// Stroke icons of the demo's own chrome (top bar and side panel), drawn on a 24px grid. The
// React and Vue examples render the same paths, so the two demos look the same. The editor's
// own controls draw their icons from the library.

export type DemoIconName =
  | 'chart'
  | 'settings'
  | 'close'
  | 'open'
  | 'new'
  | 'save'
  | 'chevron'
  | 'sun'
  | 'moon'
  | 'panelOpen'
  | 'panelClose';

const PANEL = 'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z';

export const DEMO_ICONS: Readonly<Record<DemoIconName, readonly string[]>> = {
  chart: ['M3 3v16a2 2 0 0 0 2 2h16', 'M18 17V9', 'M13 17V5', 'M8 17v-3'],
  settings: [
    'M20 7h-9',
    'M14 17H5',
    'M14 17a3 3 0 1 0 6 0a3 3 0 1 0-6 0',
    'M4 7a3 3 0 1 0 6 0a3 3 0 1 0-6 0',
  ],
  close: ['M18 6 6 18', 'm6 6 12 12'],
  open: [
    'm6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2',
  ],
  new: [
    'M4 22h14a2 2 0 0 0 2-2V7l-5-5H6a2 2 0 0 0-2 2v4',
    'M14 2v4a2 2 0 0 0 2 2h4',
    'M3 15h6',
    'M6 12v6',
  ],
  save: ['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'm7 10 5 5 5-5', 'M12 15V3'],
  chevron: ['m6 9 6 6 6-6'],
  sun: [
    'M8 12a4 4 0 1 0 8 0a4 4 0 1 0-8 0',
    'M12 2v2',
    'M12 20v2',
    'm4.93 4.93 1.41 1.41',
    'm17.66 17.66 1.41 1.41',
    'M2 12h2',
    'M20 12h2',
    'm6.34 17.66-1.41 1.41',
    'm19.07 4.93-1.41 1.41',
  ],
  moon: ['M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z'],
  panelOpen: [PANEL, 'M15 3v18', 'm10 15-3-3 3-3'],
  panelClose: [PANEL, 'M15 3v18', 'm8 9 3 3-3 3'],
};

/** The GitHub mark, a filled path on a 16px grid, for the source link. */
export const DEMO_GITHUB_MARK =
  'M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z';
