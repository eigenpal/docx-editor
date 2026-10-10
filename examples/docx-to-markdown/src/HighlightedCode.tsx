import { useEffect, useState } from 'react';

type CodeLanguage = 'typescript' | 'json';

type Highlight = (code: string, language: CodeLanguage) => string;

export const MAX_HIGHLIGHTED_CODE_CHARACTERS = 300_000;

let highlightPromise: Promise<Highlight> | null = null;

function loadHighlighter(): Promise<Highlight> {
  highlightPromise ??= Promise.all([
    import('shiki/core'),
    import('shiki/engine/javascript'),
    import('shiki/dist/langs/typescript.mjs'),
    import('shiki/dist/langs/json.mjs'),
    import('shiki/dist/themes/github-light-default.mjs'),
  ]).then(async ([{ createHighlighterCore }, { createJavaScriptRegexEngine }, ts, json, theme]) => {
    const highlighter = await createHighlighterCore({
      engine: createJavaScriptRegexEngine(),
      langs: [ts.default, json.default],
      themes: [theme.default],
    });
    return (code, language) =>
      highlighter.codeToHtml(code, {
        lang: language,
        theme: 'github-light-default',
      });
  });
  return highlightPromise;
}

interface HighlightedCodeProps {
  readonly code: string;
  readonly language: CodeLanguage;
  readonly label: string;
}

interface HighlightedOutput {
  readonly code: string;
  readonly language: CodeLanguage;
  readonly html: string;
}

export function HighlightedCode({ code, language, label }: HighlightedCodeProps) {
  const [highlighted, setHighlighted] = useState<HighlightedOutput | null>(null);

  useEffect(() => {
    if (code.length > MAX_HIGHLIGHTED_CODE_CHARACTERS) {
      setHighlighted(null);
      return;
    }

    let current = true;

    void loadHighlighter()
      .then((highlight) => highlight(code, language))
      .then((html) => {
        if (current) setHighlighted({ code, language, html });
      })
      .catch(() => {
        if (current) setHighlighted(null);
      });

    return () => {
      current = false;
    };
  }, [code, language]);

  const html =
    highlighted?.code === code && highlighted.language === language ? highlighted.html : null;

  return html ? (
    <div
      className="md-highlighted-code"
      aria-label={label}
      tabIndex={0}
      // Shiki escapes source text and owns this highlighted HTML fragment.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  ) : (
    <pre className="md-highlighted-code md-highlighted-code--plain" aria-label={label} tabIndex={0}>
      <code>{code}</code>
    </pre>
  );
}
