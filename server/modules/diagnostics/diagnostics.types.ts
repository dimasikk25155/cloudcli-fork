export type CheckStatus = 'ok' | 'warn' | 'fail' | 'unknown';

export type DoctorCheck = {
  id: string;
  title: string;
  status: CheckStatus;
  detail: string;
};

export type DoctorReport = {
  checks: DoctorCheck[];
  generatedAt: string;
};

export type SkillIssueKind = 'duplicate' | 'no_description' | 'broken_link' | 'conflict';

export type SkillIssue = {
  kind: SkillIssueKind;
  skill: string;
  detail: string;
};

export type SkillInfo = {
  dir: string;
  name: string;
  source: 'claude' | 'codex';
  hasDescription: boolean;
};

export type SkillReport = {
  skills: SkillInfo[];
  issues: SkillIssue[];
  generatedAt: string;
};

export type ExecResult = { code: number | null; stdout: string; stderr: string };

/** Runs a program with an argument array (never through a shell). */
export type DiagExec = (command: string, args: string[], options?: { timeoutMs?: number }) => Promise<ExecResult>;

/** The slice of the file system the checks read. Everything is read-only. */
export type DiagFs = {
  readFile(path: string): Promise<string>;
  /** Entry names of a directory; rejects when it cannot be read. */
  readdir(path: string): Promise<string[]>;
  isDirectory(path: string): Promise<boolean>;
  exists(path: string): Promise<boolean>;
  /** Resolved real path (symlinks followed). */
  realpath(path: string): Promise<string>;
  /** Size in bytes, null when the file is missing. */
  fileSize(path: string): Promise<number | null>;
};
