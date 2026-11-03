import { test } from 'node:test';
import assert from 'node:assert/strict';

import Database from 'better-sqlite3';

import { INIT_SCHEMA_SQL } from '../schema.js';
import { runMigrations } from '../migrations.js';
test('workspace schema survives fresh initialization and repeated migrations without losing records',()=>{
 const db=new Database(':memory:');db.exec(INIT_SCHEMA_SQL);runMigrations(db);
 db.prepare('INSERT INTO workspace_records VALUES (?,?,?,?,?,?,?,?)').run('saved','daily-task',1,null,1,'{"title":"Saved"}','2026-11-02','2026-11-02');
 runMigrations(db);assert.equal((db.prepare('SELECT payload FROM workspace_records WHERE id=?').get('saved') as {payload:string}).payload,'{"title":"Saved"}');db.close();
});
