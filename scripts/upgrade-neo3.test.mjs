import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./upgrade-neo3.sh', import.meta.url));
const fakeTool = `#!/usr/bin/python3
import os, sys, pathlib, json
name=pathlib.Path(sys.argv[0]).name
args=sys.argv[1:]
home=pathlib.Path(os.environ['FIXTURE_HOME'])
sha='a'*40
if name=='uname': print('Linux')
elif name=='id': print('0' if '-u' in args else 'staff')
elif name=='getent': print('fixture:x:501:20:Fixture:'+str(home)+':/bin/bash')
elif name=='df': print('Filesystem 1024-blocks Used Available Capacity Mounted on\\nfake 9000000 0 9000000 0% /')
elif name=='systemctl':
    if 'show' in args:
        key=args[args.index('-p')+1]
        print({'LoadState':'loaded','User':'fixture','WorkingDirectory':str(home/'app')}[key])
    elif 'cat' in args: print('[Service]')
elif name=='git':
    if 'ls-remote' in args: print(sha+' refs/heads/dima/fork-customizations')
    elif 'clone' in args:
        if os.environ.get('FIXTURE_MODE')=='download-fail': sys.exit(1)
        app=pathlib.Path(args[-1]); app.mkdir()
        (app/'dist').mkdir(); (app/'public').mkdir(); (app/'scripts').mkdir()
        (app/'package.json').write_text('{"version":"1.38.0"}')
        (app/'dist/index.html').write_text('<script src="/assets/index-new.js"></script>')
        (app/'marker').write_text('new')
    else: print(sha)
elif name=='runuser':
    command=args[args.index('--')+1:]
    if command[:2]==['env','-i']:
        command[2:2]=['FIXTURE_HOME='+str(home),'FIXTURE_MODE='+os.environ.get('FIXTURE_MODE','')]
    os.execvpe(command[0],command,os.environ)
elif name=='node': print('24')
elif name=='npm': pass
elif name=='curl':
    dest=pathlib.Path(args[args.index('-o')+1])
    url=next(x for x in args if x.startswith('http'))
    if url.endswith('/health'):
        dest.write_text(json.dumps({'status':'bad' if os.environ.get('FIXTURE_MODE')=='bad-health' else 'ok'}))
    else: dest.write_text('<script src="/assets/index-new.js"></script>')
elif name in ['chown','sleep']: pass
else: sys.exit('Unexpected fake tool '+name)
`;

async function fixture(t, mode) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'neo3-updater-test-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const home = path.join(dir, 'home');
  const bin = path.join(dir, 'bin');
  await fs.mkdir(path.join(home, 'app'), { recursive: true });
  await fs.mkdir(bin);
  await fs.writeFile(path.join(home, 'app/package.json'), '{"version":"old"}');
  await fs.writeFile(path.join(home, 'app/marker'), 'original');
  await fs.writeFile(path.join(home, 'app/.env'), 'SERVER_PORT=3001\n');
  const tool = path.join(bin, 'tool');
  await fs.writeFile(tool, fakeTool, { mode: 0o755 });
  for (const name of ['uname','id','getent','df','systemctl','git','runuser','node','npm','curl','chown','sleep']) await fs.symlink(tool, path.join(bin, name));
  const result = spawnSync('/bin/bash', [script, '--skip-engine'], {
    encoding: 'utf8', timeout: 45_000,
    env: { ...process.env, PATH: `${bin}:/usr/bin:/bin`, FIXTURE_HOME: home, FIXTURE_MODE: mode, APP_DIR: path.join(home, 'app') },
  });
  return { home, result };
}

test('updater switches only after checks and retains the exact old application and env', async (t) => {
  const { home, result } = await fixture(t, 'ok');
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(await fs.readFile(path.join(home, 'app/marker'), 'utf8'), 'new');
  const backup = (await fs.readdir(home)).find((name) => name.startsWith('neo3-rollback-'));
  assert.equal(await fs.readFile(path.join(home, backup, 'app/marker'), 'utf8'), 'original');
  assert.equal(await fs.readFile(path.join(home, 'app/.env'), 'utf8'), 'SERVER_PORT=3001\nNEO3_THREADS_MCP=on\n');
});

test('failed health automatically restores the original application', async (t) => {
  const { home, result } = await fixture(t, 'bad-health');
  assert.notEqual(result.status, 0);
  assert.equal(await fs.readFile(path.join(home, 'app/marker'), 'utf8'), 'original');
});

test('download failure leaves the live installation untouched', async (t) => {
  const { home, result } = await fixture(t, 'download-fail');
  assert.notEqual(result.status, 0);
  assert.equal(await fs.readFile(path.join(home, 'app/marker'), 'utf8'), 'original');
});
