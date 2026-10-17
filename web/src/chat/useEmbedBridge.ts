import { useEffect, useRef, type RefObject } from 'react';
import { postToParent } from '../lib/parent';

interface HeightRefs {
  shell: RefObject<HTMLElement | null>;
  log: RefObject<HTMLElement | null>;
  logContent: RefObject<HTMLElement | null>;
}

/**
 * Inline mode: tells embed.js how tall the widget wants to be, so the iframe can follow it.
 * The wanted height is the widget's full height with the message list at its natural
 * (unscrolled) height. It depends only on the content and the width, so resizing the
 * iframe never changes it and there is no feedback loop.
 */
export function useReportHeight(
  enabled: boolean,
  { shell, log, logContent }: HeightRefs,
  hold = false,
): void {
  // While the assistant is typing the buttons give way to three dots, which are shorter. The
  // iframe keeps its height until the next question is there, so the host page doesn't jump.
  const holding = useRef(hold);
  const remeasure = useRef<() => void>(() => undefined);
  useEffect(() => {
    holding.current = hold;
    if (!hold) remeasure.current();
  }, [hold]);

  useEffect(() => {
    const shellEl = shell.current;
    const logEl = log.current;
    const contentEl = logContent.current;
    if (!enabled || !shellEl || !logEl || !contentEl || typeof ResizeObserver === 'undefined') {
      return;
    }
    let lastPosted = 0;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const wanted = Math.ceil(shellEl.offsetHeight - logEl.clientHeight + contentEl.offsetHeight);
      if (wanted <= 0 || wanted === lastPosted) return;
      if (wanted < lastPosted && holding.current) return;
      lastPosted = wanted;
      postToParent({ type: 'adn:resize', height: wanted });
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    remeasure.current = schedule;
    const observer = new ResizeObserver(schedule);
    observer.observe(contentEl);
    for (const child of Array.from(shellEl.children)) observer.observe(child);
    schedule();
    return () => {
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [enabled, shell, log, logContent]);
}

/**
 * Bubble mode: Esc pressed inside the widget never reaches the host page, so ask
 * embed.js to close the panel. Components that use Esc themselves call preventDefault().
 */
export function useEscapeToClose(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) postToParent({ type: 'adn:close' });
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled]);
}
