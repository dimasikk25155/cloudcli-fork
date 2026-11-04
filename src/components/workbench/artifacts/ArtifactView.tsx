import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { GitCompare, History, Loader2, MessageSquarePlus, MessagesSquare, RefreshCw, RotateCcw, Send, SquareDashedMousePointer } from 'lucide-react';

import {
  describeArtifactAnchor,
  isJevReportPath,
  isTextArtifactPath,
  type ArtifactAnchor,
  type ArtifactComment,
  type ArtifactDetail,
  type ArtifactVersion,
} from '../../../../shared/artifacts';
import { sendToComposer } from '../../../utils/composerDraft';
import { Markdown } from '../../chat/view/subcomponents/Markdown';
import CodeEditorHtmlPreview from '../../code-editor/view/subcomponents/CodeEditorHtmlPreview';
import { useHtmlPreview } from '../../code-editor/hooks/useHtmlPreview';
import { openWorkbenchTab } from '../useWorkbench';
import type { WorkbenchRenderContext } from '../workbenchTabs';

import { commentStatusLabel, commentsWithRect, formatBytes, sendTarget, versionSourceLabel, type FractionRect } from './artifactModel';
import { artifactsApi } from './artifactsApi';
import { lineDiff } from './lineDiff';
import RegionLayer from './RegionLayer';
import { useArtifactContent } from './useArtifactContent';

const timeLabel = (iso: string) => new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const btn = 'inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1 text-xs text-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50';
const btnOn = 'inline-flex items-center gap-1.5 rounded-lg border border-primary bg-primary/10 px-2.5 py-1 text-xs text-foreground';

type Panel = 'comments' | 'versions' | null;

/** One artifact, large: preview of the chosen version, versions, comments to a region or a quote. */
export default function ArtifactView({ artifactId, context }: { artifactId: string; context: WorkbenchRenderContext }) {
  const projectId = context.project.projectId;
  const navigate = useNavigate();
  const [detail, setDetail] = useState<ArtifactDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedN, setSelectedN] = useState<number | null>(null);
  const [compareN, setCompareN] = useState<number | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [regionMode, setRegionMode] = useState(false);
  const [draftAnchor, setDraftAnchor] = useState<ArtifactAnchor | null>(null);
  const [draftText, setDraftText] = useState('');
  const [selection, setSelection] = useState('');
  const [confirmRestore, setConfirmRestore] = useState<number | null>(null);
  const textRef = useRef<HTMLDivElement | null>(null);

  const apply = useCallback((next: ArtifactDetail) => {
    setDetail(next);
    setError(null);
  }, []);

  const refresh = useCallback(async (manual: boolean) => {
    setBusy(true);
    try {
      const next = await artifactsApi.refresh(projectId, artifactId);
      apply(next);
      if (manual) setNotice(next.changed ? `Файл изменился — сохранена версия ${next.artifact.latestVersion}` : next.file.exists ? 'Изменений нет' : null);
      if (next.changed) setSelectedN(null);
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : 'Не удалось открыть артефакт');
    } finally {
      setBusy(false);
    }
  }, [apply, artifactId, projectId]);

  // Opening the tab is the change check: a new version appears if the file changed.
  useEffect(() => { void refresh(false); }, [refresh]);

  useEffect(() => {
    if (!detail?.comments.length) return;
    setPanel((current) => current ?? 'comments');
  }, [detail?.comments.length]);

  const artifact = detail?.artifact ?? null;
  const versions = detail?.versions ?? [];
  const latest = versions.at(-1) ?? null;
  const version: ArtifactVersion | null = versions.find((v) => v.n === selectedN) ?? latest;
  const isLatest = Boolean(version && latest && version.n === latest.n);
  const fileExists = detail?.file.exists ?? false;
  const kind = artifact?.kind ?? 'other';
  const isHtml = kind === 'html' || kind === 'slides';
  const livePreview = isHtml && isLatest && fileExists;
  const textual = artifact ? isTextArtifactPath(artifact.path) : true;
  const showsText = textual && !livePreview && kind !== 'image';

  const html = useHtmlPreview(projectId, detail?.file.absPath ?? '', livePreview);
  const retryPreview = html.retry;
  const latestN = latest?.n ?? null;
  const lastPreviewVersion = useRef<number | null>(null);
  useEffect(() => {
    // The page changed on disk → a fresh preview of it.
    if (livePreview && latestN !== null && lastPreviewVersion.current !== null && lastPreviewVersion.current !== latestN) retryPreview();
    lastPreviewVersion.current = latestN;
  }, [retryPreview, latestN, livePreview]);

  const content = useArtifactContent({
    projectId,
    artifactId,
    kind,
    path: artifact?.path ?? '',
    version,
    liveFilePath: isLatest && fileExists ? detail?.file.absPath ?? null : null,
    asText: showsText,
    enabled: Boolean(artifact) && !livePreview,
  });
  const compareVersion = versions.find((v) => v.n === compareN) ?? null;
  const compareContent = useArtifactContent({
    projectId,
    artifactId,
    kind,
    path: artifact?.path ?? '',
    version: compareVersion,
    liveFilePath: null,
    asText: true,
    enabled: Boolean(artifact && compareVersion && textual),
  });
  const latestText = useArtifactContent({
    projectId,
    artifactId,
    kind,
    path: artifact?.path ?? '',
    version: latest,
    liveFilePath: fileExists ? detail?.file.absPath ?? null : null,
    asText: true,
    enabled: Boolean(artifact && compareVersion && textual),
  });
  const diff = useMemo(() => (
    compareContent.text !== null && latestText.text !== null ? lineDiff(compareContent.text, latestText.text) : null
  ), [compareContent.text, latestText.text]);

  const comments = useMemo(() => detail?.comments ?? [], [detail?.comments]);
  const numbered = useMemo(() => comments.map((comment, index) => ({ comment, label: String(index + 1) })), [comments]);
  const markers = numbered
    .filter(({ comment }) => comment.anchor.type === 'rect' && version && comment.versionN === version.n)
    .map(({ comment, label }) => ({ id: comment.id, label, rect: comment.anchor as FractionRect, muted: comment.status === 'resolved' }));
  const openCount = comments.filter((comment) => comment.status === 'open').length;
  const target = sendTarget({ artifactSessionId: artifact?.sessionId ?? null, currentSessionId: context.sessionId });

  const onRegion = (rect: FractionRect) => {
    setDraftAnchor({ type: 'rect', ...rect });
    setPanel('comments');
  };

  const onTextSelect = () => {
    const picked = window.getSelection();
    const text = picked && textRef.current && picked.anchorNode && textRef.current.contains(picked.anchorNode) ? picked.toString().trim() : '';
    setSelection(text.slice(0, 2000));
  };

  const saveComment = async () => {
    if (!draftAnchor || !draftText.trim() || !version) return;
    setBusy(true);
    try {
      await artifactsApi.addComment(projectId, artifactId, { anchor: draftAnchor, text: draftText.trim(), versionN: version.n });
      setDraftAnchor(null);
      setDraftText('');
      setSelection('');
      setRegionMode(false);
      apply(await artifactsApi.detail(projectId, artifactId));
    } catch (saveError) {
      setNotice(saveError instanceof Error ? saveError.message : 'Не удалось сохранить комментарий');
    } finally {
      setBusy(false);
    }
  };

  const setStatus = async (comment: ArtifactComment, status: ArtifactComment['status']) => {
    try {
      await artifactsApi.updateComment(projectId, artifactId, comment.id, { status });
      apply(await artifactsApi.detail(projectId, artifactId));
    } catch (statusError) {
      setNotice(statusError instanceof Error ? statusError.message : 'Не удалось изменить комментарий');
    }
  };

  const send = async (sessionId: string) => {
    setBusy(true);
    try {
      const result = await artifactsApi.sendComments(projectId, artifactId, sessionId);
      // Delivered by the chat's own composer: the same path as a typed message.
      sendToComposer(result.text, { autoSend: true });
      setNotice(`Отправлено агенту: ${result.commentIds.length}. Когда он поправит файл, нажмите «Проверить изменения».`);
      apply(await artifactsApi.detail(projectId, artifactId));
    } catch (sendError) {
      setNotice(sendError instanceof Error ? sendError.message : 'Не удалось отправить комментарии');
    } finally {
      setBusy(false);
    }
  };

  const openSourceChat = (sessionId: string) => {
    if (artifact) openWorkbenchTab(sessionId, { kind: 'artifact', ref: artifact.id, title: artifact.title });
    navigate(`/session/${encodeURIComponent(sessionId)}`);
  };

  const restore = async (n: number) => {
    setBusy(true);
    try {
      const next = await artifactsApi.restore(projectId, artifactId, n);
      apply(next);
      setSelectedN(null);
      setConfirmRestore(null);
      setNotice(`Файл восстановлен из версии ${n}: сохранена версия ${next.artifact.latestVersion}`);
    } catch (restoreError) {
      setNotice(restoreError instanceof Error ? restoreError.message : 'Не удалось восстановить версию');
    } finally {
      setBusy(false);
    }
  };

  if (error && !detail) {
    return (
      <div role="alert" className="m-6 space-y-3 rounded-xl border border-border bg-card p-4 text-sm">
        <p className="text-foreground">{error}</p>
        <button type="button" className={btn} onClick={() => void refresh(true)}>Повторить</button>
      </div>
    );
  }
  if (!artifact || !version) {
    return <p role="status" className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" aria-hidden />Открываем…</p>;
  }

  const renderBody = () => {
    if (compareVersion && textual) {
      if (compareContent.loading || latestText.loading) return <p className="p-4 text-sm text-muted-foreground">Сравниваем…</p>;
      if (compareContent.error || latestText.error) return <p role="alert" className="p-4 text-sm text-foreground">{compareContent.error ?? latestText.error}</p>;
      if (!diff) return <p className="p-4 text-sm text-muted-foreground">Файл слишком длинный для построчного сравнения.</p>;
      return (
        <div className="overflow-auto p-3 font-mono text-xs leading-5" data-artifact-diff>
          {diff.map((line, index) => (
            <div
              key={index}
              className={`whitespace-pre-wrap break-words px-2 ${line.type === 'added' ? 'bg-emerald-500/15 text-foreground' : line.type === 'removed' ? 'bg-red-500/15 text-foreground line-through decoration-red-500/50' : 'text-muted-foreground'}`}
            >
              {line.type === 'added' ? '+ ' : line.type === 'removed' ? '− ' : '  '}{line.text}
            </div>
          ))}
        </div>
      );
    }
    if (livePreview) {
      return (
        <div className="relative h-full min-h-96 w-full">
          <CodeEditorHtmlPreview url={html.url} name={artifact.title} error={html.error} onRetry={html.retry} hasRootReferences={false} />
          <RegionLayer active={regionMode} markers={markers} draft={draftAnchor?.type === 'rect' ? draftAnchor : null} onRegion={onRegion} />
        </div>
      );
    }
    if (content.loading) return <p role="status" className="p-4 text-sm text-muted-foreground">Открываем версию…</p>;
    if (content.error) return <p role="alert" className="p-4 text-sm text-foreground">{content.error}</p>;
    if (kind === 'image' && content.url) {
      return (
        <div className="flex h-full items-start justify-center overflow-auto bg-muted/30 p-4">
          <div className="relative inline-block">
            <img src={content.url} alt={artifact.title} className="block max-w-full" draggable={false} />
            <RegionLayer active={regionMode} markers={markers} draft={draftAnchor?.type === 'rect' ? draftAnchor : null} onRegion={onRegion} />
          </div>
        </div>
      );
    }
    if (kind === 'pdf' && content.url) {
      return (
        <div className="relative h-full min-h-96 w-full">
          {/* The browser PDF viewer refuses sandboxed frames; the bytes are checked to be a PDF. */}
          <iframe src={content.url} title={artifact.title} className="h-full w-full border-0 bg-white" />
          <RegionLayer active={regionMode} markers={markers} draft={draftAnchor?.type === 'rect' ? draftAnchor : null} onRegion={onRegion} />
        </div>
      );
    }
    if (content.text !== null) {
      return (
        <div ref={textRef} onMouseUp={onTextSelect} onKeyUp={onTextSelect} className="h-full overflow-auto p-4" data-artifact-text>
          {isHtml && (
            <p className="mb-3 rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
              {fileExists ? 'Старая версия страницы показана исходным текстом: живой просмотр — у текущей версии.' : 'Показан исходный текст последней сохранённой версии.'}
            </p>
          )}
          {kind === 'markdown' ? (
            <Markdown className="prose prose-sm max-w-none dark:prose-invert">{content.text}</Markdown>
          ) : (
            <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-5 text-foreground">{content.text}</pre>
          )}
        </div>
      );
    }
    return null;
  };

  return (
    <div className="flex h-full min-h-0 flex-col" data-artifact-view={artifact.id}>
      <header className="flex-shrink-0 space-y-2 border-b border-border/70 px-4 py-3">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <h2 className="min-w-0 truncate text-base font-semibold text-foreground">{artifact.title}</h2>
          {isJevReportPath(artifact.path) && <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-foreground">Отчёт Jev</span>}
          <span className="text-xs text-muted-foreground">версия {version.n} из {latest?.n ?? version.n}{isLatest ? '' : ' · старая'}</span>
        </div>
        <p className="truncate font-mono text-xs text-muted-foreground" title={detail?.file.absPath}>{artifact.path}</p>
        <p className="text-xs text-muted-foreground">
          Источник:{' '}
          {artifact.sessionId ? (
            artifact.sessionId === context.sessionId ? 'этот чат' : (
              <button type="button" className="text-foreground underline underline-offset-2" onClick={() => openSourceChat(artifact.sessionId!)}>открыть чат</button>
            )
          ) : 'не указан'}
          {artifact.messageId ? ' · из ответа в чате' : ''}
        </p>
        <div className="flex flex-wrap gap-1.5">
          <button type="button" className={btn} onClick={() => void refresh(true)} disabled={busy}>
            <RefreshCw className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} aria-hidden />Проверить изменения
          </button>
          <button type="button" className={panel === 'versions' ? btnOn : btn} onClick={() => setPanel(panel === 'versions' ? null : 'versions')}>
            <History className="h-3.5 w-3.5" aria-hidden />Версии ({versions.length})
          </button>
          <button type="button" className={panel === 'comments' ? btnOn : btn} onClick={() => setPanel(panel === 'comments' ? null : 'comments')}>
            <MessagesSquare className="h-3.5 w-3.5" aria-hidden />Комментарии ({comments.length})
          </button>
          {commentsWithRect(kind) && (livePreview || (content.url && !compareVersion)) && (
            <button type="button" className={regionMode ? btnOn : btn} onClick={() => { setRegionMode(!regionMode); setDraftAnchor(null); }} aria-pressed={regionMode}>
              <SquareDashedMousePointer className="h-3.5 w-3.5" aria-hidden />{regionMode ? 'Выделите область мышью' : 'Комментарий к области'}
            </button>
          )}
          {showsText && !compareVersion && (
            <button type="button" className={btn} disabled={!selection} onClick={() => { setDraftAnchor({ type: 'quote', text: selection }); setPanel('comments'); }} title={selection ? undefined : 'Сначала выделите текст'}>
              <MessageSquarePlus className="h-3.5 w-3.5" aria-hidden />Комментарий к выделению
            </button>
          )}
          {compareVersion && (
            <button type="button" className={btnOn} onClick={() => setCompareN(null)}>
              <GitCompare className="h-3.5 w-3.5" aria-hidden />Сравнение v{compareVersion.n} → v{latest?.n} · закрыть
            </button>
          )}
        </div>
        {!fileExists && (
          <p role="status" className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-foreground">
            Файл удалён или недоступен. Последняя сохранённая версия остаётся для просмотра.
          </p>
        )}
        {notice && <p role="status" className="text-xs text-muted-foreground">{notice}</p>}
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="relative min-h-0 min-w-0 flex-1 overflow-auto">{renderBody()}</div>
        {panel && (
          <aside className="flex w-72 max-w-[45%] flex-shrink-0 flex-col overflow-y-auto border-l border-border/70 bg-card/50 p-3 text-sm">
            {panel === 'versions' ? (
              <ol className="space-y-2" aria-label="Версии">
                {[...versions].reverse().map((v) => (
                  <li key={v.id} className={`rounded-lg border p-2 ${v.n === version.n ? 'border-primary' : 'border-border'}`}>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-medium text-foreground">Версия {v.n}</span>
                      <span className="text-[11px] text-muted-foreground">{timeLabel(v.createdAt)}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">{versionSourceLabel(v)} · {formatBytes(v.size)}{v.snapshotFile ? '' : ' · без снимка (больше лимита)'}</p>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {v.n !== version.n && <button type="button" className={btn} onClick={() => { setSelectedN(v.n); setCompareN(null); }}>Показать</button>}
                      {textual && latest && v.n !== latest.n && v.snapshotFile && (
                        <button type="button" className={btn} onClick={() => { setCompareN(v.n); setSelectedN(null); }}>Сравнить с текущей</button>
                      )}
                      {latest && v.n !== latest.n && v.snapshotFile && (
                        confirmRestore === v.n ? (
                          <button type="button" className={btnOn} disabled={busy} onClick={() => void restore(v.n)}>
                            <RotateCcw className="h-3.5 w-3.5" aria-hidden />Точно восстановить?
                          </button>
                        ) : (
                          <button type="button" className={btn} onClick={() => setConfirmRestore(v.n)}>Восстановить</button>
                        )
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <div className="space-y-3">
                {draftAnchor ? (
                  <div className="space-y-2 rounded-lg border border-primary p-2">
                    <p className="text-xs text-muted-foreground">{describeArtifactAnchor(draftAnchor)}</p>
                    <textarea
                      value={draftText}
                      onChange={(event) => setDraftText(event.target.value)}
                      rows={3}
                      autoFocus
                      placeholder="Что поправить?"
                      className="w-full resize-y rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
                    />
                    <div className="flex gap-1.5">
                      <button type="button" className={btnOn} disabled={busy || !draftText.trim()} onClick={() => void saveComment()}>Сохранить</button>
                      <button type="button" className={btn} onClick={() => { setDraftAnchor(null); setDraftText(''); }}>Отмена</button>
                    </div>
                  </div>
                ) : regionMode ? (
                  <p className="text-xs text-muted-foreground">Выделите мышью область на странице — затем напишите комментарий.</p>
                ) : null}

                {openCount > 0 && (target.kind === 'here' ? (
                  <button type="button" className={`${btnOn} w-full justify-center`} disabled={busy} onClick={() => void send(target.sessionId)}>
                    <Send className="h-3.5 w-3.5" aria-hidden />Отправить агенту ({openCount})
                  </button>
                ) : target.kind === 'elsewhere' ? (
                  <div className="space-y-1.5 rounded-lg border border-border p-2 text-xs text-muted-foreground">
                    <p>Артефакт пришёл из другого чата: комментарии уходят туда.</p>
                    <button type="button" className={btn} onClick={() => openSourceChat(target.sessionId)}>Открыть исходный чат</button>
                    {context.sessionId && (
                      <button type="button" className={btn} disabled={busy} onClick={() => void send(context.sessionId!)}>Отправить в этот чат</button>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">Отправить можно из чата: начните переписку, затем вернитесь сюда.</p>
                ))}

                {numbered.length === 0 && !draftAnchor && (
                  <p className="text-xs text-muted-foreground">
                    Комментариев пока нет. {commentsWithRect(kind) ? 'Нажмите «Комментарий к области» и выделите участок.' : 'Выделите текст и нажмите «Комментарий к выделению».'}
                  </p>
                )}
                <ol className="space-y-2" aria-label="Комментарии">
                  {numbered.map(({ comment, label }) => (
                    <li key={comment.id} className={`rounded-lg border p-2 ${comment.status === 'resolved' ? 'border-border/60 opacity-70' : 'border-border'}`}>
                      <div className="flex items-baseline justify-between gap-2 text-[11px] text-muted-foreground">
                        <span><span className="font-semibold text-foreground">{label}.</span> версия {comment.versionN}</span>
                        <span>{commentStatusLabel(comment.status)}</span>
                      </div>
                      <p className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">{describeArtifactAnchor(comment.anchor)}</p>
                      <p className="mt-1 whitespace-pre-wrap break-words text-sm text-foreground">{comment.text}</p>
                      <div className="mt-1.5 flex gap-1">
                        {comment.status !== 'resolved' ? (
                          <button type="button" className={btn} onClick={() => void setStatus(comment, 'resolved')}>Учтён</button>
                        ) : (
                          <button type="button" className={btn} onClick={() => void setStatus(comment, 'open')}>Открыть снова</button>
                        )}
                        {comment.versionN !== version.n && (
                          <button type="button" className={btn} onClick={() => { setSelectedN(comment.versionN); setCompareN(null); }}>К версии {comment.versionN}</button>
                        )}
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}
