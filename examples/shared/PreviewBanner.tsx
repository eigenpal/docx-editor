export function PreviewBanner() {
  return (
    <div
      role="status"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '8px',
        padding: '6px 16px',
        background: '#fef3c7',
        color: '#92400e',
        borderBottom: '1px solid #fde68a',
        fontSize: '13px',
        fontWeight: 500,
        flexShrink: 0,
      }}
    >
      <span>
        This is a <strong>preview deployment</strong>. The released editor lives at
      </span>
      <a
        href="https://docx-editor.dev"
        target="_blank"
        rel="noopener"
        style={{ color: '#92400e', textDecoration: 'underline', textDecorationColor: '#fcd34d' }}
      >
        docx-editor.dev ↗
      </a>
    </div>
  );
}
