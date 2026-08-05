// The rail's two decisions, in the theme's drawing language. These replace the packaged tick
// and cross through the parts' `icon` prop; nothing else about either button changes.

import { Frost } from './Frost';

/** Accept: let it melt into the document. */
export const IceMelt = (
  <Frost>
    <path d="M5 6h14" />
    <path d="M12 10c2.6 3.2 4.2 5.2 4.2 7.1A4.2 4.2 0 0 1 7.8 17c0-1.9 1.6-3.9 4.2-7Z" />
  </Frost>
);

/** Reject: refreeze it the way it was. */
export const IceRefreeze = (
  <Frost>
    <path d="M12 3v18M4.5 7.5l15 9M19.5 7.5l-15 9" />
    <path d="M9 5.5 12 3l3 2.5M9 18.5 12 21l3-2.5" />
  </Frost>
);
