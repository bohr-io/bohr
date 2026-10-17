/** Exit codes of every command, documented in the README and `bohr --help`. */
export const EXIT = {
  ok: 0,
  /** The deploy or a call to the instance failed. */
  error: 1,
  /** Unknown command or option, or options that do not go together. */
  usage: 2,
  /** Not signed in, or the token was rejected (expired, revoked). */
  auth: 3,
  /** No such project for this token, or this folder is not a bohr v2 project (bohr v1 repositories included). */
  notFound: 4,
  /**
   * Not allowed: production without the owner role, a project in its owner's Cloudflare account without the owner
   * role, a suspended project, a folder whose Worker is not the project's.
   */
  notAllowed: 5,
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

/** An error the CLI reports as is: its message, a stable code for --json and the exit code. */
export class CliError extends Error {
  constructor(
    message: string,
    readonly exitCode: ExitCode = EXIT.error,
    /** Machine-readable, for --json: "not_signed_in", "not_a_v2_project", "own_account"… */
    readonly code = 'error',
  ) {
    super(message);
    this.name = 'CliError';
  }
}

/** The exit code for an HTTP status the instance answered. */
export function exitCodeForStatus(status: number): ExitCode {
  if (status === 401) return EXIT.auth;
  if (status === 403) return EXIT.notAllowed;
  if (status === 404) return EXIT.notFound;
  return EXIT.error;
}
