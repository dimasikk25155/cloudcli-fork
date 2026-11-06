import assert from 'node:assert/strict';
import { test } from 'node:test';

import { composerSubmitAction } from './composerSubmitAction';

test('recording while the agent works sends the dictation instead of stopping the run', () => {
  assert.equal(composerSubmitAction({ isRecording: true, canQueueDraft: false, isLoading: true }), 'voice-send');
  assert.equal(composerSubmitAction({ isRecording: true, canQueueDraft: true, isLoading: true }), 'voice-send');
});

test('recording with an idle agent sends the dictation', () => {
  assert.equal(composerSubmitAction({ isRecording: true, canQueueDraft: false, isLoading: false }), 'voice-send');
});

test('typed text during a run is queued, an empty box stops the run', () => {
  assert.equal(composerSubmitAction({ isRecording: false, canQueueDraft: true, isLoading: true }), 'queue');
  assert.equal(composerSubmitAction({ isRecording: false, canQueueDraft: false, isLoading: true }), 'abort');
});

test('idle composer submits the form', () => {
  assert.equal(composerSubmitAction({ isRecording: false, canQueueDraft: false, isLoading: false }), 'submit');
});
