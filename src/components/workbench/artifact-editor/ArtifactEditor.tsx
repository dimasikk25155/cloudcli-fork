/**
 * Режим «Правка» артефакта в холсте (мод «Правка артефактов»).
 *
 * Исходник разбирается (`instrumentSource`), копия с мостом уходит в iframe
 * `sandbox="allow-scripts"` через грант «копия документа». Мост сообщает
 * наведение, клики и рамки; родитель рисует выделение и ручки поверх iframe
 * (`SelectionOverlay`), применяет операции к разобранной копии и шлёт их в
 * iframe для вида. «Сохранить» пишет сериализацию копии новой версией `edit`;
 * 409 — агент поменял файл: правки переигрываются на новом исходнике.
 *
 * Состояние живёт в `editorStore` по id артефакта: холст размонтирует
 * неактивную вкладку, правки при этом не теряются.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, Loader2, Magnet, Redo2, Save, Undo2 } from 'lucide-react';

import type { ArtifactDetail } from '../../../../shared/artifacts';
import { ArtifactsApiError, artifactsApi } from '../artifacts/artifactsApi';

import { buildBridgeScript } from './bridge';
import { ArtifactEditorContext, type ArtifactEditorApi } from './editorContext';
import {
  NEO3_ID_ATTR,
  applyOpToDocument,
  createStackEntry,
  freshElementId,
  instrumentSource,
  previewHtml,
  replayOps,
  serializeDocument,
  type EditorOp,
  type StackEntry,
} from './editorModel';
import { createBridgeNonce, type BridgeToParent, type ParentLayout } from './editorProtocol';
import { findEditorElement } from './editorDom';
import { clearEditorState, getEditorState, setEditorState, type EditorSession } from './editorStore';
import {
  createEditorHistory,
  editorDocKind,
  fontFamiliesIn,
  isReorderNoop,
  pickSelection,
  pruneSelection,
  svgUnitsPerPx,
  type SiblingBox,
} from './editorUiModel';
import { findFrames } from './frames';
import PropertiesPanel from './PropertiesPanel';
import SelectionOverlay, { type SelectedBox } from './SelectionOverlay';
import type { Rect } from './snap';
import { useEditorBridge } from './useEditorBridge';

const btn = 'inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1 text-xs text-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50';
const btnOn = 'inline-flex items-center gap-1.5 rounded-lg border border-primary bg-primary/10 px-2.5 py-1 text-xs text-foreground';
const btnPrimary = 'inline-flex items-center gap-1.5 rounded-lg bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50';

const SVG_NS = 'http://www.w3.org/2000/svg';
const SVG_SIZED = new Set(['rect', 'image', 'foreignobject', 'use', 'svg']);
/** «Удалить» asks first for an element with more nested elements than this. */
const CONFIRM_REMOVE_OVER = 20;
const COALESCE_MS = 1500;
const SNAPSHOT_TIMEOUT_MS = 6000;

export interface ArtifactEditorProps {
  projectId: string;
  artifact: ArtifactDetail;
  sessionId: string | null;
  /** A fresh detail after «Сохранить» (and after replaying edits on the agent's new version). */
  onSaved: (detail: ArtifactDetail) => void;
  onExit: () => void;
  /** Extra toolbar controls (task 05: «Попросить агента», масштаб). */
  toolbarExtras?: ReactNode;
  /** Left rail (task 05: кадры-слайды). */
  leftRail?: ReactNode;
}

type Ready = { width: number; height: number; frames: string[] };
type RectItem = { id: string; rect: Rect; parentLayout: ParentLayout; editableText: boolean };

const isSvgGraphic = (element: Element) => element.namespaceURI === SVG_NS && element.parentElement?.namespaceURI === SVG_NS;

async function loadSource(projectId: string, detail: ArtifactDetail): Promise<string> {
  const latest = detail.versions.at(-1);
  const blob = latest?.snapshotFile
    ? await artifactsApi.versionBlob(projectId, detail.artifact.id, latest.n)
    : await artifactsApi.fileBlob(projectId, detail.file.absPath);
  return blob.text();
}

export default function ArtifactEditor({ projectId, artifact, sessionId, onSaved, onExit, toolbarExtras, leftRail }: ArtifactEditorProps) {
  const artifactId = artifact.artifact.id;
  const kind = editorDocKind(artifact.artifact.path);
  const [stored] = useState(() => getEditorState(artifactId));

  const [session, setSession] = useState<EditorSession | null>(stored?.session ?? null);
  const [baseVersionN, setBaseVersionN] = useState(stored?.baseVersionN ?? artifact.artifact.latestVersion);
  const [selection, setSelection] = useState<string[]>(stored?.selection ?? []);
  const [zoom, setZoomState] = useState(stored?.zoom ?? 1);
  const [snap, setSnap] = useState(stored?.snap ?? true);
  const [revision, setRevision] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [preview, setPreview] = useState<{ url: string; nonce: string; builtAt: number } | null>(null);
  const [previewKey, setPreviewKey] = useState(0);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [ready, setReady] = useState<Ready | null>(null);
  const [scroll, setScroll] = useState({ x: 0, y: 0 });
  const [hover, setHover] = useState<{ id: string | null; rect: Rect } | null>(null);
  const [rects, setRects] = useState<RectItem[]>([]);
  const [siblings, setSiblings] = useState<{ id: string; items: SiblingBox[] } | null>(null);
  const [editingText, setEditingText] = useState<string | null>(null);
  const [passthrough, setPassthrough] = useState(false);
  const [stage, setStage] = useState({ w: 0, h: 0 });

  const [notice, setNotice] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState<{ latestVersion: number | null } | null>(null);
  const [confirmExit, setConfirmExit] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<{ ids: string[]; count: number } | null>(null);

  const rootRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  /** Grows on every change of the parsed copy (the preview compares it on «ready»). */
  const docVersion = useRef(0);
  /** Entries whose operation ran in the current iframe (its hidden undo stash knows them). */
  const live = useRef(new WeakSet<StackEntry>());
  const lastCoalesce = useRef<{ key: string; serial: number; at: number } | null>(null);
  const discarded = useRef(false);
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const snapshots = useRef(new Map<string, Array<(url: string | null) => void>>());

  const doc = session?.doc ?? null;
  const history = session?.history ?? null;
  const dirty = Boolean(history?.dirty);

  // ---------- Load the source ----------
  useEffect(() => {
    if (session) return undefined;
    let cancelled = false;
    setLoadError(null);
    (async () => {
      try {
        const fresh = await artifactsApi.detail(projectId, artifactId);
        const text = await loadSource(projectId, fresh);
        if (cancelled) return;
        const { doc: parsed } = instrumentSource(text, kind);
        setSession({ kind, doc: parsed, history: createEditorHistory() });
        setBaseVersionN(fresh.artifact.latestVersion);
      } catch (error) {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : 'Не удалось открыть файл для правки');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [artifactId, kind, projectId, session]);

  // ---------- Keep the store in step (survives the tab being unmounted) ----------
  useEffect(() => {
    if (discarded.current || !session) return;
    setEditorState(artifactId, {
      baseVersionN,
      ops: session.history.ops(),
      redo: session.history.undoneOps(),
      selection,
      zoom,
      snap,
      session,
    });
  }, [artifactId, baseVersionN, revision, selection, session, snap, zoom]);

  // ---------- Preview copy with the bridge ----------
  useEffect(() => {
    if (!session) return undefined;
    let cancelled = false;
    const nonce = createBridgeNonce();
    const builtAt = docVersion.current;
    setPreviewError(null);
    artifactsApi.editorPreview(projectId, artifactId, previewHtml(session.doc, kind, buildBridgeScript(nonce)))
      .then((url) => {
        if (cancelled) return;
        live.current = new WeakSet();
        setReady(null);
        setRects([]);
        setHover(null);
        setSiblings(null);
        setEditingText(null);
        setScroll({ x: 0, y: 0 });
        setPreview({ url, nonce, builtAt });
      })
      .catch((error) => {
        if (!cancelled) setPreviewError(error instanceof Error ? error.message : 'Не удалось показать страницу');
      });
    return () => {
      cancelled = true;
    };
  }, [artifactId, kind, previewKey, projectId, session]);

  const reloadPreview = useCallback(() => setPreviewKey((key) => key + 1), []);

  useEffect(() => {
    const element = stageRef.current;
    if (!element || typeof ResizeObserver !== 'function') return undefined;
    const observer = new ResizeObserver(() => setStage({ w: element.clientWidth, h: element.clientHeight }));
    observer.observe(element);
    setStage({ w: element.clientWidth, h: element.clientHeight });
    return () => observer.disconnect();
  }, [session]);

  useEffect(() => {
    if (!hint) return undefined;
    const timer = window.setTimeout(() => setHint(null), 5000);
    return () => window.clearTimeout(timer);
  }, [hint]);

  useEffect(() => {
    if (!dirty) return undefined;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const focusRoot = () => rootRef.current?.focus({ preventScroll: true });

  // ---------- Bridge ----------
  const onMessage = (message: BridgeToParent) => {
    switch (message.type) {
      case 'ready':
        if (preview && preview.builtAt !== docVersion.current) {
          // The copy changed while the page was loading: show the current one.
          reloadPreview();
          return;
        }
        setReady({ width: message.width, height: message.height, frames: message.frames });
        post({ type: 'setZoomHint', zoom });
        post({ type: 'select', ids: selectionRef.current });
        break;
      case 'hover':
        setHover(message.rect ? { id: message.id, rect: message.rect } : null);
        break;
      case 'pick':
        setPassthrough(false);
        if (message.id === null) {
          setHint('Этот элемент рисует скрипт страницы — попроси агента');
        } else {
          setSelection((current) => pickSelection(current, message.id!, message.shift));
          setConfirmRemove(null);
        }
        focusRoot();
        break;
      case 'rects':
        setRects(message.items);
        break;
      case 'siblings':
        setSiblings({ id: message.id, items: message.items });
        break;
      case 'textCommitted': {
        setEditingText(null);
        const element = doc ? findEditorElement(doc, message.id) : null;
        if (element && element.textContent !== message.text) commit([{ type: 'text', id: message.id, text: message.text }]);
        focusRoot();
        break;
      }
      case 'textCancelled':
        setEditingText(null);
        focusRoot();
        break;
      case 'snapshot': {
        const waiting = snapshots.current.get(message.id) ?? [];
        snapshots.current.delete(message.id);
        for (const resolve of waiting) resolve(message.dataUrl);
        break;
      }
      case 'scroll':
        setScroll({ x: message.x, y: message.y });
        setHover(null);
        break;
      default:
        break;
    }
  };
  const { post } = useEditorBridge({ iframeRef, nonce: preview?.nonce ?? null, onMessage });

  useEffect(() => {
    if (ready) post({ type: 'select', ids: selection });
  }, [post, ready, selection]);

  // ---------- Operations ----------
  const changed = () => {
    docVersion.current += 1;
    setRevision((value) => value + 1);
    if (doc) {
      const next = pruneSelection(selectionRef.current, (id) => Boolean(findEditorElement(doc, id)));
      if (next !== selectionRef.current) setSelection(next);
      // Fresh frames and neighbours after the change.
      post({ type: 'select', ids: next });
    }
  };

  /** Applies operations as one undoable action; `coalesceKey` — a colour/slider drag stays one action. */
  const commit = (ops: EditorOp[], options?: { coalesceKey?: string }) => {
    if (!doc || !history) return;
    const now = Date.now();
    const last = lastCoalesce.current;
    if (options?.coalesceKey && ops.length === 1 && last && last.key === options.coalesceKey && last.serial === history.topSerial && now - last.at < COALESCE_MS) {
      if (applyOpToDocument(doc, ops[0])) {
        post({ type: 'apply', op: ops[0] });
        history.amendLast(ops[0]);
        lastCoalesce.current = { key: options.coalesceKey, serial: history.topSerial, at: now };
        changed();
      }
      return;
    }
    // Several style ops of one coalesced control: amend only works on single ones — fine, they are one push.
    const group: StackEntry[] = [];
    for (const op of ops) {
      const entry = createStackEntry(doc, op);
      if (!entry || !applyOpToDocument(doc, op)) continue;
      group.push(entry);
      live.current.add(entry);
      post({ type: 'apply', op });
    }
    if (group.length === 0) {
      setHint('Эту правку к выделенному применить нельзя');
      return;
    }
    history.push(group);
    lastCoalesce.current = options?.coalesceKey && group.length === 1 ? { key: options.coalesceKey, serial: history.topSerial, at: now } : null;
    setConflict(null);
    changed();
  };

  const undo = () => {
    if (!doc || !history) return;
    const group = history.undo();
    if (!group) return;
    let reload = false;
    for (const entry of [...group].reverse()) {
      applyOpToDocument(doc, entry.inverse);
      // Putting back a removed or moved element needs the iframe's own stash: no stash — rebuild the page from the copy.
      if ((entry.inverse.type === 'unremove' || entry.inverse.type === 'unmove') && !live.current.has(entry)) reload = true;
      else post({ type: 'apply', op: entry.inverse });
    }
    lastCoalesce.current = null;
    changed();
    if (reload) reloadPreview();
  };

  const redo = () => {
    if (!doc || !history) return;
    const group = history.redo();
    if (!group) return;
    for (const entry of group) {
      applyOpToDocument(doc, entry.op);
      live.current.add(entry);
      post({ type: 'apply', op: entry.op });
    }
    lastCoalesce.current = null;
    changed();
  };

  /** CSS px → user units of the nearest `<svg>` (for SVG shapes); 1 for HTML. */
  const unitsPerPx = (element: Element): number => {
    if (!isSvgGraphic(element)) return 1;
    let svg: Element | null = element.parentElement;
    while (svg && svg.localName !== 'svg') svg = svg.parentElement;
    if (!svg) return 1;
    const outer = kind === 'svg' && svg === doc?.documentElement;
    return svgUnitsPerPx({ viewBox: svg.getAttribute('viewBox'), width: svg.getAttribute('width'), renderedWidth: outer ? ready?.width ?? null : null });
  };

  const onMove = ({ ids, dx, dy }: { ids: string[]; dx: number; dy: number }) => {
    if (!doc) return;
    commit(ids.flatMap((id): EditorOp[] => {
      const element = findEditorElement(doc, id);
      if (!element) return [];
      const k = unitsPerPx(element);
      return [{ type: 'translate', id, dx: dx * k, dy: dy * k }];
    }));
  };

  const onReorder = ({ id, beforeId }: { id: string; beforeId: string | null }) => {
    if (!doc) return;
    const element = findEditorElement(doc, id);
    if (!element) return;
    let next = element.nextElementSibling;
    while (next && !next.hasAttribute(NEO3_ID_ATTR)) next = next.nextElementSibling;
    if (isReorderNoop({ beforeId, nextId: next?.getAttribute(NEO3_ID_ATTR) ?? null })) return;
    commit([{ type: 'reorder', id, beforeId }]);
  };

  const onResize = ({ id, width, height }: { id: string; width: number; height: number }) => {
    if (!doc) return;
    const element = findEditorElement(doc, id);
    if (!element) return;
    const k = unitsPerPx(element);
    commit([{ type: 'resize', id, width: width * k, height: height * k }]);
  };

  const duplicate = (ids: string[]) => {
    if (!doc) return;
    const ops: EditorOp[] = [];
    const created: string[] = [];
    let next = Number(freshElementId(doc));
    for (const id of ids) {
      const newId = String(next);
      next += 1;
      ops.push({ type: 'duplicate', id, newId });
      created.push(newId);
    }
    commit(ops);
    const exists = created.filter((id) => findEditorElement(doc, id));
    if (exists.length) setSelection(exists);
  };

  const remove = (ids: string[], confirmed = false) => {
    if (!doc || ids.length === 0) return;
    const nested = ids.reduce((sum, id) => sum + (findEditorElement(doc, id)?.querySelectorAll('*').length ?? 0), 0);
    if (!confirmed && ids.some((id) => (findEditorElement(doc, id)?.querySelectorAll('*').length ?? 0) > CONFIRM_REMOVE_OVER)) {
      setConfirmRemove({ ids, count: nested });
      return;
    }
    setConfirmRemove(null);
    commit(ids.map((id): EditorOp => ({ type: 'remove', id })));
  };

  const editText = (id: string) => {
    setEditingText(id);
    // The iframe document must hold focus for the element to be typed into.
    iframeRef.current?.focus();
    post({ type: 'editText', id });
  };

  const onDoubleClick = (box: SelectedBox) => {
    if (box.editableText) {
      editText(box.id);
      return;
    }
    setPassthrough(true);
    setHint('Кликни элемент внутри рамки');
  };

  // ---------- Save / conflict / exit ----------
  const save = async (): Promise<boolean> => {
    if (!doc || !history) return false;
    setSaving(true);
    setNotice(null);
    try {
      const detail = await artifactsApi.saveEdit(projectId, artifactId, { content: serializeDocument(doc, kind), baseVersionN });
      history.markSaved();
      setBaseVersionN(detail.artifact.latestVersion);
      setConflict(null);
      setNotice(`Сохранено: версия ${detail.artifact.latestVersion} «Правка вручную»`);
      setRevision((value) => value + 1);
      onSaved(detail);
      return true;
    } catch (error) {
      if (error instanceof ArtifactsApiError && error.code === 'ARTIFACT_EDIT_CONFLICT') {
        const latest = (error.details as { latestVersion?: unknown } | null)?.latestVersion;
        setConflict({ latestVersion: typeof latest === 'number' ? latest : null });
      } else {
        setNotice(error instanceof Error ? error.message : 'Не удалось сохранить');
      }
      return false;
    } finally {
      setSaving(false);
    }
  };

  const replayOnLatest = async () => {
    if (!history) return;
    setSaving(true);
    try {
      const fresh = await artifactsApi.detail(projectId, artifactId);
      const { doc: nextDoc } = instrumentSource(await loadSource(projectId, fresh), kind);
      let applied = 0;
      let skipped = 0;
      const groups: StackEntry[][] = [];
      for (const group of history.groups()) {
        const result = replayOps(nextDoc, group);
        applied += result.applied;
        skipped += result.skipped;
        if (result.entries.length) groups.push(result.entries);
      }
      const nextHistory = createEditorHistory();
      nextHistory.replace(groups);
      docVersion.current += 1;
      lastCoalesce.current = null;
      setSession({ kind, doc: nextDoc, history: nextHistory });
      setBaseVersionN(fresh.artifact.latestVersion);
      setSelection([]);
      setConflict(null);
      const total = applied + skipped;
      setNotice(skipped
        ? `Правки перенесены на версию ${fresh.artifact.latestVersion}: применено ${applied} из ${total}, не нашли элемент — ${skipped}. Проверь и нажми «Сохранить».`
        : `Все правки (${applied}) перенесены на версию ${fresh.artifact.latestVersion}. Проверь и нажми «Сохранить».`);
      onSaved(fresh);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Не удалось открыть новую версию');
    } finally {
      setSaving(false);
    }
  };

  const dropMyEdits = () => {
    lastCoalesce.current = null;
    setConflict(null);
    setSelection([]);
    setNotice('Твои правки отменены — открыта последняя версия файла');
    setSession(null);
  };

  const leave = () => {
    discarded.current = true;
    clearEditorState(artifactId);
    onExit();
  };

  const requestExit = () => {
    if (dirty) setConfirmExit(true);
    else leave();
  };

  // ---------- Keys ----------
  const onKeyDown = (event: React.KeyboardEvent) => {
    const target = event.target as HTMLElement;
    if (target.closest('input, textarea, select, [contenteditable="true"]')) return;
    const mod = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();
    if (mod && key === 'z') {
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
    } else if (mod && key === 'y') {
      event.preventDefault();
      redo();
    } else if (mod && key === 'd' && selection.length) {
      event.preventDefault();
      duplicate(selection);
    } else if ((event.key === 'Delete' || event.key === 'Backspace') && selection.length) {
      event.preventDefault();
      remove(selection);
    } else if (event.key === 'Escape') {
      setPassthrough(false);
      setConfirmRemove(null);
      setSelection([]);
    }
  };

  const setZoom = useCallback((value: number) => {
    const next = Math.min(4, Math.max(0.25, value));
    setZoomState(next);
    post({ type: 'setZoomHint', zoom: next });
  }, [post]);

  // ---------- Derived ----------
  const fonts = useMemo(() => {
    if (!doc) return [];
    const texts = [
      ...Array.from(doc.querySelectorAll('style')).map((node) => node.textContent ?? ''),
      ...Array.from(doc.querySelectorAll('[style]')).map((node) => node.getAttribute('style') ?? ''),
    ];
    return fontFamiliesIn(texts);
    // `revision` — the document changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, revision]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const frames = useMemo(() => (doc ? findFrames(doc) : []), [doc, revision]);

  const selectedBoxes: SelectedBox[] = rects
    .filter((item) => selection.includes(item.id))
    .map((item) => {
      const element = doc ? findEditorElement(doc, item.id) : null;
      const resizable = Boolean(element) && (!isSvgGraphic(element!) || SVG_SIZED.has(element!.localName.toLowerCase()));
      return { ...item, resizable };
    });
  const siblingBoxes = siblings && selection.length === 1 && siblings.id === selection[0] ? siblings.items : [];

  const api = useMemo<ArtifactEditorApi | null>(() => (doc ? {
    projectId,
    artifact,
    sessionId,
    kind,
    doc,
    revision,
    selection,
    frames,
    zoom,
    setZoom,
    apply: (ops) => commit(ops),
    select: (ids) => setSelection(ids.filter((id) => findEditorElement(doc, id))),
    scrollTo: (id) => post({ type: 'scrollTo', id }),
    snapshot: (id) => new Promise<string | null>((resolve) => {
      const waiting = snapshots.current.get(id) ?? [];
      let settled = false;
      const done = (url: string | null) => {
        if (settled) return;
        settled = true;
        resolve(url);
      };
      waiting.push(done);
      snapshots.current.set(id, waiting);
      window.setTimeout(() => done(null), SNAPSHOT_TIMEOUT_MS);
      post({ type: 'snapshot', id });
    }),
  } : null),
  // `commit` reads the latest doc/history through closures recreated each render; `revision` keeps it fresh.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [artifact, doc, frames, kind, post, projectId, revision, selection, sessionId, setZoom, zoom]);

  // ---------- Render ----------
  const title = artifact.artifact.title;

  if (loadError) {
    return (
      <div role="alert" className="m-6 space-y-3 rounded-xl border border-border bg-card p-4 text-sm">
        <p className="text-foreground">{loadError}</p>
        <div className="flex gap-1.5">
          <button type="button" className={btn} onClick={() => setSession(null)}>Повторить</button>
          <button type="button" className={btn} onClick={leave}>Выйти из правки</button>
        </div>
      </div>
    );
  }
  if (!session || !doc || !history) {
    return <p role="status" className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" aria-hidden />Готовим правку…</p>;
  }

  const view = { zoom, scrollX: scroll.x, scrollY: scroll.y };
  const frameStyle: React.CSSProperties = zoom === 1
    ? { width: '100%', height: '100%' }
    : { width: stage.w / zoom, height: stage.h / zoom, transform: `scale(${zoom})`, transformOrigin: '0 0' };

  return (
    <ArtifactEditorContext.Provider value={api}>
      <div ref={rootRef} tabIndex={-1} onKeyDown={onKeyDown} className="flex h-full min-h-0 flex-col outline-none" data-artifact-editor={artifactId}>
        <header className="flex flex-shrink-0 flex-wrap items-center gap-1.5 border-b border-border/70 px-3 py-2">
          <button type="button" className={btn} onClick={requestExit}>
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden />Выйти из правки
          </button>
          <h2 className="min-w-0 max-w-64 truncate text-sm font-semibold text-foreground" title={title}>{title}</h2>
          <span className="text-xs text-muted-foreground">от версии {baseVersionN}</span>
          <span className="mx-1 h-4 w-px bg-border" aria-hidden />
          <button type="button" className={btn} onClick={undo} disabled={!history.canUndo} title="Отменить (⌘Z)" aria-label="Отменить">
            <Undo2 className="h-3.5 w-3.5" aria-hidden />
          </button>
          <button type="button" className={btn} onClick={redo} disabled={!history.canRedo} title="Повторить (⇧⌘Z)" aria-label="Повторить">
            <Redo2 className="h-3.5 w-3.5" aria-hidden />
          </button>
          <button type="button" className={snap ? btnOn : btn} onClick={() => setSnap(!snap)} aria-pressed={snap} title="Привязка к сетке 8 px и краям соседей. Alt при перетаскивании — временно без неё">
            <Magnet className="h-3.5 w-3.5" aria-hidden />Привязка
          </button>
          {toolbarExtras}
          <span className="ml-auto text-xs text-muted-foreground" role="status">
            {dirty ? 'Есть несохранённые правки' : history.canUndo ? 'Всё сохранено' : 'Правок пока нет'}
          </span>
          <button type="button" className={btnPrimary} onClick={() => void save()} disabled={!dirty || saving || Boolean(conflict)}>
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Save className="h-3.5 w-3.5" aria-hidden />}Сохранить
          </button>
        </header>

        {conflict && (
          <div role="alert" className="flex flex-shrink-0 flex-wrap items-center gap-2 border-b border-border/70 bg-amber-500/10 px-3 py-2 text-xs text-foreground">
            <span>Файл изменился, пока ты правил{conflict.latestVersion ? ` (теперь версия ${conflict.latestVersion})` : ''}.</span>
            <button type="button" className={btnOn} disabled={saving} onClick={() => void replayOnLatest()}>Обновить и применить мои правки заново</button>
            <button type="button" className={btn} disabled={saving} onClick={dropMyEdits}>Отменить мои правки</button>
          </div>
        )}
        {confirmExit && (
          <div role="alert" className="flex flex-shrink-0 flex-wrap items-center gap-2 border-b border-border/70 bg-amber-500/10 px-3 py-2 text-xs text-foreground">
            <span>Есть несохранённые правки.</span>
            <button type="button" className={btnOn} disabled={saving} onClick={async () => { if (await save()) leave(); else setConfirmExit(false); }}>Сохранить и выйти</button>
            <button type="button" className={btn} onClick={leave}>Выйти без сохранения</button>
            <button type="button" className={btn} onClick={() => setConfirmExit(false)}>Остаться</button>
          </div>
        )}
        {confirmRemove && (
          <div role="alert" className="flex flex-shrink-0 flex-wrap items-center gap-2 border-b border-border/70 bg-amber-500/10 px-3 py-2 text-xs text-foreground">
            <span>Внутри {confirmRemove.count} вложенных элементов. Удалить?</span>
            <button type="button" className={btnOn} onClick={() => remove(confirmRemove.ids, true)}>Удалить</button>
            <button type="button" className={btn} onClick={() => setConfirmRemove(null)}>Нет</button>
          </div>
        )}
        {(notice || hint || previewError) && (
          <p role="status" className="flex-shrink-0 border-b border-border/70 px-3 py-1.5 text-xs text-muted-foreground">
            {previewError ?? hint ?? notice}
          </p>
        )}

        <div className="flex min-h-0 flex-1">
          {leftRail}
          <div ref={stageRef} className="relative min-h-0 min-w-0 flex-1 overflow-hidden bg-muted/30" data-editor-stage>
            {preview ? (
              <iframe
                ref={iframeRef}
                key={preview.url}
                src={preview.url}
                title={`Правка: ${title}`}
                sandbox="allow-scripts"
                referrerPolicy="no-referrer"
                className="absolute left-0 top-0 border-0 bg-white"
                style={frameStyle}
              />
            ) : (
              <p role="status" className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" aria-hidden />Открываем страницу…</p>
            )}
            {preview && (
              <SelectionOverlay
                view={view}
                hover={passthrough ? null : hover}
                selected={selectedBoxes}
                siblings={siblingBoxes}
                snap={snap}
                editing={editingText !== null}
                passthrough={passthrough}
                onMove={onMove}
                onReorder={onReorder}
                onResize={onResize}
                onToggle={(id) => setSelection((current) => pickSelection(current, id, true))}
                onDoubleClick={onDoubleClick}
              />
            )}
          </div>
          <PropertiesPanel
            kind={kind}
            doc={doc}
            revision={revision}
            selection={selection}
            fonts={fonts}
            onOps={commit}
            onSelect={setSelection}
            onEditText={editText}
            onDuplicate={duplicate}
            onRemove={(ids) => remove(ids)}
          />
        </div>
      </div>
    </ArtifactEditorContext.Provider>
  );
}
