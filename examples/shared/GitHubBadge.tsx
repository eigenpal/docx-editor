import React, { useState, useEffect } from 'react';

declare const __GITHUB_STARS__: number | null;

function getBuildTimeStars(): number | null {
  try {
    return __GITHUB_STARS__;
  } catch {
    return null;
  }
}

const wrapperStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0',
  textDecoration: 'none',
  borderRadius: '8px',
  overflow: 'hidden',
  border: '1px solid #e2e8f0',
  background: '#fff',
  transition: 'box-shadow 0.2s, border-color 0.2s',
};

const repoSectionStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '6px',
  padding: '5px 10px',
  textDecoration: 'none',
  color: '#0f172a',
  fontSize: '13px',
  fontWeight: 600,
  letterSpacing: '-0.01em',
  whiteSpace: 'nowrap',
};

const starSectionStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '4px',
  padding: '5px 10px',
  textDecoration: 'none',
  color: '#0f172a',
  fontSize: '12px',
  fontWeight: 600,
  whiteSpace: 'nowrap',
  borderLeft: '1px solid #e2e8f0',
  background: '#f8fafc',
};

const githubIcon = (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
    <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
  </svg>
);

const starIcon = (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="#eab308">
    <path d="M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.719 4.192a.75.75 0 0 1-1.088.791L8 12.347l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.194L.818 6.374a.75.75 0 0 1 .416-1.28l4.21-.611L7.327.668A.75.75 0 0 1 8 .25Z" />
  </svg>
);

function formatCount(n: number): string {
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  return String(n);
}

export function GitHubBadge() {
  const [stars, setStars] = useState<number | null>(getBuildTimeStars);
  const [hovered, setHovered] = useState(false);

  useEffect(() => {
    fetch('https://api.github.com/repos/eigenpal/docx-editor')
      .then((res) => res.json())
      .then((data) => {
        if (typeof data.stargazers_count === 'number') {
          setStars(data.stargazers_count);
        }
      })
      .catch(() => {});
  }, []);

  const repoUrl = 'https://github.com/eigenpal/docx-editor';

  return (
    <span
      style={{
        ...wrapperStyle,
        boxShadow: hovered ? '0 2px 8px rgba(0,0,0,0.08)' : '0 1px 2px rgba(0,0,0,0.04)',
        borderColor: hovered ? '#cbd5e1' : '#e2e8f0',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <a href={repoUrl} target="_blank" rel="noopener noreferrer" style={repoSectionStyle}>
        {githubIcon}
        <span>eigenpal/docx-editor</span>
      </a>
      {stars !== null && (
        <a href={repoUrl} target="_blank" rel="noopener noreferrer" style={starSectionStyle}>
          {starIcon}
          <span>{formatCount(stars)}</span>
        </a>
      )}
    </span>
  );
}
