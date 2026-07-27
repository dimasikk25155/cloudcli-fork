import { randomUUID } from 'node:crypto';

import crossSpawn from 'cross-spawn';

import { sessionsService } from './modules/providers/services/sessions.service.js';
import { providerAuthService } from './modules/providers/services/provider-auth.service.js';
import { providerModelsService } from './modules/providers/services/provider-models.service.js';
import { notifyRunFailed, notifyRunStopped } from './services/notification-orchestrator.js';
import {
  createCompleteMessage,
  createNormalizedMessage,
  flattenPromptForWindowsShell,
  resolveGeminiCliPath,
} from './shared/utils.js';

// cross-spawn resolves .cmd shims/PATHEXT on Windows and delegates to
// child_process.spawn everywhere else.
const spawnFunction = crossSpawn;

const activeGeminiProcesses = new Map();

const GEMINI_INSTALL_HINT = 'Gemini CLI is not installed. Install it: npm install -g @google/gemini-cli';

/**
 * Maps a CloudCLI permission mode onto Gemini's `--approval-mode`.
 *
 * Headless runs (`gemini -p`) cannot prompt, so there is no usable equivalent
 * of Gemini's own interactive `default` mode — asking for approval with no TTY
 * would stall the run. `default` therefore maps to `auto_edit` (auto-approve
 * edit tools), which is the safest mode that still completes unattended.
 * Exported for tests only.
 */
export function resolveGeminiApprovalMode(permissionMode) {
  if (permissionMode === 'bypassPermissions') {
    return 'yolo';
  }
  if (permissionMode === 'plan') {
    return 'plan';
  }
  return 'auto_edit';
}

async function spawnGemini(command, options = {}, ws) {
  return new Promise((resolve, reject) => {
    const { sessionId, projectPath, cwd, model, permissionMode, sessionSummary } = options;
    const workingDir = cwd || projectPath || process.cwd();
    // Unlike Claude/Kimi, Gemini accepts the session UUID up front
    // (`--session-id`) instead of only reporting one back, so the id is known
    // before the process starts and never has to be scraped out of the stream.
    const resolvedSessionId = sessionId || randomUUID();
    const processKey = resolvedSessionId;
    let stdoutLineBuffer = '';
    let stderrBuffer = '';
    let terminalNotificationSent = false;
    let geminiProcess = null;
    // Unified lifecycle contract: exactly one terminal `complete` per run
    // (close and error handlers can both fire for spawn failures).
    let completeSent = false;

    const notifyTerminalState = ({ code = null, error = null } = {}) => {
      if (terminalNotificationSent) {
        return;
      }

      terminalNotificationSent = true;
      if (code === 0 && !error) {
        notifyRunStopped({
          userId: ws?.userId || null,
          provider: 'gemini',
          sessionId: resolvedSessionId,
          sessionName: sessionSummary,
          stopReason: 'completed',
        });
        return;
      }

      notifyRunFailed({
        userId: ws?.userId || null,
        provider: 'gemini',
        sessionId: resolvedSessionId,
        sessionName: sessionSummary,
        error: error || `Gemini CLI exited with code ${code}`,
      });
    };

    const processGeminiOutputLine = (line) => {
      if (!line || !line.trim()) {
        return;
      }

      let response;
      try {
        response = JSON.parse(line);
      } catch {
        ws.send(createNormalizedMessage({
          kind: 'stream_delta',
          content: line,
          sessionId: resolvedSessionId,
          provider: 'gemini',
        }));
        return;
      }

      try {
        const normalized = sessionsService.normalizeMessage('gemini', response, resolvedSessionId);
        for (const msg of normalized) {
          ws.send(msg);
        }
      } catch (error) {
        const errorContent = error instanceof Error ? error.message : String(error);
        console.error('[Gemini] Failed to process JSON output:', errorContent);
        ws.send(createNormalizedMessage({
          kind: 'error',
          content: errorContent,
          sessionId: resolvedSessionId,
          provider: 'gemini',
        }));
      }
    };

    void providerModelsService.resolveResumeModel('gemini', sessionId, model).then(async (resolvedModel) => {
      // Gemini CLI headless: `-p <prompt> -o stream-json`. Sessions live under
      // ~/.gemini/sessions keyed by the project dir, so cwd decides which
      // project a session belongs to. `-r <uuid>` resumes an existing session
      // (the flag also accepts "latest"/index, but the UUID form is what keeps
      // CloudCLI's own session ids authoritative); `--session-id <uuid>` names
      // a brand-new one so the id is deterministic from the start.
      const args = [
        '-p', flattenPromptForWindowsShell(command?.trim() || ''),
        '-o', 'stream-json',
        '--approval-mode', resolveGeminiApprovalMode(permissionMode),
      ];
      if (sessionId) {
        args.push('-r', sessionId);
      } else {
        args.push('--session-id', resolvedSessionId);
      }
      if (resolvedModel) {
        args.push('-m', resolvedModel);
      }

      geminiProcess = spawnFunction(resolveGeminiCliPath(), args, {
        cwd: workingDir,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env },
      });

      activeGeminiProcesses.set(processKey, geminiProcess);
      geminiProcess.sessionId = resolvedSessionId;
      geminiProcess.stdin.end();

      if (ws.setSessionId && typeof ws.setSessionId === 'function') {
        ws.setSessionId(resolvedSessionId);
      }

      if (!sessionId) {
        ws.send(createNormalizedMessage({
          kind: 'session_created',
          newSessionId: resolvedSessionId,
          sessionId: resolvedSessionId,
          provider: 'gemini',
        }));
      }

      geminiProcess.stdout.on('data', (data) => {
        stdoutLineBuffer += data.toString();
        const completeLines = stdoutLineBuffer.split(/\r?\n/);
        stdoutLineBuffer = completeLines.pop() || '';

        completeLines.forEach((line) => {
          processGeminiOutputLine(line.trim());
        });
      });

      geminiProcess.stderr.on('data', (data) => {
        // Gemini writes progress/telemetry noise to stderr on healthy runs too,
        // so it is buffered and only surfaced when the run actually fails.
        stderrBuffer += data.toString();
        if (stderrBuffer.length > 8192) {
          stderrBuffer = stderrBuffer.slice(-8192);
        }
      });

      geminiProcess.on('close', async (code) => {
        activeGeminiProcesses.delete(processKey);

        if (stdoutLineBuffer.trim()) {
          processGeminiOutputLine(stdoutLineBuffer.trim());
          stdoutLineBuffer = '';
        }

        if (code !== 0 && stderrBuffer.trim()) {
          ws.send(createNormalizedMessage({
            kind: 'error',
            content: stderrBuffer.trim(),
            sessionId: resolvedSessionId,
            provider: 'gemini',
          }));
        }

        // Terminal complete — skipped for aborted runs (abort-session already
        // sent the aborted complete on this run's behalf).
        if (!completeSent && !geminiProcess.aborted) {
          completeSent = true;
          ws.send(createCompleteMessage({ provider: 'gemini', sessionId: resolvedSessionId, exitCode: code }));
        }

        if (code === 0) {
          notifyTerminalState({ code });
          resolve();
          return;
        }

        if (code === 127 || code === null) {
          const installed = await providerAuthService.isProviderInstalled('gemini');
          if (!installed) {
            ws.send(createNormalizedMessage({
              kind: 'error',
              content: GEMINI_INSTALL_HINT,
              sessionId: resolvedSessionId,
              provider: 'gemini',
            }));
          }
        }

        notifyTerminalState({ code });
        reject(new Error(code === null ? 'Gemini CLI process was terminated' : `Gemini CLI exited with code ${code}`));
      });

      geminiProcess.on('error', async (error) => {
        activeGeminiProcesses.delete(processKey);

        const installed = await providerAuthService.isProviderInstalled('gemini');
        const errorContent = !installed ? GEMINI_INSTALL_HINT : error.message;

        ws.send(createNormalizedMessage({
          kind: 'error',
          content: errorContent,
          sessionId: resolvedSessionId,
          provider: 'gemini',
        }));
        if (!completeSent && !geminiProcess.aborted) {
          completeSent = true;
          ws.send(createCompleteMessage({ provider: 'gemini', sessionId: resolvedSessionId, exitCode: 1 }));
        }
        notifyTerminalState({ error });
        reject(error);
      });
    }).catch(reject);
  });
}

function abortGeminiSession(sessionId) {
  const process = activeGeminiProcesses.get(sessionId);
  if (!process) {
    return false;
  }

  // The abort handler sends the terminal complete (aborted: true); flag the
  // process so its close handler does not emit a second one.
  process.aborted = true;
  process.kill('SIGTERM');
  activeGeminiProcesses.delete(sessionId);
  return true;
}

function isGeminiSessionActive(sessionId) {
  return activeGeminiProcesses.has(sessionId);
}

function getActiveGeminiSessions() {
  return Array.from(activeGeminiProcesses.keys());
}

export {
  spawnGemini,
  abortGeminiSession,
  isGeminiSessionActive,
  getActiveGeminiSessions,
};
