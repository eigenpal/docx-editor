import { Children, Fragment, isValidElement, type ReactElement, type ReactNode } from 'react';

/** Flatten slot/default children like React Children.toArray, including Fragment nesting. */
export function flattenChildren(children: ReactNode): ReactNode[] {
  const out: ReactNode[] = [];
  Children.forEach(children, (child) => {
    if (child == null || child === false) return;
    if (isValidElement(child) && child.type === Fragment) {
      out.push(
        ...flattenChildren((child as ReactElement<{ children?: ReactNode }>).props.children)
      );
      return;
    }
    out.push(child);
  });
  return out;
}
