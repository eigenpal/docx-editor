// Page-specific header stories. Weak ownership keeps internal pagination state out of the API.
import type { HeaderFooterStoryLayout } from './hf-layout.ts';
import type { PageFurniture, HeaderFooterVariantName } from './page-furniture-insets.ts';

interface HeaderPages {
  readonly token: string;
  readonly resolve: (
    variant: HeaderFooterVariantName,
    index: number
  ) => HeaderFooterStoryLayout | undefined;
}
const pages = new WeakMap<object, HeaderPages>();
export function registerCharacterHeaderPages(furniture: PageFurniture, value: HeaderPages): void {
  pages.set(furniture, value);
}
export function characterHeaderPageToken(furniture: object): string {
  return pages.get(furniture)?.token ?? '';
}
export function headerStoryForPage(
  furniture: PageFurniture | undefined,
  variant: HeaderFooterVariantName,
  index: number
): HeaderFooterStoryLayout | undefined {
  return (
    furniture && (pages.get(furniture)?.resolve(variant, index) ?? furniture.headers.get(variant))
  );
}
