/**
 * Opt-in drag-and-drop probe: open any Neo3 page with `?dragdebug=1` (sticks
 * for the tab via sessionStorage, `?dragdebug=0` turns it off). A corner panel
 * then lists every drag event the page receives and what the browser put in
 * it. Built 13.10.2026 to see what Telegram Desktop hands Firefox — a drop that
 * never reaches the page cannot be logged anywhere else.
 */
const KEY = 'neo3-drag-debug';

type Line = string;

const describe = (event: DragEvent): Line => {
  const transfer = event.dataTransfer;
  if (!transfer) {
    return `${event.type}: без dataTransfer`;
  }
  const types = Array.from(transfer.types ?? []);
  const files = Array.from(transfer.files ?? []).map((file) => `${file.name || '?'}(${file.size}б,${file.type || 'без типа'})`);
  const items = Array.from(transfer.items ?? []).map((item) => `${item.kind}:${item.type || '?'}`);
  let detail = '';
  if (event.type === 'drop') {
    detail = types
      .filter((type) => type !== 'Files')
      .map((type) => {
        try {
          return `${type}=${JSON.stringify(transfer.getData(type).slice(0, 160))}`;
        } catch {
          return `${type}=<нечитаемо>`;
        }
      })
      .join(' ');
  }
  const target = event.target instanceof Element ? event.target.tagName.toLowerCase() : '?';
  return `${event.type} → ${target} | types=[${types.join(', ')}] items=[${items.join(', ')}] files=[${files.join(', ')}]${detail ? ` | ${detail}` : ''}`;
};

export const installDragDebug = (): void => {
  if (typeof window === 'undefined') {
    return;
  }
  const flag = new URLSearchParams(window.location.search).get('dragdebug');
  if (flag === '1') sessionStorage.setItem(KEY, '1');
  if (flag === '0') sessionStorage.removeItem(KEY);
  if (sessionStorage.getItem(KEY) !== '1') {
    return;
  }

  const panel = document.createElement('pre');
  panel.setAttribute('data-drag-debug', '');
  panel.style.cssText = [
    'position:fixed', 'left:8px', 'bottom:8px', 'z-index:2147483647', 'max-width:min(900px,95vw)',
    'max-height:40vh', 'overflow:auto', 'margin:0', 'padding:8px 10px', 'font:11px/1.4 ui-monospace,monospace',
    'white-space:pre-wrap', 'word-break:break-all', 'background:rgba(0,0,0,.85)', 'color:#7CFC9A',
    'border:1px solid #7CFC9A', 'border-radius:8px', 'pointer-events:none',
  ].join(';');
  panel.textContent = 'dragdebug: жду перетаскивание…';
  document.body.appendChild(panel);

  const lines: Line[] = [];
  let lastOver = '';
  const push = (line: Line) => {
    lines.push(`${new Date().toLocaleTimeString()} ${line}`);
    panel.textContent = lines.slice(-14).join('\n');
  };

  for (const type of ['dragenter', 'dragover', 'dragleave', 'drop', 'dragend'] as const) {
    window.addEventListener(type, (event) => {
      const line = describe(event as DragEvent);
      // dragover fires continuously — log only when its content changes.
      if (type === 'dragover') {
        if (line === lastOver) return;
        lastOver = line;
      }
      push(line);
    }, true);
  }
};
