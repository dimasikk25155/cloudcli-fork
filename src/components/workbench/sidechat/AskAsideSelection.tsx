/**
 * «Спросить в стороне»: select text in a message → a small button above the
 * selection → a question about the quote goes to a new side chat (`btw`),
 * opened as a canvas tab. The chat on screen is not interrupted.
 * Shown only while «Побочный чат» (modSideChat) is on.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { Loader2, MessageCircleQuestion, X } from 'lucide-react';

import { useModEnabled } from '../../../hooks/useModEnabled';

import { askAside, openSideChatTab } from './sideChatApi';

type AskAsideSelectionProps = {
  /** The message list; selections outside it are ignored. */
  containerRef: RefObject<HTMLElement>;
  /** The chat on screen; null for a chat not started yet (nothing to ask aside of). */
  parentSessionId: string | null;
};

const QUOTE_MAX = 4000;
const PREVIEW_MAX = 160;
const BUTTON_GAP = 8;

type Anchor = { top: number; left: number };

function selectionInside(container: HTMLElement): { text: string; anchor: Anchor } | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  const node = range.commonAncestorContainer;
  const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  if (!element || !container.contains(element) || element.closest('textarea, input, [contenteditable="true"]')) return null;
  const text = selection.toString().trim();
  if (text.length < 2) return null;
  const rect = range.getBoundingClientRect();
  if (!rect.width && !rect.height) return null;
  return {
    text: text.slice(0, QUOTE_MAX),
    anchor: {
      top: Math.max(BUTTON_GAP, rect.top - 36 - BUTTON_GAP),
      left: Math.min(window.innerWidth - 200, Math.max(BUTTON_GAP, rect.left + rect.width / 2 - 90)),
    },
  };
}

export default function AskAsideSelection({ containerRef, parentSessionId }: AskAsideSelectionProps) {
  const sideChatOn = useModEnabled('modSideChat');
  const workbenchOn = useModEnabled('modWorkbench');
  const [picked, setPicked] = useState<{ text: string; anchor: Anchor } | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const formOpenRef = useRef(false);
  formOpenRef.current = formOpen;

  const close = useCallback(() => {
    setFormOpen(false);
    setPicked(null);
    setQuestion('');
    setNotice(null);
    setBusy(false);
  }, []);

  useEffect(() => {
    if (!sideChatOn || !parentSessionId) return undefined;
    let frame = 0;
    const read = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        // The open form keeps its quote: typing the question clears the selection.
        if (formOpenRef.current) return;
        const container = containerRef.current;
        setPicked(container ? selectionInside(container) : null);
      });
    };
    const hide = () => {
      if (!formOpenRef.current) setPicked(null);
    };
    document.addEventListener('selectionchange', read);
    const container = containerRef.current;
    container?.addEventListener('scroll', hide, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('selectionchange', read);
      container?.removeEventListener('scroll', hide);
    };
  }, [containerRef, parentSessionId, sideChatOn]);

  // A new chat on screen: whatever was picked belonged to the previous one.
  useEffect(() => {
    close();
  }, [parentSessionId, close]);

  if (!sideChatOn || !parentSessionId || !picked) return null;

  const submit = async () => {
    const text = question.trim();
    if (!text || busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const created = await askAside(parentSessionId, { question: text, quote: picked.text });
      if (workbenchOn) {
        openSideChatTab(parentSessionId, created);
        close();
      } else {
        setBusy(false);
        setNotice(`Побочный чат «${created.title}» создан — он в списке слева, под этим чатом.`);
      }
    } catch (error) {
      setBusy(false);
      setNotice(`Не получилось: ${error instanceof Error ? error.message : 'ошибка'}`);
    }
  };

  if (!formOpen) {
    return (
      <button
        type="button"
        // Keep the selection: a plain click would clear it before the form opens.
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setFormOpen(true)}
        style={{ position: 'fixed', top: picked.anchor.top, left: picked.anchor.left }}
        className="z-40 inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-popover px-2.5 text-xs font-medium text-foreground shadow-lg hover:bg-accent"
        data-ask-aside
      >
        <MessageCircleQuestion className="h-3.5 w-3.5" aria-hidden />
        Спросить в стороне
      </button>
    );
  }

  const preview = picked.text.length > PREVIEW_MAX ? `${picked.text.slice(0, PREVIEW_MAX - 1)}…` : picked.text;
  return (
    <div
      role="dialog"
      aria-label="Спросить в стороне"
      style={{ position: 'fixed', top: picked.anchor.top, left: Math.min(picked.anchor.left, window.innerWidth - 340) }}
      className="z-40 w-80 rounded-xl border border-border bg-popover p-2.5 text-sm shadow-xl"
      data-ask-aside
    >
      <div className="mb-1.5 flex items-start gap-2">
        <p className="min-w-0 flex-1 border-l-2 border-primary/60 pl-2 text-xs text-muted-foreground">{preview}</p>
        <button
          type="button"
          onClick={close}
          aria-label="Закрыть"
          className="grid h-5 w-5 flex-shrink-0 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
      <textarea
        autoFocus
        value={question}
        onChange={(event) => setQuestion(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') close();
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            void submit();
          }
        }}
        rows={2}
        placeholder="Что спросить про это?"
        aria-label="Вопрос"
        className="w-full resize-none rounded-lg border border-border bg-background px-2 py-1.5 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary/60"
      />
      {notice && <p className="mt-1.5 text-xs text-muted-foreground">{notice}</p>}
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="text-[11px] text-muted-foreground">Основной чат не прервётся</span>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={!question.trim() || busy}
          className="inline-flex h-7 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground disabled:opacity-40"
        >
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
          Спросить
        </button>
      </div>
    </div>
  );
}
