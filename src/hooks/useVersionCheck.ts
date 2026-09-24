import { useCallback, useEffect, useState } from 'react';

import { version } from '../../package.json';
import { authenticatedFetch } from '../utils/api';

export type InstallMode = 'git' | 'npm';
export type UpstreamReport = {
  checkedAt?: string;
  lastSuccessfulCheckAt?: string | null;
  status?: 'ok' | 'error';
  stale?: boolean;
  error?: string | null;
  checking?: boolean;
  checkNotice?: string;
  approvalRequired: true;
  fork?: { sha: string; version: string; branch: string; dirty: boolean };
  release?: { tag: string; sha: string; url: string; publishedAt?: string; notes: string };
  upstream?: { sha: string; url: string; date?: string };
  changes?: {
    ancestry: { forkOnly: number; upstreamOnly: number; mergeBase: string } | null;
    comparedFrom: string;
    totalCommits: number;
    candidates: { sha: string; subject: string; url: string; coverage: string }[];
    overlap: string[];
    fileCount: number;
    risks: string[];
  };
  reviewedProposal?: {
    reviewedAt: string; forkSha: string; upstreamSha: string; method: string; needsReview: boolean;
    firstBatch: { sha: string; title: string; coverage: string; risk: string }[];
    secondBatch: { sha: string; title: string; coverage: string; risk: string }[];
    partial: string; alreadyPresent: string[];
  };
  nextStep?: string;
};

let healthRequest: Promise<{ version?: string; installMode?: InstallMode }> | undefined;

// Upstream is read only, opt-in for the admin About screen. Sidebar only needs /health.
export const useVersionCheck = (_owner: string, _repo: string, readUpstream = false) => {
  const [report, setReport] = useState<UpstreamReport | null>(null);
  const [checking, setChecking] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [installMode, setInstallMode] = useState<InstallMode>('git');
  const [runningVersion, setRunningVersion] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    healthRequest ??= fetch('/health').then(async response => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    }).finally(() => { healthRequest = undefined; });
    void healthRequest.then(data => {
      if (!active) return;
      if (data.installMode === 'npm' || data.installMode === 'git') setInstallMode(data.installMode);
      if (typeof data.version === 'string') setRunningVersion(data.version);
    }).catch(error => { if (active) setHealthError(`Не удалось проверить версию сервера: ${error.message}`); });
    return () => { active = false; };
  }, []);

  const loadReport = useCallback(async (refresh = false) => {
    if (!readUpstream) return;
    setChecking(true);
    setReportError(null);
    try {
      const response = await authenticatedFetch(`/api/system/upstream${refresh ? '/check' : ''}`, {
        method: refresh ? 'POST' : 'GET',
      });
      const data = await response.json() as UpstreamReport | null;
      // A failed remote check (502) still contains the last good persisted report.
      if (!response.ok && !data?.status) throw new Error(data?.error || `HTTP ${response.status}`);
      setReport(data);
      setReportError(data?.error ?? null);
    } catch (error) {
      setReportError(error instanceof Error ? error.message : 'Не удалось получить отчёт upstream.');
    } finally {
      setChecking(false);
    }
  }, [readUpstream]);

  useEffect(() => {
    void loadReport();
    const onFocus = () => { void loadReport(); };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [loadReport]);

  return {
    report, checking, reportError, healthError, checkUpstream: () => loadReport(true),
    currentVersion: version, installMode, runningVersion,
    restartRequired: runningVersion !== null && runningVersion !== version,
  };
};
