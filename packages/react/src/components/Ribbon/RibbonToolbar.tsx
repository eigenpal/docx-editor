import type { RibbonProps } from './Ribbon';
import { Ribbon } from './Ribbon';

export type RibbonToolbarProps = RibbonProps;

export function RibbonToolbar(props: RibbonToolbarProps) {
  return <Ribbon {...props} />;
}

export default RibbonToolbar;
