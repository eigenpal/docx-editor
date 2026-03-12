import React, { createContext, useContext } from 'react';
import type { ColorValue } from '@eigenpal/docx-core/types/document';

type ColorHistory = {
  lastTextColor: ColorValue | string;
  lastHighlightColor: string;
  setLastTextColor: (value: ColorValue | string) => void;
  setLastHighlightColor: (value: string) => void;
};

const FALLBACK_HISTORY: ColorHistory = {
  lastTextColor: { auto: true },
  lastHighlightColor: 'none',
  setLastTextColor: () => {},
  setLastHighlightColor: () => {},
};

const ColorHistoryContext = createContext<ColorHistory | null>(null);

export function useColorHistory(): ColorHistory {
  return useContext(ColorHistoryContext) ?? FALLBACK_HISTORY;
}

export const ColorHistoryProvider = ColorHistoryContext.Provider;
