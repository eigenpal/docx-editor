// Changelog generator for `changeset version`.
//
// Release lines match the default generator. Dependency updates collapse to
// one line per package: every published package is in one fixed group, so the
// default "Updated dependencies [sha]" line per changeset repeats the release
// notes of the dependency once for each dependent package.
//
// The module imports nothing, so a release-plan fixture can copy it as is.

/** @type {import('@changesets/types').ChangelogFunctions} */
const changelogFunctions = {
  getReleaseLine: async (changeset) => {
    const [firstLine, ...futureLines] = changeset.summary.split('\n').map((l) => l.trimEnd());
    const commit = changeset.commit ? `${changeset.commit.slice(0, 7)}: ` : '';
    let line = `- ${commit}${firstLine}`;
    if (futureLines.length > 0) line += `\n${futureLines.map((l) => `  ${l}`).join('\n')}`;
    return line;
  },
  getDependencyReleaseLine: async (_changesets, dependenciesUpdated) => {
    if (dependenciesUpdated.length === 0) return '';
    const names = dependenciesUpdated
      .map((dependency) => `${dependency.name}@${dependency.newVersion}`)
      .sort();
    return `- Updated dependencies: ${names.join(', ')}`;
  },
};

export default changelogFunctions;
