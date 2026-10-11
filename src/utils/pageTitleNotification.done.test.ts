import assert from 'node:assert/strict';
import test from 'node:test';

import { setPageAttentionCount, setPageBaseTitle, showCompletionTitleIndicator } from './pageTitleNotification';

// Own file: the module keeps its title parts for the life of the process.
test('[Done] before any base title: base is the static default, never re-read from document.title', () => {
  const listeners = { addEventListener: () => {}, removeEventListener: () => {} };
  const fakeDocument = {
    ...listeners,
    title: '(7) [Done] старый заголовок',
    visibilityState: 'hidden',
    hasFocus: () => false,
  };
  const fakeWindow = { ...listeners, setTimeout: () => 0, clearTimeout: () => {} };
  const globals = globalThis as { document?: unknown; window?: unknown };
  const previous = { document: globals.document, window: globals.window };
  globals.document = fakeDocument;
  globals.window = fakeWindow;
  try {
    setPageAttentionCount(2);
    assert.equal(fakeDocument.title, '(2) Neo3 Agent System');

    showCompletionTitleIndicator();
    assert.equal(fakeDocument.title, '(2) [Done] Neo3 Agent System');

    // A second completion must not stack prefixes from the title it wrote itself.
    showCompletionTitleIndicator();
    assert.equal(fakeDocument.title, '(2) [Done] Neo3 Agent System');

    setPageBaseTitle('alpha — Neo3 Agent System');
    assert.equal(fakeDocument.title, '(2) [Done] alpha — Neo3 Agent System');
  } finally {
    globals.document = previous.document;
    globals.window = previous.window;
  }
});
