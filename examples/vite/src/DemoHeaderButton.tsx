import type { ButtonHTMLAttributes, MouseEvent } from 'react';
import { DEMO_PRIMARY_BUTTON, DEMO_SECONDARY_BUTTON, keepCaret } from './demoButtons';

export interface DemoHeaderButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: 'primary' | 'secondary';
  readonly keepEditorCaret?: boolean;
}

/** One visual and focus contract for every action in the demo header. */
export function DemoHeaderButton({
  variant = 'secondary',
  keepEditorCaret = true,
  className,
  onMouseDown,
  style,
  ...props
}: DemoHeaderButtonProps) {
  const handleMouseDown = (event: MouseEvent<HTMLButtonElement>) => {
    if (keepEditorCaret) keepCaret(event);
    onMouseDown?.(event);
  };
  return (
    <button
      {...props}
      type="button"
      className={`demo-header-action${className ? ` ${className}` : ''}`}
      style={{
        ...(variant === 'primary' ? DEMO_PRIMARY_BUTTON : DEMO_SECONDARY_BUTTON),
        ...style,
      }}
      onMouseDown={handleMouseDown}
    />
  );
}
