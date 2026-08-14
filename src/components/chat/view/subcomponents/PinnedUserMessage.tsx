import { memo, useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

interface PinnedUserMessageProps {
  scrollContainerRef: RefObject<HTMLDivElement>;
  /** Changes whenever the rendered list changes, so the pin re-measures. */
  revision: number;
}

/** How far above the pane's top edge counts as "this prompt has scrolled away". */
const PASSED_TOP_EPSILON = 1;
/** Breathing room left above the message when the pin is tapped to jump back. */
const JUMP_BACK_OFFSET = 12;

/**
 * Keeps the prompt whose answer you are reading docked at the top of the chat,
 * the way VS Code's chat view does: once a user message scrolls off the top
 * edge, a compact bar takes its place until the next prompt reaches the top.
 *
 * Reads positions off the DOM rather than the message array — the pane already
 * owns the layout, so one rAF-throttled pass over `.chat-message.user` per
 * scroll is cheaper than threading offsets through render, and it stays correct
 * while a reply streams and reflows beneath.
 */
function PinnedUserMessage({ scrollContainerRef, revision }: PinnedUserMessageProps) {
  const [pinnedText, setPinnedText] = useState<string | null>(null);
  const pinnedElementRef = useRef<HTMLElement | null>(null);
  const frameRef = useRef<number | null>(null);

  const measure = useCallback(() => {
    frameRef.current = null;
    const container = scrollContainerRef.current;
    if (!container) return;

    const containerTop = container.getBoundingClientRect().top;
    const messages = container.querySelectorAll<HTMLElement>('.chat-message.user');

    // DOM order is visual order, so the last message still above the top edge
    // is the one to pin; everything after it is on screen already.
    let current: HTMLElement | null = null;
    for (let i = 0; i < messages.length; i += 1) {
      const node = messages[i];
      if (node.getBoundingClientRect().top - containerTop >= PASSED_TOP_EPSILON) break;
      current = node;
    }

    pinnedElementRef.current = current;
    const text = current?.dataset.userMessageText?.trim() || null;
    setPinnedText((previous) => (previous === text ? previous : text));
  }, [scrollContainerRef]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const schedule = () => {
      if (frameRef.current === null) frameRef.current = requestAnimationFrame(measure);
    };

    container.addEventListener('scroll', schedule, { passive: true });
    schedule();

    return () => {
      container.removeEventListener('scroll', schedule);
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    };
    // `revision` re-runs this so a new message re-measures without a scroll.
  }, [measure, revision, scrollContainerRef]);

  const jumpToPinnedMessage = useCallback(() => {
    const container = scrollContainerRef.current;
    const element = pinnedElementRef.current;
    if (!container || !element) return;
    const delta = element.getBoundingClientRect().top - container.getBoundingClientRect().top;
    container.scrollTop = container.scrollTop + delta - JUMP_BACK_OFFSET;
  }, [scrollContainerRef]);

  if (!pinnedText) return null;

  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-20 px-4">
      <div className="mx-auto w-full max-w-[54.25rem]">
        <button
          type="button"
          onClick={jumpToPinnedMessage}
          title={pinnedText}
          className="pointer-events-auto block w-full rounded-b-xl border-b border-border/60 bg-card/95 px-3 py-2 text-left shadow-sm backdrop-blur transition-colors hover:bg-accent sm:px-4"
        >
          <span dir="auto" className="line-clamp-2 whitespace-pre-wrap break-words font-serif text-sm text-foreground/90">
            {pinnedText}
          </span>
        </button>
      </div>
    </div>
  );
}

export default memo(PinnedUserMessage);
