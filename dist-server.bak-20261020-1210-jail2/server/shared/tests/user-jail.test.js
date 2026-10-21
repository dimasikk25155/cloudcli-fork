import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { closeConnection, initializeDatabase, userDb } from '../../modules/database/index.js';
import { buildJailProfile, jailCommand, jailInstruction, jailSupported, SANDBOX_EXEC, userJailFor, } from '../../shared/user-jail.js';
test('userJailFor: admins run free, teammates are fenced to the project folder', async (t) => {
    const tempDirectory = await realpath(await mkdtemp(path.join(tmpdir(), 'user-jail-')));
    const previousDatabasePath = process.env.DATABASE_PATH;
    const previousSwitch = process.env.NEO3_USER_JAIL;
    t.after(async () => {
        closeConnection();
        if (previousDatabasePath === undefined)
            delete process.env.DATABASE_PATH;
        else
            process.env.DATABASE_PATH = previousDatabasePath;
        if (previousSwitch === undefined)
            delete process.env.NEO3_USER_JAIL;
        else
            process.env.NEO3_USER_JAIL = previousSwitch;
        await rm(tempDirectory, { recursive: true, force: true });
    });
    delete process.env.NEO3_USER_JAIL;
    closeConnection();
    process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
    await initializeDatabase();
    const dima = Number(userDb.createUserWithRole('dima', 'hash', 'admin').id);
    const slavik = Number(userDb.createUserWithRole('slavik', 'hash', 'user').id);
    const project = path.join(tempDirectory, 'project');
    await mkdir(project);
    assert.equal(userJailFor(dima, project), null);
    if (!jailSupported())
        return;
    assert.deepEqual(userJailFor(slavik, project), { root: project });
    // Unknown user is not an admin: fenced, never free.
    assert.deepEqual(userJailFor(999, project), { root: project });
    // No folder to fence to → the run must not start.
    assert.equal(userJailFor(slavik, null), 'deny');
    assert.equal(userJailFor(slavik, path.join(tempDirectory, 'missing')), 'deny');
    assert.equal(userJailFor(slavik, '/'), 'deny');
    process.env.NEO3_USER_JAIL = 'off';
    assert.equal(userJailFor(slavik, project), null);
});
test('buildJailProfile: home closed, project open, Dima history closed again', () => {
    const profile = buildJailProfile({ root: '/Users/d/Work/proj "x"' }, '/Users/d', '/Users/d/app');
    assert.match(profile, /\(deny file-read\* file-write\* \(subpath "\/Users\/d"\) \(subpath "\/Volumes"\)\)/);
    assert.match(profile, /\(allow file-read\* file-write\* \(subpath "\/Users\/d\/Work\/proj \\"x\\""\)\)$/);
    assert.match(profile, /\(deny file-read\* \(literal "\/Users\/d\/\.claude\/history\.jsonl"\)/);
    assert.match(profile, /\(subpath "\/Users\/d\/app\/dist-server"\)/);
    assert.doesNotMatch(profile, /\(subpath "\/Users\/d\/app"\)/, 'the app folder holds .env — never opened whole');
    // Own transcripts only: ~/.claude/projects/<cwd with non-alphanumerics → '-'>.
    assert.match(profile, /-Users-d-Work-proj--x-/);
    const readOnly = buildJailProfile({ root: '/Users/d/p', readOnly: true }, '/Users/d', null);
    assert.match(readOnly, /\(allow file-read\* \(subpath "\/Users\/d\/p"\)\)$/);
    assert.deepEqual(jailCommand({ root: '/p' }, '/bin/sh', ['-c', 'ls']).args.slice(-3), ['/bin/sh', '-c', 'ls']);
    assert.equal(jailCommand({ root: '/p' }, '/bin/sh', []).command, SANDBOX_EXEC);
    assert.match(jailInstruction({ root: '/p' }), /Диме/);
});
test('the jail really holds: inside the project yes, above it no', { skip: !jailSupported() }, async (t) => {
    const home = await realpath(await mkdtemp(path.join(tmpdir(), 'user-jail-home-')));
    t.after(() => rm(home, { recursive: true, force: true }));
    const project = path.join(home, 'Projects', 'mine');
    await mkdir(project, { recursive: true });
    await writeFile(path.join(home, 'Projects', '.secrets.env'), 'KEY=1\n');
    await writeFile(path.join(project, 'readme.txt'), 'hello\n');
    const { command, args } = {
        command: SANDBOX_EXEC,
        args: ['-p', buildJailProfile({ root: project }, home, null)],
    };
    const run = (script) => spawnSync(command, [...args, '/bin/sh', '-c', script], { cwd: project, encoding: 'utf8' });
    assert.equal(run('cat readme.txt').stdout, 'hello\n');
    assert.equal(run('echo ok > new.txt && cat new.txt').stdout, 'ok\n');
    assert.notEqual(run('cat ../.secrets.env').status, 0);
    assert.notEqual(run('ls ..').status, 0);
    assert.notEqual(run('echo x > ../escape.txt').status, 0);
    assert.equal(spawnSync('/bin/test', ['-e', path.join(home, 'Projects', 'escape.txt')]).status, 1);
    // Read-only jail: reading yes, writing no.
    const ro = buildJailProfile({ root: project, readOnly: true }, home, null);
    assert.equal(execFileSync(SANDBOX_EXEC, ['-p', ro, '/bin/cat', 'readme.txt'], { cwd: project, encoding: 'utf8' }), 'hello\n');
    assert.notEqual(spawnSync(SANDBOX_EXEC, ['-p', ro, '/usr/bin/touch', 'w.txt'], { cwd: project }).status, 0);
});
//# sourceMappingURL=user-jail.test.js.map