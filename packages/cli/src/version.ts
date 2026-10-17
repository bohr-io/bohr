import packageJson from '../package.json' with { type: 'json' };

/** The CLI's version (package.json), bundled into dist/bohr.mjs. */
export const CLI_VERSION: string = packageJson.version;
