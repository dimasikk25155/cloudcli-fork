import assert from 'node:assert/strict';
import test from 'node:test';
import { autoPlanApproves, mapCliOptionsToSDK } from './claude-sdk.js';
test('«Планирование + обход» starts the CLI read-only, as plain plan', () => {
    const sdk = mapCliOptionsToSDK({ model: 'opus[1m]', permissionMode: 'planBypass' });
    assert.equal(sdk.permissionMode, 'plan');
    assert.ok(sdk.allowedTools.includes('exit_plan_mode'));
});
test('the server approves the plan itself, so a background tab no longer stalls the run', () => {
    assert.equal(autoPlanApproves('planBypass', 'ExitPlanMode'), true);
    assert.equal(autoPlanApproves('planBypass', 'Bash'), true);
});
test('a real question still waits for the user; other modes still ask', () => {
    assert.equal(autoPlanApproves('planBypass', 'AskUserQuestion'), false);
    assert.equal(autoPlanApproves('plan', 'ExitPlanMode'), false);
    assert.equal(autoPlanApproves('default', 'Bash'), false);
});
//# sourceMappingURL=claude-auto-plan.test.js.map