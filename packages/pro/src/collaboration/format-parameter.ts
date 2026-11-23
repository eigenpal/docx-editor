/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { COLLABORATION_FORMAT_VERSION } from './document-format.ts';

/**
 * The query parameter in which a Hocuspocus client names its collaboration format.
 *
 * `createHocuspocusCollaboration` and the provider hooks add it to the server URL, with
 * `COLLABORATION_FORMAT_VERSION` as its value. A server reads it from `requestParameters`
 * in `onAuthenticate`; `collaborationServerExtension` does that for you.
 *
 * @public
 */
export const COLLABORATION_FORMAT_PARAMETER = 'collaborationFormat';

/**
 * `url` with this build's collaboration format as a query parameter.
 *
 * The provider removes trailing slashes from the URL it is given. With a query string the
 * path no longer ends the URL, so the slashes are removed here: the server sees the same
 * path with and without the parameter. A parameter of the same name that the URL already
 * holds is replaced, because the format is this build's and not the caller's to choose.
 *
 * A URL that does not parse is returned as it is: the provider reports it.
 */
export function withCollaborationFormatParameter(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  let path = parsed.pathname;
  while (path.endsWith('/')) path = path.slice(0, -1);
  parsed.pathname = path;
  parsed.searchParams.set(COLLABORATION_FORMAT_PARAMETER, COLLABORATION_FORMAT_VERSION);
  return parsed.toString();
}
