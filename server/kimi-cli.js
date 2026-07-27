import crossSpawn from 'cross-spawn';

import { sessionsService } from './modules/providers/services/sessions.service.js';
import { providerAuthService } from './modules/providers/services/provider-auth.service.js';
import { providerModelsService } from './modules/providers/services/provider-models.service.js';
import { notifyRunFailed, notifyRunStopped } from './services/notification-orchestrator.js';
import {
  createCompleteMessage,
  createNormalizedMessage,
  flattenPromptForWindowsShell,
  resolveKimiCliPath,
} from './shared/utils.js';

// cross-spawn resolves .cmd shims/PATHEXT on Windows and delegates to
// child_process.spawn everywhere else.
const spawnFunction = crossSpawn;

const activeKimiProcesses = new Map();

/**
 * Kimi Code's headless mode (`kimi -p`) always auto-approves tool calls — and
 * actively rejects every permission flag (`--yolo`, `--auto`, `--yes`,
 * `--plan` all error out with "Cannot combine --prompt with ...", verified on
 * 0.29.0). So the UI permission mode is intentionally NOT mapped: headless
 * runs are always fully autonomous. Exported for tests only.
 */
export function resolveKimiPermissionOptions(_permissionMode) {
  return { args: [], env: {} };
}

function readKimiSessionId(event) {
  if (!event || typeof event !== 'object') {
    return null;
  }

  // The end-of-run meta line: {"role":"meta","type":"session.resume_hint",
  // "session_id":"session_<uuid>", ...}. Mid-run events carry no session id.
  if (event.role === 'meta' && typeof event.session_id === 'string') {
    return event.session_id;
  }

  return null;
}

async function spawnKimi(command, options = {}, ws) {
  return new Promise((resolve, reject) => {
    const { sessionId, projectPath, cwd, model, sessionSummary } = options;
    const workingDir = cwd || projectPath || process.cwd();
    const processKey = sessionId || Date.now().toString();
    let capturedSessionId = sessionId || null;
    let sessionCreatedSent = false;
    let stdoutLineBuffer = '';
    let stderrBuffer = '';
    let terminalNotificationSent = false;
    let kimiProcess = null;
    // Unified lifecycle contract: exactly one terminal `complete` per run
    // (close and error handlers can both fire for spawn failures).
    let completeSent = false;

    const notifyTerminalState = ({ code = null, error = null } = {}) => {
      if (terminalNotificationSent) {
        return;
      }

      terminalNotificationSent = true;
      const finalSessionId = capturedSessionId || sessionId || processKey;
      if (code === 0 && !error) {
        notifyRunStopped({
          userId: ws?.userId || null,
          provider: 'kimi',
          sessionId: finalSessionId,
          sessionName: sessionSummary,
          stopReason: 'completed',
        });
        return;
      }

      notifyRunFailed({
        userId: ws?.userId || null,
        provider: 'kimi',
        sessionId: finalSessionId,
        sessionName: sessionSummary,
        error: error || `Kimi Code CLI exited with code ${code}`,
      });
    };

    const registerSession = (nextSessionId) => {
      if (!nextSessionId || capturedSessionId === nextSessionId) {
        return;
      }

      capturedSessionId = nextSessionId;
      if (processKey !== capturedSessionId && kimiProcess) {
        activeKimiProcesses.delete(processKey);
        activeKimiProcesses.set(capturedSessionId, kimiProcess);
      }
      if (kimiProcess) {
        kimiProcess.sessionId = capturedSessionId;
      }

      if (ws.setSessionId && typeof ws.setSessionId === 'function') {
        ws.setSessionId(capturedSessionId);
      }

      if (!sessionId && !sessionCreatedSent) {
        sessionCreatedSent = true;
        ws.send(createNormalizedMessage({
          kind: 'session_created',
          newSessionId: capturedSessionId,
          sessionId: capturedSessionId,
          provider: 'kimi',
        }));
      }
    };

    const processKimiOutputLine = (line) => {
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
          sessionId: capturedSessionId || sessionId || null,
          provider: 'kimi',
        }));
        return;
      }

      try {
        registerSession(readKimiSessionId(response));
        const normalized = sessionsService.normalizeMessage(
          'kimi',
          response,
          capturedSessionId || sessionId || null,
        );
        for (const msg of normalized) {
          ws.send(msg);
        }
      } catch (error) {
        const errorContent = error instanceof Error ? error.message : String(error);
        console.error('[Kimi] Failed to process JSON output:', errorContent);
        ws.send(createNormalizedMessage({
          kind: 'error',
          content: errorContent,
          sessionId: capturedSessionId || sessionId || null,
          provider: 'kimi',
        }));
      }
    };

    void providerModelsService.resolveResumeModel('kimi', sessionId, model).then(async (resolvedModel) => {
      // Kimi Code CLI: headless = `-p <prompt> --output-format stream-json`.
      // Sessions are keyed by the process cwd (the CLI groups them by work
      // dir), so spawning with cwd=workingDir is what puts the session under
      // the right project. `-r <id>` resumes; `-m <alias>` picks the model
      // (aliases from config.toml, e.g. kimi-code/k3). No permission flags —
      // headless auto-approves and rejects them (see resolveKimiPermissionOptions).
      const args = ['-p', flattenPromptForWindowsShell(command?.trim() || ''), '--output-format', 'stream-json'];
      if (sessionId) {
        args.push('-r', sessionId);
      }
      if (resolvedModel) {
        args.push('-m', resolvedModel);
      }

      kimiProcess = spawnFunction(resolveKimiCliPath(), args, {
        cwd: workingDir,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env },
      });

      activeKimiProcesses.set(processKey, kimiProcess);
      kimiProcess.sessionId = processKey;
      kimiProcess.stdin.end();

      kimiProcess.stdout.on('data', (data) => {
        stdoutLineBuffer += data.toString();
        const completeLines = stdoutLineBuffer.split(/\r?\n/);
        stdoutLineBuffer = completeLines.pop() || '';

        completeLines.forEach((line) => {
          processKimiOutputLine(line.trim());
        });
      });

      kimiProcess.stderr.on('data', (data) => {
        // Kimi mirrors tool output and progress noise to stderr even on
        // healthy runs, so it is NOT streamed to the UI as errors — it is
        // buffered and only surfaced if the run actually fails.
        stderrBuffer += data.toString();
        if (stderrBuffer.length > 8192) {
          stderrBuffer = stderrBuffer.slice(-8192);
        }
      });

      kimiProcess.on('close', async (code) => {
        const finalSessionId = capturedSessionId || sessionId || processKey;
        activeKimiProcesses.delete(finalSessionId);
        activeKimiProcesses.delete(processKey);

        if (stdoutLineBuffer.trim()) {
          processKimiOutputLine(stdoutLineBuffer.trim());
          stdoutLineBuffer = '';
        }

        if (code !== 0 && stderrBuffer.trim()) {
          ws.send(createNormalizedMessage({
            kind: 'error',
            content: stderrBuffer.trim(),
            sessionId: finalSessionId,
            provider: 'kimi',
          }));
        }

        // Terminal complete — skipped for aborted runs (abort-session
        // already sent the aborted complete on this run's behalf).
        if (!completeSent && !kimiProcess.aborted) {
          completeSent = true;
          ws.send(createCompleteMessage({ provider: 'kimi', sessionId: finalSessionId, exitCode: code }));
        }

        if (code === 0) {
          notifyTerminalState({ code });
          resolve();
          return;
        }

        if (code === 127 || code === null) {
          const installed = await providerAuthService.isProviderInstalled('kimi');
          if (!installed) {
            ws.send(createNormalizedMessage({
              kind: 'error',
              content: 'Kimi Code CLI is not installed. Install it: curl -fsSL https://code.kimi.com/kimi-code/install.sh | bash',
              sessionId: finalSessionId,
              provider: 'kimi',
            }));
          }
        }

        notifyTerminalState({ code });
        reject(new Error(code === null ? 'Kimi Code CLI process was terminated' : `Kimi Code CLI exited with code ${code}`));
      });

      kimiProcess.on('error', async (error) => {
        const finalSessionId = capturedSessionId || sessionId || processKey;
        activeKimiProcesses.delete(finalSessionId);
        activeKimiProcesses.delete(processKey);

        const installed = await providerAuthService.isProviderInstalled('kimi');
        const errorContent = !installed
          ? 'Kimi Code CLI is not installed. Install it: curl -fsSL https://code.kimi.com/kimi-code/install.sh | bash'
          : error.message;

        ws.send(createNormalizedMessage({
          kind: 'error',
          content: errorContent,
          sessionId: finalSessionId,
          provider: 'kimi',
        }));
        if (!completeSent && !kimiProcess.aborted) {
          completeSent = true;
          ws.send(createCompleteMessage({ provider: 'kimi', sessionId: finalSessionId, exitCode: 1 }));
        }
        notifyTerminalState({ error });
        reject(error);
      });
    }).catch(reject);
  });
}

function abortKimiSession(sessionId) {
  const process = activeKimiProcesses.get(sessionId);
  if (!process) {
    return false;
  }

  // The abort handler sends the terminal complete (aborted: true); flag the
  // process so its close handler does not emit a second one.
  process.aborted = true;
  process.kill('SIGTERM');
  activeKimiProcesses.delete(sessionId);
  return true;
}

function isKimiSessionActive(sessionId) {
  return activeKimiProcesses.has(sessionId);
}

function getActiveKimiSessions() {
  return Array.from(activeKimiProcesses.keys());
}

export {
  spawnKimi,
  abortKimiSession,
  isKimiSessionActive,
  getActiveKimiSessions,
};
