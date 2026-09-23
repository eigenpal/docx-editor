// NOTICE: vendored from shadcn/ui (https://ui.shadcn.com/r/styles/new-york/utils.json), MIT
// License, Copyright (c) 2023 shadcn. Installed with `shadcn add @extend/pdf-viewer`.
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
