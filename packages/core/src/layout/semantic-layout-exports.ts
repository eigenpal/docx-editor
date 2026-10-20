export { createFixedMeasurer } from './fixed-measurer.ts';
// Boundary records live in their own module; the editor facade and tests import them here.
export {
  attachContentControlBoundaries,
  contentControlContextToken,
} from './content-control-boundary-layout.ts';
export type { ContentControlBoundaryWork } from './content-control-boundary-layout.ts';
