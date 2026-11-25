'use strict';
// Indice FastSkillRetrieval di prova (SQLite FTS5, tabelle capabilities e capability_fts).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

// extra: voci aggiuntive { name, kind = 'skill', description, use } (es. kind 'agent').
function makeIndex(extra = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'caronte-skill-'));
  const db = new DatabaseSync(path.join(dir, 'registry.sqlite3'));
  db.exec(`CREATE TABLE capabilities(id TEXT PRIMARY KEY, name TEXT, kind TEXT, status TEXT DEFAULT 'enabled');
    CREATE VIRTUAL TABLE capability_fts USING fts5(capability_id UNINDEXED, description, capabilities, use_when, aliases, technologies);`);
  const add = (id, name, description, use, kind = 'skill') => {
    db.prepare('INSERT INTO capabilities(id,name,kind) VALUES(?,?,?)').run(id, name, kind);
    db.prepare('INSERT INTO capability_fts VALUES(?,?,?,?,?,?)').run(id, description, description, use, name, 'postgresql');
  };
  add('a', 'postgres-patterns', 'postgres query optimization indexes schema design performance tuning', 'postgres query optimization slow query');
  add('b', 'tdd-workflow', 'write tests first test driven development regression bug fix', 'write tests first regression');
  for (let i = 0; i < 20; i++) add('f' + i, 'filler-' + i, 'generic text number ' + i + ' about unrelated things', 'filler');
  extra.forEach((e, i) => add('x' + i, e.name, e.description, e.use || e.description, e.kind || 'skill'));
  db.close();
  return dir;
}

module.exports = { makeIndex };
