/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The review rail's date format, shared by the React and Vue rails.

const reviewDateFormats = new Map<string, Intl.DateTimeFormat>();

/**
 * The rail's date format in the interface language: a translated rail shows its dates in that
 * language. The default English catalog keeps the browser's locale, so an English rail still
 * follows the reader's regional order of day and month.
 */
export function reviewDateFormat(lang: string): Intl.DateTimeFormat {
  const key = lang === 'en' ? '' : lang;
  let format = reviewDateFormats.get(key);
  if (!format) {
    const options: Intl.DateTimeFormatOptions = {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    };
    try {
      format = new Intl.DateTimeFormat(key || undefined, options);
    } catch {
      // A catalog `_lang` that is not a valid language tag falls back to the browser's locale.
      format = new Intl.DateTimeFormat(undefined, options);
    }
    reviewDateFormats.set(key, format);
  }
  return format;
}
