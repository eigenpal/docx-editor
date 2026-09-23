// These rules check common prose problems. They do not establish full style compliance.
export function proseLines(markdown) {
  let fence;
  let frontmatter = false;
  let comment = false;
  return markdown.split('\n').map((source, index) => {
    if (index === 0 && source === '---') {
      frontmatter = true;
      return '';
    }
    if (frontmatter) {
      if (source === '---') frontmatter = false;
      return '';
    }
    const marker = source.match(/^\s*(`{3,}|~{3,})/);
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length) {
        fence = undefined;
      }
      return '';
    }
    if (marker) {
      fence = marker[1];
      return '';
    }
    let line = '';
    for (let offset = 0; offset < source.length; ) {
      if (comment) {
        const end = source.indexOf('-->', offset);
        if (end < 0) break;
        comment = false;
        offset = end + 3;
      } else {
        const start = source.indexOf('<!--', offset);
        line += source.slice(offset, start < 0 ? undefined : start);
        if (start < 0) break;
        comment = true;
        offset = start + 4;
      }
    }
    return line
      .replace(/(`+)[\s\S]*?\1/g, 'CODE')
      .replace(/<[^>]*>/g, ' ')
      .replace(/[<>]/g, ' ')
      .replace(/\]\([^)]*\)/g, ']')
      .replace(/https?:\/\/\S+/g, 'URL');
  });
}

export function checkDocsStyle(markdown) {
  const lines = proseLines(markdown);
  const problems = [];
  const text = lines.join('\n');
  const rules = [
    {
      pattern: /\b(simply|obviously|easily|seamlessly|currently)\b/gi,
      message: 'State the behavior without filler or relative time.',
    },
    {
      pattern: /\b(as\s+of\s+this\s+writing|out\s+of\s+the\s+box)\b/gi,
      message: 'Use a direct, timeless description.',
    },
    {
      pattern: /(?<!!)\[(click here|here|this article)\]/gi,
      message: 'Use descriptive link text.',
    },
    {
      pattern: /!\[\s*\]/g,
      message: 'Describe the image in its alt text.',
    },
  ];
  for (const { pattern, message } of rules) {
    for (const match of text.matchAll(pattern)) {
      problems.push({
        line: text.slice(0, match.index).split('\n').length,
        message: `${message} Found: ${match[0]}`,
      });
    }
  }
  return problems;
}

export function checkPackageReadme(markdown, manifest) {
  const lines = proseLines(markdown);
  const title = lines.findIndex((line) => /^#\s+\S/.test(line));
  const lead = lines.slice(title + 1).find((line) => line.trim());
  const problems = [];
  if (title < 0) problems.push('Add an H1 title.');
  if (!lead || /^(?:#|[-*]|\|)/.test(lead)) {
    problems.push('Add a purpose paragraph after the title.');
  }
  if (!markdown.includes(manifest.name)) problems.push(`Name the package: ${manifest.name}.`);
  if (manifest.private !== true) {
    const commands = [...markdown.matchAll(/(?:npm|bun|pnpm) (?:install|add) ([^\n]+)/g)];
    if (!commands.some((match) => match[1].split(/\s+/).includes(manifest.name))) {
      problems.push('Add an installation command for the package.');
    }
  }
  return problems;
}
