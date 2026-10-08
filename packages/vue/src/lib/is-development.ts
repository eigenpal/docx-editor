// The one development check for adapter warnings.
//
// A bundler replaces `process.env.NODE_ENV` with a literal at build time, so the check must
// spell that member chain exactly: optional chaining (`process.env?.NODE_ENV`) is a different
// expression and is not replaced. A browser bundle without that replacement has no
// `process`, and it counts as production: a warning that prints for end users is the worse
// failure.

/** True in a development build, false in production and where `process` does not exist. */
export function isDevelopment(): boolean {
  return typeof process !== 'undefined' && process.env.NODE_ENV !== 'production';
}
