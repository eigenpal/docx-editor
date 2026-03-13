declare const __DOCX_PERF__: boolean | undefined;

export const PERF_ENABLED = typeof __DOCX_PERF__ !== 'undefined' ? __DOCX_PERF__ : false;
