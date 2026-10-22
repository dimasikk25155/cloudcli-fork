import assert from 'node:assert/strict';
import test from 'node:test';
import { notifyUiPreferencesChanged } from '../../../modules/websocket/index.js';
import { clientIdentities } from '../services/project-access.service.js';
import { connectedClients } from '../services/websocket-state.service.js';
class Client {
    readyState = 1;
    frames = [];
    send(payload) { this.frames.push(payload); }
}
test('a saved settings change pings every open socket of that user, and only of that user', (t) => {
    const phone = new Client();
    const laptop = new Client();
    const closedTab = new Client();
    closedTab.readyState = 3;
    const friend = new Client();
    const anonymous = new Client();
    // Platform auth puts the id under `userId`, sometimes as a string.
    const platformTab = new Client();
    clientIdentities.set(phone, { id: 7 });
    clientIdentities.set(laptop, { id: 7 });
    clientIdentities.set(closedTab, { id: 7 });
    clientIdentities.set(friend, { id: 8 });
    clientIdentities.set(platformTab, { userId: '7' });
    const sockets = [phone, laptop, closedTab, friend, anonymous, platformTab];
    for (const socket of sockets)
        connectedClients.add(socket);
    t.after(() => { for (const socket of sockets)
        connectedClients.delete(socket); });
    notifyUiPreferencesChanged(7);
    for (const socket of [phone, laptop, platformTab]) {
        assert.equal(socket.frames.length, 1);
        // Content-free: the client re-reads GET /api/settings/ui-preferences itself.
        assert.deepEqual(JSON.parse(socket.frames[0]), { kind: 'ui_preferences_changed' });
    }
    assert.deepEqual(closedTab.frames, []);
    assert.deepEqual(friend.frames, []);
    assert.deepEqual(anonymous.frames, []);
});
//# sourceMappingURL=ui-preferences-changed.test.js.map