// The one development check for adapter warnings.
//
// Two build systems answer it. Vite replaces `import.meta.env` with an object whose `DEV` is
// true in development and false in a production build, and leaves `process` undefined in the
// browser. Webpack, Rollup with a replace plugin, and Node answer through
// `process.env.NODE_ENV`, which they replace with a literal at build time, so that member
// chain is spelled exactly: optional chaining (`process.env?.NODE_ENV`) is a different
// expression and is not replaced. Where neither answers, the build counts as production: a
// warning that prints for end users is the worse failure.

/** What the two build systems expose, read without assuming either exists. */
export interface DevelopmentSignals {
  /** `import.meta.env`, when the bundler provides one. */
  readonly viteEnv: { readonly DEV?: unknown } | undefined;
  /** `process.env.NODE_ENV`, or undefined where there is no `process`. */
  readonly nodeEnv: string | undefined;
  /** Whether a `process` global exists at all. */
  readonly hasProcess: boolean;
}

/** Decide from the signals: Vite's flag when it is a boolean, else the Node convention. */
export function developmentFrom(signals: DevelopmentSignals): boolean {
  const dev = signals.viteEnv?.DEV;
  if (typeof dev === 'boolean') return dev;
  return signals.hasProcess && signals.nodeEnv !== 'production';
}

function viteEnv(): DevelopmentSignals['viteEnv'] {
  try {
    return (import.meta as { readonly env?: { readonly DEV?: unknown } }).env;
  } catch {
    return undefined;
  }
}

/** True in a development build, false in production and where nothing says otherwise. */
export function isDevelopment(): boolean {
  const hasProcess = typeof process !== 'undefined';
  return developmentFrom({
    viteEnv: viteEnv(),
    nodeEnv: hasProcess ? process.env.NODE_ENV : undefined,
    hasProcess,
  });
}
