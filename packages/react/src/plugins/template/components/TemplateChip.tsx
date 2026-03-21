/**
 * TemplateChip — sidebar card for a template tag.
 * Rendered inside the UnifiedSidebar via getSidebarItems.
 */

// TemplateChip uses React.createElement in template/index.ts, so no direct JSX import needed here
import type { SidebarItemRenderProps } from '../../../plugin-api/types';
import type { TemplateTag, TagType } from '../prosemirror-plugin';

const COLORS: Record<TagType, string> = {
  variable: '#f59e0b',
  sectionStart: '#3b82f6',
  sectionEnd: '#3b82f6',
  invertedStart: '#8b5cf6',
  raw: '#ef4444',
};

function getLabel(type: TagType): string {
  switch (type) {
    case 'sectionStart':
      return 'LOOP / IF';
    case 'invertedStart':
      return 'IF NOT';
    case 'raw':
      return 'HTML';
    default:
      return '';
  }
}

export interface TemplateChipProps extends SidebarItemRenderProps {
  tag: TemplateTag;
  isHovered: boolean;
  onHover: (id: string | undefined) => void;
  onSelect: (id: string) => void;
}

/** CSS for template chips in the sidebar. */
export const TEMPLATE_CHIP_STYLES = `
.template-annotation-chip {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  padding: 5px 10px;
  background: white;
  border: 1px solid #e2e8f0;
  border-left: 3px solid #6c757d;
  border-radius: 4px;
  font-size: 11px;
  cursor: pointer;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
  max-width: 200px;
}

.template-annotation-chip:hover,
.template-annotation-chip.hovered {
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.1);
  border-color: #cbd5e1;
}

.template-annotation-chip.selected {
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.5);
}

.template-chip-badge {
  font-size: 9px;
  font-weight: 600;
  padding: 1px 5px;
  border-radius: 3px;
  color: white;
  text-transform: uppercase;
  letter-spacing: 0.3px;
}

.template-chip-dot {
  font-size: 8px;
}

.template-chip-name {
  color: #334155;
  font-weight: 500;
}

.template-chip-nested {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  width: 100%;
  margin-top: 4px;
  padding-top: 4px;
  border-top: 1px solid rgba(0, 0, 0, 0.06);
}

.template-nested-var {
  font-size: 10px;
  color: #64748b;
  background: rgba(0, 0, 0, 0.04);
  padding: 2px 6px;
  border-radius: 3px;
}

.template-nested-var:hover {
  background: rgba(59, 130, 246, 0.15);
  color: #1e40af;
}
`;

export function TemplateChip({ tag, isHovered, measureRef, onHover, onSelect }: TemplateChipProps) {
  const label = getLabel(tag.type);
  const color = COLORS[tag.type];
  const isSection = tag.type === 'sectionStart' || tag.type === 'invertedStart';

  return (
    <div ref={measureRef} style={{ display: 'flex', alignItems: 'flex-start' }}>
      {/* Connector line */}
      <div
        style={{
          width: 20,
          height: 1,
          background: isHovered ? '#3b82f6' : '#d0d0d0',
          marginTop: 12,
          marginRight: 4,
          flexShrink: 0,
        }}
      />
      <div
        className={`template-annotation-chip ${isHovered ? 'hovered' : ''}`}
        style={{ borderLeftColor: color }}
        onMouseEnter={() => onHover(tag.id)}
        onMouseLeave={() => onHover(undefined)}
        onClick={(e) => {
          e.stopPropagation();
          onSelect(tag.id);
        }}
        onMouseDown={(e) => e.stopPropagation()}
        title={
          isSection
            ? `${tag.rawTag}\nIterates over ${tag.name}[]. Access nested properties via ${tag.name}.property`
            : tag.rawTag
        }
      >
        {label && (
          <span className="template-chip-badge" style={{ background: color }}>
            {label}
          </span>
        )}
        {!label && (
          <span className="template-chip-dot" style={{ color }}>
            ●
          </span>
        )}
        <span className="template-chip-name">{tag.name}</span>

        {isSection && tag.nestedVars && tag.nestedVars.length > 0 && (
          <div className="template-chip-nested">
            {tag.nestedVars.map((v, i) => (
              <span key={i} className="template-nested-var" title={`Access: ${tag.name}.${v}`}>
                {v.includes('.') ? v.split('.').pop() : v}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
