import type { IProviderSessionSynchronizer } from '@/shared/interfaces.js';

/**
 * Gemini session indexer — inert until the on-disk session format is confirmed.
 *
 * Sessions live under ~/.gemini/sessions (the CLI groups them by project, and
 * `--session-id` lets the runner name them, so CloudCLI already owns the ids).
 * What is not yet known is the file layout, and a synchronizer that guesses
 * would write junk session rows into the database — worse than showing none.
 *
 * Returning 0 / null keeps the shared scan loop happy: Gemini simply contributes
 * nothing to the sidebar until this is implemented against a real session file.
 */
export class GeminiSessionSynchronizer implements IProviderSessionSynchronizer {
  async synchronize(_since?: Date): Promise<number> {
    return 0;
  }

  async synchronizeFile(_filePath: string): Promise<string | null> {
    return null;
  }
}
