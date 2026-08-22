import React, { useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { useTranslation } from 'react-i18next';
import { normalizeInlineCodeFences } from '../../utils/chatFormatting';
import { bracketSpacedLinkTargets, looksLikePath, shortenPathLabel, stripLineSuffix } from '../../utils/filePathDetection';
import { copyTextToClipboard } from '../../../../utils/clipboard';
import { usePaletteOps } from '../../../../contexts/PaletteOpsContext';
import { useTheme } from '../../../../contexts/ThemeContext';

type MarkdownProps = {
  children: React.ReactNode;
  className?: string;
};

// Links to the wider web (or in-page anchors) keep normal browser navigation;
// everything else is treated as a workspace file reference.
const isExternalHref = (href?: string): boolean =>
  !!href && (/^(https?:|mailto:|tel:|data:)/i.test(href) || href.startsWith('#'));

// Что считается путём — в `../../utils/filePathDetection`: правило одно на
// бэктики и на ссылки, и оно покрыто тестами (пробелы в пути, папки, команды).

// Extract plain text from link children so a reference rendered only as link
// text (e.g. `[src/foo.ts]()` with an empty href) can still be opened.
const childrenToText = (children: React.ReactNode): string => {
  if (typeof children === 'string' || typeof children === 'number') {
    return String(children);
  }
  if (Array.isArray(children)) {
    return children.map(childrenToText).join('');
  }
  if (React.isValidElement(children)) {
    return childrenToText((children.props as { children?: React.ReactNode }).children);
  }
  return '';
};

type CodeBlockProps = {
  node?: any;
  inline?: boolean;
  className?: string;
  children?: React.ReactNode;
};

const CodeBlock = ({ node, inline, className, children, ...props }: CodeBlockProps) => {
  const { t } = useTranslation('chat');
  const { isDarkMode } = useTheme();
  const { openFileInEditor } = usePaletteOps();
  const [copied, setCopied] = useState(false);
  const raw = Array.isArray(children) ? children.join('') : String(children ?? '');
  const looksMultiline = /[\r\n]/.test(raw);
  const inlineDetected = inline || (node && node.type === 'inlineCode');
  const shouldInline = inlineDetected || !looksMultiline;

  if (shouldInline) {
    if (looksLikePath(raw)) {
      const fileRef = stripLineSuffix(raw.trim());
      const open = () => openFileInEditor(fileRef);

      return (
        <code
          role="button"
          tabIndex={0}
          title={fileRef}
          onClick={open}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              open();
            }
          }}
          className={`cursor-pointer whitespace-pre-wrap break-words rounded-md border border-blue-300 bg-blue-50 px-1.5 py-0.5 font-mono text-[0.9em] text-blue-700 underline decoration-dotted underline-offset-2 hover:bg-blue-100 dark:border-blue-500/40 dark:bg-blue-500/10 dark:text-blue-300 dark:hover:bg-blue-500/20 ${className || ''
            }`}
          {...props}
        >
          {shortenPathLabel(raw)}
        </code>
      );
    }

    return (
      <code
        className={`whitespace-pre-wrap break-words rounded-md border border-gray-200 bg-gray-100 px-1.5 py-0.5 font-mono text-[0.9em] text-gray-900 dark:border-gray-700 dark:bg-gray-800/60 dark:text-gray-100 ${className || ''
          }`}
        {...props}
      >
        {children}
      </code>
    );
  }

  const match = /language-(\w+)/.exec(className || '');
  const language = match ? match[1] : 'text';

  return (
    <div className="group relative my-2">
      {language && language !== 'text' && (
        <div className="absolute left-3 top-2 z-10 text-xs font-medium uppercase text-gray-400">{language}</div>
      )}

      <button
        type="button"
        onClick={() =>
          copyTextToClipboard(raw).then((success) => {
            if (success) {
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }
          })
        }
        className="absolute right-2 top-2 z-10 rounded-md border border-border bg-card/90 px-2 py-1 text-xs text-foreground/80 opacity-0 transition-opacity hover:bg-muted focus:opacity-100 active:opacity-100 group-hover:opacity-100"
        title={copied ? t('codeBlock.copied') : t('codeBlock.copyCode')}
        aria-label={copied ? t('codeBlock.copied') : t('codeBlock.copyCode')}
      >
        {copied ? (
          <span className="flex items-center gap-1">
            <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                clipRule="evenodd"
              />
            </svg>
            {t('codeBlock.copied')}
          </span>
        ) : (
          <span className="flex items-center gap-1">
            <svg
              className="h-3.5 w-3.5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
              <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"></path>
            </svg>
            {t('codeBlock.copy')}
          </span>
        )}
      </button>

      <SyntaxHighlighter
        language={language}
        style={isDarkMode ? oneDark : oneLight}
        customStyle={{
          margin: 0,
          borderRadius: '0.75rem',
          fontSize: '0.875rem',
          padding: language && language !== 'text' ? '2rem 1rem 1rem 1rem' : '1rem',
          // ChatGPT-style soft grey block in light mode; keep oneDark's own bg in dark.
          ...(isDarkMode ? {} : { background: 'hsl(var(--muted))' }),
        }}
        codeTagProps={{
          style: {
            fontFamily:
              'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
            ...(isDarkMode ? {} : { background: 'transparent' }),
          },
        }}
      >
        {raw}
      </SyntaxHighlighter>
    </div>
  );
};

const markdownComponents = {
  code: CodeBlock,
  // CodeBlock renders its own syntax-highlighted <pre>; this passthrough stops
  // react-markdown (and Tailwind Typography) from wrapping it in a second,
  // dark-themed <pre> shell that would frame the block.
  pre: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  blockquote: ({ children }: { children?: React.ReactNode }) => (
    <blockquote className="my-2 border-l-4 border-gray-300 pl-4 italic text-gray-600 dark:border-gray-600 dark:text-gray-400">
      {children}
    </blockquote>
  ),
  p: ({ children }: { children?: React.ReactNode }) => <div className="mb-2 last:mb-0">{children}</div>,
  table: ({ children }: { children?: React.ReactNode }) => (
    <div className="my-2 overflow-x-auto">
      <table className="min-w-full border-collapse border border-gray-200 dark:border-gray-700">{children}</table>
    </div>
  ),
  thead: ({ children }: { children?: React.ReactNode }) => <thead className="bg-gray-50 dark:bg-gray-800">{children}</thead>,
  th: ({ children }: { children?: React.ReactNode }) => (
    <th className="border border-gray-200 px-3 py-2 text-left text-sm font-semibold dark:border-gray-700">{children}</th>
  ),
  td: ({ children }: { children?: React.ReactNode }) => (
    <td className="border border-gray-200 px-3 py-2 align-top text-sm dark:border-gray-700">{children}</td>
  ),
};

export function Markdown({ children, className }: MarkdownProps) {
  // Скобки вокруг адресов с пробелами дописываются ДО разбора: иначе
  // `[отчёт](/home/agents/Antigravity Project/D5.md)` вообще не станет ссылкой.
  const content = bracketSpacedLinkTargets(normalizeInlineCodeFences(String(children ?? '')));
  // Одиночный `$` НЕ начинает формулу: иначе «на $30 ... до $100» уходит
  // в KaTeX целиком и рендерится без пробелов. Блочный `$$...$$` работает.
  const remarkPlugins = useMemo(() => [remarkGfm, [remarkMath, { singleDollarTextMath: false }] as [typeof remarkMath, object]], []);
  const rehypePlugins = useMemo(() => [rehypeKatex], []);
  const { openFileInEditor } = usePaletteOps();

  const components = useMemo(
    () => ({
      ...markdownComponents,
      a: ({ href, children: linkChildren }: { href?: string; children?: React.ReactNode }) => {
        // Prefer the href when it is a real path; otherwise fall back to the
        // link text, since models often emit `[src/foo.ts]()` with an empty href.
        const linkText = childrenToText(linkChildren);
        const fileRef = looksLikePath(href) ? href : looksLikePath(linkText) ? linkText : undefined;

        if (fileRef && !isExternalHref(href)) {
          return (
            <a
              href={href || fileRef}
              title={fileRef}
              className="cursor-pointer text-blue-600 hover:underline dark:text-blue-400"
              onClick={(event) => {
                event.preventDefault();
                openFileInEditor(stripLineSuffix(fileRef));
              }}
            >
              {linkText === fileRef ? shortenPathLabel(fileRef) : linkChildren}
            </a>
          );
        }

        return (
          <a
            href={href}
            className="text-blue-600 hover:underline dark:text-blue-400"
            target="_blank"
            rel="noopener noreferrer"
          >
            {linkChildren}
          </a>
        );
      },
    }),
    [openFileInEditor],
  );

  return (
    <div className={className}>
      <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} components={components as any}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
