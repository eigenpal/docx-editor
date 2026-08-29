const TAB_RUN_CONTENTS = [
  '',
  '<w:tab/>',
  '<w:tab/><w:tab/>',
  '<w:tab/><w:tab/><w:tab/>',
  '<w:tab/><w:tab/><w:tab/><w:tab/>',
  '<w:tab/><w:tab/><w:tab/><w:tab/><w:tab/>',
  '<w:tab/><w:tab/><w:tab/><w:tab/><w:tab/><w:tab/>',
  '<w:tab/><w:tab/><w:tab/><w:tab/><w:tab/><w:tab/><w:tab/>',
  '<w:tab/><w:tab/><w:tab/><w:tab/><w:tab/><w:tab/><w:tab/><w:tab/>',
] as const;

/** Map Word's bounded `mso-tab-count` to semantic tab elements. */
export function htmlTabRunContents(raw: string | undefined): string {
  if (raw === undefined || !/^\d$/.test(raw.trim())) return '';
  return TAB_RUN_CONTENTS[Number.parseInt(raw, 10)] ?? '';
}

/** Map Word's closed positional-tab attributes to a semantic `w:ptab`. */
export function htmlPositionalTabXml(element: Element): string {
  const alignment = element.getAttribute('alignment')?.trim().toLowerCase();
  const relativeTo = element.getAttribute('relativeto')?.trim().toLowerCase();
  const leader = element.getAttribute('leader')?.trim().toLowerCase();
  if (alignment !== 'left' && alignment !== 'center' && alignment !== 'right') return '';
  if (relativeTo !== 'margin' && relativeTo !== 'indent') return '';
  if (
    leader !== 'none' &&
    leader !== 'dot' &&
    leader !== 'hyphen' &&
    leader !== 'underscore' &&
    leader !== 'middledot'
  ) {
    return '';
  }
  const normalizedLeader = leader === 'middledot' ? 'middleDot' : leader;
  return (
    `<w:ptab w:alignment="${alignment}" ` +
    `w:relativeTo="${relativeTo}" w:leader="${normalizedLeader}"/>`
  );
}
