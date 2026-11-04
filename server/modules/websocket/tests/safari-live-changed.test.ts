import assert from 'node:assert/strict';
import test from 'node:test';

import { notifySafariLiveChanged } from '@/modules/websocket/index.js';

import { clientIdentities } from '../services/project-access.service.js';
import { connectedClients } from '../services/websocket-state.service.js';

class Client {
  readyState = 1;
  frames: string[] = [];
  send(payload: string) { this.frames.push(payload); }
}

test('safari_live_changed carries only the chat id and goes to that user’s open sockets only', (t) => {
  const laptop = new Client();
  const phone = new Client();
  const closedTab = new Client();
  closedTab.readyState = 3;
  const friend = new Client();
  const anonymous = new Client();

  clientIdentities.set(laptop, { id: 1 });
  clientIdentities.set(phone, { userId: '1' });
  clientIdentities.set(closedTab, { id: 1 });
  clientIdentities.set(friend, { id: 2 });
  const sockets = [laptop, phone, closedTab, friend, anonymous];
  for (const socket of sockets) connectedClients.add(socket);
  t.after(() => { for (const socket of sockets) connectedClients.delete(socket); });

  notifySafariLiveChanged(1, 'chat-42');

  for (const socket of [laptop, phone]) {
    assert.equal(socket.frames.length, 1);
    assert.deepEqual(JSON.parse(socket.frames[0]), { kind: 'safari_live_changed', sessionId: 'chat-42' });
  }
  assert.deepEqual(closedTab.frames, []);
  assert.deepEqual(friend.frames, []);
  assert.deepEqual(anonymous.frames, []);
});
