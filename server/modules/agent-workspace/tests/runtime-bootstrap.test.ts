import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));

test('environment bootstrap precedes workspace runtime in server entry point', () => {
  const entry = readFileSync(path.join(root, 'index.js'), 'utf8');
  const imports = [...entry.matchAll(/^import\s+(?:[^;]*?\s+from\s+)?['"]([^'"]+)['"];?/gm)].map(match => match[1]);
  assert.equal(imports[0], './load-env.js');
});

test('workspace import opens no database and first access uses subsequently configured path', () => {
  const folder = mkdtempSync(path.join(tmpdir(), 'workspace-bootstrap-'));
  const initialPath = path.join(folder, 'before-env.db');
  const configuredPath = path.join(folder, 'configured.db');
  try {
    const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `
      import assert from 'node:assert/strict';
      import { existsSync } from 'node:fs';
      const { workspaceDependencies } = await import(${JSON.stringify(new URL('../runtime.ts', import.meta.url).href)});
      assert.equal(existsSync(process.env.DATABASE_PATH), false, 'import must not open SQLite');
      process.env.DATABASE_PATH = ${JSON.stringify(configuredPath)};
      const db = await import(${JSON.stringify(new URL('../../database/index.ts', import.meta.url).href)});
      try {
        db.getConnection().exec(db.WORKSPACE_RECORDS_SCHEMA_SQL);
        workspaceDependencies.store.create({kind:'test',ownerUserId:1,payload:{}});
        assert.equal(existsSync(${JSON.stringify(initialPath)}), false);
        assert.equal(existsSync(process.env.DATABASE_PATH), true);
      } finally { db.closeConnection(); }
    `], {
      env: {...process.env, HOME: folder, DATABASE_PATH: initialPath, TSX_TSCONFIG_PATH: path.join(root, 'tsconfig.json')},
      encoding: 'utf8', timeout: 20000,
    });
    assert.equal(result.status, 0, result.stderr);
  } finally { rmSync(folder, {recursive:true, force:true}); }
});
