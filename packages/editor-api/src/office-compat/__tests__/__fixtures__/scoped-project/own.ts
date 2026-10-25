// The project's own file: one type error, and an import of a file the project does not include.
import { fromDependency } from './dependency';

export const ownError: string = 1;
export const used: number = fromDependency;
