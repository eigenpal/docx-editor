// NOTICE: vendored from shadcn/ui (https://ui.shadcn.com/r/styles/new-york/separator.json), MIT
// License, Copyright (c) 2023 shadcn. Installed with `shadcn add @extend/pdf-viewer`.
'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { Separator as SeparatorPrimitive } from 'radix-ui';

function Separator({
  className,
  orientation = 'horizontal',
  decorative = true,
  ...props
}: React.ComponentProps<typeof SeparatorPrimitive.Root>) {
  return (
    <SeparatorPrimitive.Root
      data-slot="separator"
      decorative={decorative}
      orientation={orientation}
      className={cn(
        'shrink-0 bg-border data-[orientation=horizontal]:h-px data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full data-[orientation=vertical]:w-px',
        className
      )}
      {...props}
    />
  );
}

export { Separator };
