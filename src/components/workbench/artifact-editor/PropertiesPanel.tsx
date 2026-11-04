/**
 * Панель свойств режима «Правка»: цвета, шрифт, кегль, насыщенность,
 * отступы, прозрачность, текст SVG и действия над выделенным (скрыть,
 * дублировать, слой выше/ниже, удалить, выбрать родителя). Значения — из
 * инлайн-стиля элемента разобранной копии; пустое поле = «как на странице».
 */

import React, { useEffect, useState } from 'react';
import { ArrowDownToLine, ArrowUpToLine, Copy, CornerLeftUp, Eye, EyeOff, Pencil, Trash2, X } from 'lucide-react';

import { NEO3_ID_ATTR, type EditorDocKind, type EditorOp, type StyleProp } from './editorModel';
import { findEditorElement, textOnlyElement } from './editorDom';
import { SYSTEM_FONTS, pxNumber, readInlineStyle, toHexColor } from './editorUiModel';

const SVG_NS = 'http://www.w3.org/2000/svg';

const btn = 'inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2 py-1 text-xs text-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50';
const input = 'w-full min-w-0 rounded-md border border-border bg-background px-1.5 py-1 text-xs text-foreground';
const label = 'text-[11px] text-muted-foreground';

const WEIGHTS: { value: string; title: string }[] = [
  { value: '300', title: 'Тонкий' },
  { value: '400', title: 'Обычный' },
  { value: '500', title: 'Средний' },
  { value: '600', title: 'Полужирный' },
  { value: '700', title: 'Жирный' },
  { value: '900', title: 'Чёрный' },
];
const SIDES: { suffix: 'top' | 'right' | 'bottom' | 'left'; title: string; mark: string }[] = [
  { suffix: 'top', title: 'сверху', mark: '↑' },
  { suffix: 'right', title: 'справа', mark: '→' },
  { suffix: 'bottom', title: 'снизу', mark: '↓' },
  { suffix: 'left', title: 'слева', mark: '←' },
];

/** A text field that commits on Enter or leaving it (not on every key). */
function DraftField(props: { value: string; placeholder?: string; ariaLabel: string; onCommit: (value: string) => void; multiline?: boolean }) {
  const [draft, setDraft] = useState(props.value);
  useEffect(() => setDraft(props.value), [props.value]);
  const commit = () => {
    if (draft !== props.value) props.onCommit(draft);
  };
  const common = {
    value: draft,
    placeholder: props.placeholder,
    'aria-label': props.ariaLabel,
    className: input,
    onBlur: commit,
  };
  if (props.multiline) {
    return (
      <textarea
        {...common}
        rows={3}
        className={`${input} resize-y`}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            commit();
          } else if (event.key === 'Escape') setDraft(props.value);
        }}
      />
    );
  }
  return (
    <input
      {...common}
      type="text"
      onChange={(event) => setDraft(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') commit();
        else if (event.key === 'Escape') setDraft(props.value);
      }}
    />
  );
}

export default function PropertiesPanel(props: {
  kind: EditorDocKind;
  doc: Document;
  /** Re-read the document when it grows. */
  revision: number;
  selection: string[];
  fonts: string[];
  onOps: (ops: EditorOp[], options?: { coalesceKey?: string }) => void;
  onSelect: (ids: string[]) => void;
  onEditText: (id: string) => void;
  onDuplicate: (ids: string[]) => void;
  onRemove: (ids: string[]) => void;
  /** Narrow canvas: the panel is a drawer over the page, full width of its holder. */
  drawer?: boolean;
}) {
  const { doc, selection } = props;
  const width = props.drawer ? 'w-full' : 'w-64 max-w-[40%]';
  const primaryId = selection.at(-1) ?? null;
  const element = primaryId ? findEditorElement(doc, primaryId) : null;

  if (!primaryId || !element) {
    return (
      <aside className={`flex ${width} flex-shrink-0 flex-col gap-2 overflow-y-auto border-l border-border/70 bg-card/50 p-3 text-xs text-muted-foreground`} aria-label="Свойства">
        <p className="font-medium text-foreground">Ничего не выделено</p>
        <p>Наведи на элемент и кликни. Shift — добавить к выделению.</p>
        <p>Тяни рамку — сдвинуть (в строке или сетке — поменять порядок). Ручки — размер.</p>
        <p>Двойной клик — править текст или выбрать элемент внутри.</p>
        <p>Отмена — ⌘Z, повтор — ⇧⌘Z. Alt при перетаскивании — без привязки.</p>
      </aside>
    );
  }

  const style = element.getAttribute('style');
  const value = (prop: string) => readInlineStyle(style, prop) ?? '';
  const isSvg = element.namespaceURI === SVG_NS;
  const textOnly = textOnlyElement(element);
  const hidden = value('display').toLowerCase() === 'none';
  const tag = element.localName.toLowerCase();
  const parentId = element.parentElement?.getAttribute(NEO3_ID_ATTR) ?? null;
  const many = selection.length > 1;

  const setStyle = (prop: StyleProp, next: string | null, coalesce = false) => {
    const clean = next === null || next.trim() === '' ? null : next.trim();
    props.onOps(selection.map((id) => ({ type: 'style', id, prop, value: clean })), coalesce ? { coalesceKey: `${selection.join(',')}:${prop}` } : undefined);
  };
  const setPx = (prop: StyleProp, raw: string) => {
    const text = raw.trim();
    if (!text) return setStyle(prop, null);
    const n = pxNumber(text);
    setStyle(prop, n === null ? text : `${n}px`);
  };

  const colorRow = (prop: StyleProp, title: string) => {
    const current = value(prop);
    const hex = toHexColor(current);
    return (
      <div className="space-y-1" key={prop}>
        <span className={label}>{title}</span>
        <div className="flex items-center gap-1.5">
          <input
            type="color"
            aria-label={`${title}: выбрать`}
            value={hex ?? '#000000'}
            onChange={(event) => setStyle(prop, event.target.value, true)}
            className="h-7 w-8 flex-shrink-0 cursor-pointer rounded border border-border bg-background p-0.5"
          />
          <DraftField value={current} placeholder="как на странице" ariaLabel={`${title}: HEX`} onCommit={(next) => setStyle(prop, next)} />
          {current && (
            <button type="button" className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground" onClick={() => setStyle(prop, null)} title="Убрать" aria-label={`${title}: убрать`}>
              <X className="h-3 w-3" aria-hidden />
            </button>
          )}
        </div>
      </div>
    );
  };

  const fontOptions = Array.from(new Set([...props.fonts, ...SYSTEM_FONTS]));
  const currentFont = value('font-family');
  const opacity = Number.parseFloat(value('opacity'));

  return (
    <aside className={`flex ${width} flex-shrink-0 flex-col gap-3 overflow-y-auto border-l border-border/70 bg-card/50 p-3 text-sm`} aria-label="Свойства">
      <div className="space-y-1">
        <p className="font-medium text-foreground">{many ? `Выделено: ${selection.length}` : `<${tag}>`}</p>
        {many && <p className={label}>Значения — у последнего выделенного; правка — у всех.</p>}
        {hidden && <p className="rounded bg-amber-500/10 px-2 py-1 text-[11px] text-foreground">Элемент скрыт</p>}
      </div>

      <div className="flex flex-wrap gap-1">
        <button type="button" className={btn} onClick={() => props.onOps(selection.map((id) => ({ type: 'hide', id, hidden: !hidden })))}>
          {hidden ? <Eye className="h-3.5 w-3.5" aria-hidden /> : <EyeOff className="h-3.5 w-3.5" aria-hidden />}{hidden ? 'Показать' : 'Скрыть'}
        </button>
        <button type="button" className={btn} onClick={() => props.onDuplicate(selection)}>
          <Copy className="h-3.5 w-3.5" aria-hidden />Дублировать
        </button>
        <button type="button" className={btn} onClick={() => props.onOps(selection.map((id) => ({ type: 'layer', id, dir: 'up' })))} title="На один слой выше (позже в документе)">
          <ArrowUpToLine className="h-3.5 w-3.5" aria-hidden />Выше
        </button>
        <button type="button" className={btn} onClick={() => props.onOps(selection.map((id) => ({ type: 'layer', id, dir: 'down' })))} title="На один слой ниже">
          <ArrowDownToLine className="h-3.5 w-3.5" aria-hidden />Ниже
        </button>
        <button type="button" className={btn} onClick={() => props.onRemove(selection)}>
          <Trash2 className="h-3.5 w-3.5" aria-hidden />Удалить
        </button>
        {!many && parentId && (
          <button type="button" className={btn} onClick={() => props.onSelect([parentId])}>
            <CornerLeftUp className="h-3.5 w-3.5" aria-hidden />Родитель
          </button>
        )}
      </div>

      {!many && textOnly && (
        isSvg ? (
          <div className="space-y-1">
            <span className={label}>Текст</span>
            <DraftField multiline value={element.textContent ?? ''} ariaLabel="Текст" onCommit={(text) => props.onOps([{ type: 'text', id: primaryId, text }])} />
          </div>
        ) : (
          <button type="button" className={btn} onClick={() => props.onEditText(primaryId)}>
            <Pencil className="h-3.5 w-3.5" aria-hidden />Править текст на месте
          </button>
        )
      )}

      <section className="space-y-2" aria-label="Цвет">
        {isSvg ? [colorRow('fill', 'Заливка'), colorRow('stroke', 'Обводка')] : [colorRow('color', 'Цвет текста'), colorRow('background-color', 'Фон')]}
        {isSvg && textOnly && colorRow('color', 'Цвет текста')}
      </section>

      {(!isSvg || textOnly) && (
        <section className="space-y-2" aria-label="Шрифт">
          <div className="space-y-1">
            <span className={label}>Шрифт</span>
            <select
              aria-label="Шрифт"
              className={input}
              value={currentFont}
              onChange={(event) => setStyle('font-family', event.target.value || null)}
            >
              <option value="">как на странице</option>
              {currentFont && !fontOptions.includes(currentFont) && <option value={currentFont}>{currentFont}</option>}
              {fontOptions.map((font) => <option key={font} value={font}>{font}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <label className="space-y-1">
              <span className={label}>Кегль, px</span>
              <DraftField value={value('font-size').replace(/px$/i, '')} placeholder="авто" ariaLabel="Кегль" onCommit={(next) => setPx('font-size', next)} />
            </label>
            <label className="space-y-1">
              <span className={label}>Насыщенность</span>
              <select aria-label="Насыщенность" className={input} value={value('font-weight')} onChange={(event) => setStyle('font-weight', event.target.value || null)}>
                <option value="">как на странице</option>
                {value('font-weight') && !WEIGHTS.some((w) => w.value === value('font-weight')) && <option value={value('font-weight')}>{value('font-weight')}</option>}
                {WEIGHTS.map((w) => <option key={w.value} value={w.value}>{w.title}</option>)}
              </select>
            </label>
          </div>
        </section>
      )}

      {!isSvg && (['margin', 'padding'] as const).map((box) => (
        <section key={box} className="space-y-1" aria-label={box === 'margin' ? 'Отступы снаружи' : 'Отступы внутри'}>
          <span className={label}>{box === 'margin' ? 'Отступы снаружи, px' : 'Отступы внутри, px'}</span>
          <div className="grid grid-cols-4 gap-1">
            {SIDES.map(({ suffix, title, mark }) => {
              const prop = `${box}-${suffix}` as StyleProp;
              return (
                <DraftField key={prop} value={value(prop).replace(/px$/i, '')} placeholder={mark} ariaLabel={`${box === 'margin' ? 'Отступ снаружи' : 'Отступ внутри'} ${title}`} onCommit={(next) => setPx(prop, next)} />
              );
            })}
          </div>
        </section>
      ))}

      <label className="space-y-1">
        <span className={label}>Прозрачность: {Number.isFinite(opacity) ? `${Math.round(opacity * 100)}%` : 'как на странице'}</span>
        <input
          type="range"
          min={0}
          max={100}
          aria-label="Прозрачность"
          value={Number.isFinite(opacity) ? Math.round(opacity * 100) : 100}
          onChange={(event) => setStyle('opacity', String(Number(event.target.value) / 100), true)}
          className="w-full"
        />
      </label>
    </aside>
  );
}
