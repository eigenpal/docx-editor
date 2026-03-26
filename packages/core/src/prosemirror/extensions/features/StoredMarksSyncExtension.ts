/**
 * Stored Marks Sync Extension — restores stored marks from paragraph defaults.
 */

import { createExtension } from '../create';
import type { ExtensionRuntime } from '../types';
import { createStoredMarksSyncPlugin } from '../../plugins/storedMarksSync';

export const StoredMarksSyncExtension = createExtension({
  name: 'storedMarksSync',
  onSchemaReady(): ExtensionRuntime {
    return {
      plugins: [createStoredMarksSyncPlugin()],
    };
  },
});
