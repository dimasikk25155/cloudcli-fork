/**
 * «Попросить агента» по выделению в режиме «Правка» (слот `toolbarExtras`).
 * Снимок первого выделенного элемента снимает мост; сообщение — путь файла,
 * CSS-селектор, фрагмент HTML и просьба (`buildSelectionAskMessage`). Куда и
 * как отправить, решает `onAsk` (`ArtifactView`: исходный чат артефакта).
 */

import React, { useEffect, useRef, useState } from 'react';
import { Bot } from 'lucide-react';

import { useArtifactEditor } from '../editorContext';
import { findEditorElement } from '../editorDom';
import { cssPathFor } from '../editorModel';

import AskAgentForm, { type SnapshotState } from './AskAgentForm';
import { buildSelectionAskMessage, dataUrlToFile, snapshotFileName, stripEditorIds, type AskPayload } from './askAgentModel';

const btn = 'inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1 text-xs text-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50';
const btnOn = 'inline-flex items-center gap-1.5 rounded-lg border border-primary bg-primary/10 px-2.5 py-1 text-xs text-foreground';

/** Elements named in one message. */
const MAX_ITEMS = 10;

export default function AskAgentButton({ onAsk, note }: { onAsk: (payload: AskPayload) => void; note?: string | null }) {
  const editor = useArtifactEditor();
  const [open, setOpen] = useState(false);
  const [snapshot, setSnapshot] = useState<File | null>(null);
  const [snapshotState, setSnapshotState] = useState<SnapshotState>('loading');
  const snapshotRef = useRef(editor?.snapshot);
  snapshotRef.current = editor?.snapshot;

  const first = editor?.selection[0] ?? null;
  const ready = Boolean(editor?.ready);
  const title = editor?.artifact.artifact.title ?? '';

  // A snapshot of the first selected element, again when the selection changes while the form is open.
  useEffect(() => {
    if (!open || !first) return undefined;
    let cancelled = false;
    setSnapshot(null);
    setSnapshotState('loading');
    (async () => {
      const dataUrl = ready ? await snapshotRef.current?.(first) ?? null : null;
      if (cancelled) return;
      const file = dataUrlToFile(dataUrl, snapshotFileName(title, new Date()));
      setSnapshot(file);
      setSnapshotState(file ? 'ready' : 'none');
    })();
    return () => {
      cancelled = true;
    };
  }, [first, open, ready, title]);

  if (!editor) return null;
  const { selection, doc, artifact } = editor;

  const send = (request: string) => {
    const items = selection.slice(0, MAX_ITEMS).flatMap((id) => {
      const element = findEditorElement(doc, id);
      if (!element) return [];
      return [{ selector: cssPathFor(doc, id) ?? element.localName, fragment: stripEditorIds(element.outerHTML) }];
    });
    if (items.length === 0) return;
    const text = buildSelectionAskMessage({
      title: artifact.artifact.title,
      filePath: artifact.file.absPath,
      versionN: artifact.artifact.latestVersion,
      items,
      request,
      snapshot: Boolean(snapshot),
      unsavedEdits: editor.dirty,
    });
    onAsk({ text, images: snapshot ? [snapshot] : [] });
    setOpen(false);
  };

  return (
    <span className="relative inline-flex">
      <button
        type="button"
        className={open ? btnOn : btn}
        disabled={selection.length === 0}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        title={selection.length ? 'Сложную правку — агенту: со снимком и селектором выделенного' : 'Сначала выдели элемент'}
      >
        <Bot className="h-3.5 w-3.5" aria-hidden />Попросить агента
      </button>
      {open && selection.length > 0 && (
        <div className="absolute left-0 top-full z-30 mt-1 w-80 max-w-[80vw] rounded-xl border border-border bg-popover p-3 shadow-lg" role="dialog" aria-label="Попросить агента">
          <AskAgentForm
            heading={selection.length > 1 ? `Выделено: ${selection.length}. Снимок — первого` : 'Выделенный элемент'}
            snapshot={snapshot}
            snapshotState={snapshotState}
            onSnapshotChange={(file) => setSnapshot(file)}
            onSend={send}
            onCancel={() => setOpen(false)}
            note={note}
          />
        </div>
      )}
    </span>
  );
}
