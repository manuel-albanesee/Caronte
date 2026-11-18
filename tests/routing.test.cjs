const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { parseBrief, inputMetadata, validate } = require('../.claude/hooks/validate-agent-brief.cjs');
const { loadRun, valid, gate, check } = require('../.claude/routing/icm.cjs');
const { install } = require('../install.cjs');
const kit = path.resolve(__dirname, '..');
const brief = 'OBIETTIVO: trova il chiamante\nINPUT: nessuno\nFATTI: errore riproducibile\nVINCOLI: sola lettura\nUSCITA: percorso e riga\nVERIFICA: identifica il chiamante e fermati';
function temporary(t) { const p = fs.mkdtempSync(path.join(os.tmpdir(), 'routing test-')); t.after(() => fs.rmSync(p, { recursive: true, force: true })); return p; }
function write(root, name, text) { const p = path.join(root, name); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); }
function event(prompt = brief, type = 'Agent') { return { tool_name: type, tool_input: { prompt } }; }
function fixture(t) {
  const root = temporary(t);
  for (const [n,v] of Object.entries({ 'input.txt':'a', 'contract-a.md':'A', 'contract-b.md':'B', 'out-a.txt':'A', 'out-b.txt':'B', 'verify.cjs':'process.exit(0)' })) write(root,n,v);
  const data = { version:1,runId:'test-001',stages:[
    {id:'a',contract:'contract-a.md',inputs:['input.txt','verify.cjs'],outputs:['out-a.txt'],dependsOn:[],verify:{command:process.execPath,args:['verify.cjs']}},
    {id:'b',contract:'contract-b.md',inputs:['out-a.txt'],outputs:['out-b.txt'],dependsOn:['a'],verify:{command:process.execPath,args:['-e','process.exit(0)']}}
  ]};
  const save = () => write(root,'.icm/task/run.json',JSON.stringify(data)); save();
  return {root,data,save,run:()=>loadRun(root,'.icm/task/run.json')};
}
test('brief corretto e CRLF',()=>{ assert.equal(parseBrief(brief).INPUT,'nessuno');assert.equal(parseBrief(brief.replaceAll('\n','\r\n')).INPUT,'nessuno'); });
for (const label of ['TODO','TBD','...','<da compilare>','N/A']) test('rifiuta placeholder '+label,()=>assert.throws(()=>parseBrief(brief.replace('trova il chiamante',label))));
test('rifiuta campo mancante',()=>assert.throws(()=>parseBrief(brief.replace('FATTI: errore riproducibile\n',''))));
test('rifiuta duplicato reale',()=>assert.throws(()=>parseBrief(brief+'\nINPUT: doppio')));
test('rifiuta ordine errato',()=>assert.throws(()=>parseBrief(brief.replace('INPUT:','USCITA:'))));
test('rifiuta vuoto e nessuno obbligatorio',()=>{for(const v of ['', 'nessuno'])assert.throws(()=>parseBrief(brief.replace('trova il chiamante',v)));});
test('etichette dentro fence conservate',()=>{const b=brief.replace('errore riproducibile','stringa esatta\n```text\nUSCITA: abc\nOBIETTIVO: xyz\n```');assert.match(parseBrief(b).FATTI,/USCITA: abc/);});
test('fence annidati con lunghezza diversa',()=>{const b=brief.replace('errore riproducibile','esempio\n````md\n```text\nUSCITA: abc\n```\n````');assert.match(parseBrief(b).FATTI,/USCITA/);});
test('fence tilde e righe indentate',()=>{assert.doesNotThrow(()=>parseBrief(brief.replace('errore riproducibile','esempio\n~~~\nUSCITA: abc\n~~~\n    INPUT: letterale')));});
test('fence aperto rifiutato',()=>assert.throws(()=>parseBrief(brief+'\n```')));
test('metadata citati non attivi',()=>assert.deepEqual(inputMetadata('```\nICM_RUN: missing\n```'),{}));
test('metadata duplicati rifiutati',()=>assert.throws(()=>inputMetadata('ICM_RUN: a\nICM_RUN: b')));
test('file esistente con spazi e unicode',t=>{const r=temporary(t);write(r,'dati è/a b.txt','ok');assert.doesNotThrow(()=>validate(event(brief.replace('INPUT: nessuno','INPUT: dati\nINPUT_FILES: ["dati è/a b.txt"]')),r));});
test('file assente e path esterno rifiutati',t=>{const r=temporary(t);for(const p of ['missing.txt','../outside'])assert.throws(()=>validate(event(brief.replace('INPUT: nessuno','INPUT: dati\nINPUT_FILES: '+JSON.stringify([p]))),r));});
test('INPUT_FILES schema errato rifiutato',t=>{const r=temporary(t);assert.throws(()=>validate(event(brief.replace('INPUT: nessuno','INPUT: dati\nINPUT_FILES: {}')),r));});
test('stesso controllo ogni modello e depth',t=>{const r=temporary(t);for(const model of ['haiku','sonnet','opus']){const e=event();e.agent_id='nested';e.tool_input.model=model;validate(e,r);assert.throws(()=>validate({...e,tool_input:{...e.tool_input,prompt:'TODO'}},r));}});
test('Task validato, altri tool fuori scope',t=>{const r=temporary(t);validate(event(brief,'Task'),r);validate(event('x','Bash'),r);assert.throws(()=>validate(event('x','Task'),r));});
test('worker lettore non riceve capability write',t=>{const r=temporary(t);const e=event(brief.replace('VINCOLI: sola lettura','VINCOLI: modifica src/x\nCAPABILITY: write'));e.tool_input.subagent_type='ricerca-haiku';assert.throws(()=>validate(e,r));});
test('stdin malformato negato con JSON valido',()=>{const p=spawnSync(process.execPath,[path.join(kit,'.claude/hooks/validate-agent-brief.cjs')],{input:'{broken',encoding:'utf8'});assert.equal(JSON.parse(p.stdout).hookSpecificOutput.permissionDecision,'deny');});
test('SubagentStart propaga la procedura',()=>{const p=spawnSync(process.execPath,[path.join(kit,'.claude/hooks/delegation-context.cjs')],{input:JSON.stringify({hook_event_name:'SubagentStart'}),encoding:'utf8'});assert.match(JSON.parse(p.stdout).hookSpecificOutput.additionalContext,/OBIETTIVO/);});

function fullEccHook(root, script, payload) {
  const result = spawnSync(process.execPath, [path.join(kit, '.claude/hooks', script + '.cjs')], {
    cwd: root, env: { ...process.env, CLAUDE_PROJECT_DIR: root, CARONTE_ECC_FULL: '1' },
    input: JSON.stringify(payload), encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout && JSON.parse(result.stdout).hookSpecificOutput;
}

test('ECC completo lascia funzionare i profili nativi, le loro sotto-deleghe generiche e il tool Skill', t => {
  const root = temporary(t);
  assert.equal(spawnSync('git', ['init', '-q', root]).status, 0);
  const native = { agent_id: 'native', agent_type: 'ecc:tdd-guide', session_id: 'session' };
  const task = { tool_name: 'Agent', tool_input: { subagent_type: native.agent_type, prompt: 'Review the failing test.' } };
  assert.equal(fullEccHook(root, 'validate-agent-brief', task), '');
  assert.match(fullEccHook(root, 'validate-agent-brief', {
    ...task, tool_input: { ...task.tool_input, prompt: brief },
  }).permissionDecisionReason, /sola lettura/);
  assert.equal(fullEccHook(root, 'validate-agent-brief', {
    ...native, ...task, tool_input: { subagent_type: 'general-purpose', prompt: 'Read the test output.' },
  }), '');
  assert.equal(fullEccHook(root, 'delegation-context', { ...native, hook_event_name: 'SubagentStart' }), '');
  assert.equal(fullEccHook(root, 'enforce-worker', {
    ...native, tool_name: 'Bash', tool_input: { command: 'npm test' },
  }), '');
  assert.equal(fullEccHook(root, 'enforce-worker', {
    ...native, tool_name: 'Skill', tool_input: { skill: 'ecc:tdd-workflow' },
  }), '');
  const kitTask = { ...task, tool_input: { ...task.tool_input, subagent_type: 'ecc-tdd-guide' } };
  assert.equal(fullEccHook(root, 'validate-agent-brief', kitTask).permissionDecision, 'deny');
  assert.equal(fullEccHook(root, 'enforce-worker', {
    ...native, agent_type: 'ecc-tdd-guide', tool_name: 'Bash', tool_input: { command: 'npm test' },
  }).permissionDecision, 'deny');
});

test('ECC completo conserva i limiti di un piano Caronte anche con un profilo del plugin', t => {
  const root = temporary(t);
  assert.equal(spawnSync('git', ['init', '-q', root]).status, 0);
  write(root, 'app.txt', 'hello');
  const { plan } = require('../.claude/routing/delivery.cjs');
  const type = 'ecc:tdd-guide';
  const planned = plan(root, { profile: type, files: ['app.txt'], tests: [], noTestsReason: 'Modifica di testo.' });
  const prompt = brief.replace('VINCOLI: sola lettura', 'VINCOLI: solo app.txt\nCAPABILITY: write\nREVIEW_ID: ' + planned.id);
  assert.equal(fullEccHook(root, 'validate-agent-brief', {
    tool_name: 'Agent', tool_input: { subagent_type: type, prompt }, session_id: 'session',
  }), '');
  const agent = { agent_id: 'managed', agent_type: type, session_id: 'session' };
  assert.match(fullEccHook(root, 'delegation-context', { ...agent, hook_event_name: 'SubagentStart' }).additionalContext, /REVIEW_ID/);
  assert.equal(fullEccHook(root, 'enforce-worker', { ...agent, tool_name: 'Edit', tool_input: { file_path: 'app.txt' } }), '');
  assert.equal(fullEccHook(root, 'enforce-worker', { ...agent, tool_name: 'Edit', tool_input: { file_path: 'other.txt' } }).permissionDecision, 'deny');
  assert.equal(fullEccHook(root, 'validate-agent-brief', {
    ...agent, tool_name: 'Agent', tool_input: { subagent_type: 'general-purpose', prompt: 'Edit the file.' },
  }).permissionDecision, 'deny');
});

test('l’installer mantiene plugin, hook e preferenza fork quando si sceglie ECC completo', t => {
  const root = temporary(t);
  const localSettings = '.claude/settings.local.json';
  const eccHook = { matcher: 'Bash', hooks: [{ type: 'command', command: 'ecc-hook' }] };
  write(root, localSettings, JSON.stringify({
    enabledPlugins: { 'ecc@ecc': true },
    env: { ECC_HOOK_PROFILE: 'strict', CLAUDE_CODE_FORK_SUBAGENT: '1' },
    hooks: { PreToolUse: [eccHook] },
  }));
  assert.equal(install(root, false, null, true).eccFull, true);
  const config = JSON.parse(fs.readFileSync(path.join(root, localSettings), 'utf8'));
  assert.deepEqual(config.enabledPlugins, { 'ecc@ecc': true });
  assert.deepEqual(config.env, { ECC_HOOK_PROFILE: 'strict', CLAUDE_CODE_FORK_SUBAGENT: '1', CARONTE_ECC_FULL: '1' });
  assert.deepEqual(config.hooks.PreToolUse[0], eccHook);
  assert.deepEqual(install(root).changed, []);
});

test('fase successiva bloccata prima del check',t=>{const f=fixture(t);assert.throws(()=>gate(f.run(),'b'));});
test('due fasi e ripresa in nuovo processo',t=>{const f=fixture(t);check(f.run(),'a');gate(f.run(),'b');check(f.run(),'b');const p=spawnSync(process.execPath,[path.join(kit,'.claude/routing/icm.cjs'),'status','.icm/task/run.json'],{cwd:f.root,env:{...process.env,CLAUDE_PROJECT_DIR:f.root},encoding:'utf8'});assert.equal(p.status,0);assert.equal(JSON.parse(p.stdout).next,null);});
for(const file of ['input.txt','contract-a.md','out-a.txt','verify.cjs'])test('invalida input/contratto/output '+file,t=>{const f=fixture(t);check(f.run(),'a');check(f.run(),'b');write(f.root,file,'changed');assert.equal(valid(f.run(),'a').ok,false);assert.equal(valid(f.run(),'b').ok,false);assert.throws(()=>gate(f.run(),'b'));});
test('cambio comando invalida',t=>{const f=fixture(t);check(f.run(),'a');f.data.stages[0].verify.args=['-e','process.exit(0)'];f.save();assert.equal(valid(f.run(),'a').ok,false);});
test('test fallito elimina vecchio pass',t=>{const f=fixture(t);check(f.run(),'a');write(f.root,'verify.cjs','process.exit(7)');assert.throws(()=>check(f.run(),'a'));assert.equal(valid(f.run(),'a').ok,false);assert.match(fs.readFileSync(path.join(f.run().stateDir,'a-check.md'),'utf8'),/^fail:/);});
test('output mancante non puo passare',t=>{const f=fixture(t);fs.unlinkSync(path.join(f.root,'out-a.txt'));assert.throws(()=>check(f.run(),'a'));});
test('input assente blocca gate',t=>{const f=fixture(t);fs.unlinkSync(path.join(f.root,'input.txt'));assert.throws(()=>gate(f.run(),'a'));});
test('input cambiato dal verificatore rifiutato',t=>{const f=fixture(t);write(f.root,'verify.cjs',"require('node:fs').writeFileSync('input.txt','b')");assert.throws(()=>check(f.run(),'a'),/Input modificati/);});
test('timeout registrato come fallimento',t=>{const f=fixture(t);f.data.stages[0].verify={command:process.execPath,args:['-e','setTimeout(()=>{},10000)'],timeoutMs:30};f.save();assert.throws(()=>check(f.run(),'a'));assert.equal(valid(f.run(),'a').ok,false);});
test('dipendenze cicliche rifiutate',t=>{const f=fixture(t);f.data.stages[0].dependsOn=['b'];f.save();assert.throws(f.run);});
test('ricevuta corrotta non accettata',t=>{const f=fixture(t);check(f.run(),'a');write(f.run().stateDir,'a.json','{}');assert.equal(valid(f.run(),'a').ok,false);});
test('hook ICM blocca dipendenza obsoleta',t=>{const f=fixture(t);const e=event(brief.replace('INPUT: nessuno','INPUT: contratto\nICM_RUN: .icm/task/run.json\nICM_STAGE: b'));assert.throws(()=>validate(e,f.root));check(f.run(),'a');validate(e,f.root);write(f.root,'input.txt','new');assert.throws(()=>validate(e,f.root));});
test('metadata ICM incompleti rifiutati',t=>{const f=fixture(t);assert.throws(()=>validate(event(brief.replace('INPUT: nessuno','INPUT: dati\nICM_RUN: .icm/task/run.json')),f.root));});
test('installazione conserva proxy e hook, ripetibile',t=>{const r=temporary(t);write(r,'CLAUDE.md','# Regole aziendali\nMantieni naming.\n');write(r,'.claude/settings.local.json',JSON.stringify({model:'custom-model',env:{ANTHROPIC_BASE_URL:'http://localhost:8787'},hooks:{PreToolUse:[{matcher:'Bash',hooks:[{type:'command',command:'ecc-check'}]}]}}));install(r);const s=JSON.parse(fs.readFileSync(path.join(r,'.claude/settings.local.json')));assert.equal(s.env.ANTHROPIC_BASE_URL,'http://localhost:8787');assert.equal(s.model,'custom-model');assert.equal(s.hooks.PreToolUse[0].hooks[0].command,'ecc-check');assert.match(fs.readFileSync(path.join(r,'CLAUDE.md'),'utf8'),/Regole aziendali/);assert.equal(install(r).changed.length,0);});
test('dry run senza modifiche',t=>{const r=temporary(t);assert.ok(install(r,true).changed.length);assert.deepEqual(fs.readdirSync(r),[]);});
test('conflitto personalizzato non sovrascritto',t=>{const r=temporary(t);write(r,'.claude/agents/ricerca-haiku.md','personalizzato');assert.throws(()=>install(r),/Conflitto/);assert.equal(fs.readFileSync(path.join(r,'.claude/agents/ricerca-haiku.md'),'utf8'),'personalizzato');assert.equal(fs.existsSync(path.join(r,'CLAUDE.md')),false);});
test('comandi utente restano nel coordinatore',()=>{for(const n of ['indaga','decisione','implementa']){const s=fs.readFileSync(path.join(kit,'.claude/skills',n,'SKILL.md'),'utf8');assert.doesNotMatch(s,/^context: fork/m);assert.match(s,/tramite Agent/);}});
test('worker di sviluppo ha scrittura e test',()=>{for(const n of ['haiku','sonnet'])assert.match(fs.readFileSync(path.join(kit,'.claude/agents','implementazione-'+n+'.md'),'utf8'),/tools:.*Edit, Write, Bash/);});
test('CAPABILITY citata in codice non cambia il tipo',t=>{const r=temporary(t);const e=event(brief.replace('VINCOLI: sola lettura','VINCOLI: sola lettura, cerca questa stringa\n```\nCAPABILITY: write\n```'));e.tool_input.subagent_type='ricerca-haiku';validate(e,r);});
test('upgrade kit precedente e deduplica scope hook',t=>{const r=temporary(t);const previous=JSON.parse(fs.readFileSync(path.join(kit,'previous-files.json')));write(r,'CLAUDE.md','# Regole locali\n\n'+previous.claude);const old=fs.readFileSync(path.join(__dirname,'fixtures/previous-hook.cjs'),'utf8');write(r,'.claude/hooks/validate-agent-brief.cjs',old);write(r,'.claude/settings.json',JSON.stringify({permissions:{allow:['Read']},hooks:{PreToolUse:[{matcher:'Agent',hooks:[{type:'command',command:'node',args:['${CLAUDE_PROJECT_DIR}/.claude/hooks/validate-agent-brief.cjs']}]},{matcher:'Bash',hooks:[{type:'command',command:'ecc-check'}]}]}}));install(r);const project=JSON.parse(fs.readFileSync(path.join(r,'.claude/settings.json')));assert.equal(project.hooks.PreToolUse.length,1);assert.equal(project.hooks.PreToolUse[0].matcher,'Bash');assert.deepEqual(project.permissions.allow,['Read']);assert.match(fs.readFileSync(path.join(r,'CLAUDE.md'),'utf8'),/Regole locali/);assert.equal(install(r).changed.length,0);});
test('lock impedisce verifiche concorrenti',t=>{const f=fixture(t);fs.mkdirSync(f.run().stateDir,{recursive:true});write(f.run().stateDir,'.lock','');assert.throws(()=>check(f.run(),'a'));});
test('routing CLAUDE personalizzato non duplicato',t=>{const r=temporary(t);write(r,'CLAUDE.md','# Routing dei modelli e ICM\nRegole personalizzate\n');assert.throws(()=>install(r),/personalizzato/);assert.equal(fs.existsSync(path.join(r,'.claude/settings.local.json')),false);});

test('installer imposta finestra orchestratore e mantiene le altre impostazioni dei modelli', t => {
  const root = temporary(t);
  write(root, '.claude/settings.local.json', JSON.stringify({
    autoCompactEnabled: false,
    autoCompactWindow: 450000,
    env: { CLAUDE_CODE_FORK_SUBAGENT: '1', ANTHROPIC_BASE_URL: 'http://localhost:8787' },
    modelSettings: { custom: { autoCompactWindow: 500000, effortLevel: 'low' } },
  }));
  const result = install(root);
  const settings = JSON.parse(fs.readFileSync(path.join(root, '.claude/settings.local.json'), 'utf8'));
  assert.equal(result.autoCompactWindow, 200000);
  assert.equal(settings.autoCompactEnabled, true);
  assert.equal(settings.autoCompactWindow, 200000);
  assert.deepEqual(settings.modelSettings.custom, { autoCompactWindow: 200000, effortLevel: 'low' });
  assert.deepEqual(settings.env, { CLAUDE_CODE_FORK_SUBAGENT: '0', ANTHROPIC_BASE_URL: 'http://localhost:8787' });
  assert.equal(settings.hooks.PreCompact[0].matcher, 'auto');
  assert.equal(install(root).changed.length, 0);
});

test('installer segnala un override del wrapper senza cancellarlo', t => {
  const root = temporary(t);
  write(root, '.claude/settings.json', JSON.stringify({ env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: '300000' } }));
  assert.ok(install(root).checkEnvironmentOverrides.includes('CLAUDE_CODE_AUTO_COMPACT_WINDOW'));
  const projectSettings = JSON.parse(fs.readFileSync(path.join(root, '.claude/settings.json'), 'utf8'));
  assert.equal(projectSettings.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW, '300000');
});

test('RTK già disponibile e hook utente esistente vengono riusati', t => {
  const { prepareRtk } = require('../rtk-setup.cjs');
  const root = temporary(t);
  const calls = [];
  const fakeRtk = path.join(root, 'rtk');
  const globalHook = { hooks: { PreToolUse: [{
    matcher: 'Bash',
    hooks: [{ type: 'command', command: '"C:/Users/Someone/App Data/rtk.exe" hook claude' }],
  }] } };
  const setup = config => prepareRtk(config, {
    platform: 'win32',
    home: root,
    userSettings: globalHook,
    lookup: name => name === 'rtk' ? fakeRtk : null,
    run: (command, args) => {
      calls.push([command, ...args]);
      return { status: 0, stdout: 'rtk 1.2.0' };
    },
  });
  const result = install(root, false, setup);
  assert.equal(result.rtk.binary, 'existing');
  assert.equal(result.rtk.hook, 'reused');
  const settings = JSON.parse(fs.readFileSync(path.join(root, '.claude/settings.local.json'), 'utf8'));
  assert.equal(settings.hooks.PreToolUse.some(group => group.hooks.some(hook => hook.command === 'rtk')), false);
  assert.deepEqual(calls, [[fakeRtk, '--version'], [fakeRtk, 'gain', '--help']]);
});

test('RTK mancante usa WinGet soltanto dopo il dry-run e configura il progetto una volta', t => {
  const { prepareRtk } = require('../rtk-setup.cjs');
  const root = temporary(t);
  const calls = [];
  let installed = false;
  const setup = config => prepareRtk(config, {
    platform: 'win32',
    home: root,
    userSettings: {},
    lookup: name => name === 'winget' || (installed && name === 'rtk') ? name : null,
    run: (command, args) => {
      calls.push([command, ...args]);
      if (command === 'winget') installed = true;
      return { status: 0, stdout: 'rtk 1.2.0' };
    },
  });
  assert.equal(install(root, true, setup).rtk.hook, 'planned');
  assert.deepEqual(fs.readdirSync(root), []);
  assert.deepEqual(calls, []);
  const result = install(root, false, setup);
  assert.equal(result.rtk.binary, 'installed');
  assert.equal(result.rtk.hook, 'configured');
  assert.deepEqual(calls[0].slice(0, 7), ['winget', 'install', '--id', 'rtk-ai.rtk', '--exact', '--source', 'winget']);
  const settings = JSON.parse(fs.readFileSync(path.join(root, '.claude/settings.local.json'), 'utf8'));
  const bash = settings.hooks.PreToolUse.find(group => group.matcher === 'Bash');
  assert.deepEqual(bash.hooks[0], { type: 'command', command: 'rtk', args: ['hook', 'claude'], timeout: 5 });
  const repeated = install(root, false, setup);
  assert.equal(repeated.rtk.hook, 'reused');
  assert.deepEqual(repeated.changed, []);
  assert.equal(calls.filter(call => call[0] === 'winget').length, 1);
});

test('installazione RTK fallita mantiene il routing e non aggiunge un hook inutilizzabile', t => {
  const { prepareRtk } = require('../rtk-setup.cjs');
  const root = temporary(t);
  const result = install(root, false, config => prepareRtk(config, {
    platform: 'win32',
    home: root,
    userSettings: {},
    lookup: name => name === 'winget' ? name : null,
    run: () => ({ status: 5, stdout: '' }),
  }));
  assert.match(result.rtk.error, /Installazione RTK fallita \(5\)/);
  assert.equal(result.rtk.hook, 'unavailable');
  const settings = JSON.parse(fs.readFileSync(path.join(root, '.claude/settings.local.json'), 'utf8'));
  assert.equal(settings.autoCompactWindow, 200000);
  assert.equal(settings.hooks.PreToolUse.some(group => group.hooks.some(hook => hook.command === 'rtk')), false);
});

function gitRepo(t) {
  const root = temporary(t);
  const git = (...args) => {
    const proc = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
    assert.equal(proc.status, 0, proc.stderr);
    return proc.stdout;
  };
  git('init', '-q');
  git('config', 'user.name', 'Test');
  git('config', 'user.email', 'test@example.invalid');
  return { root, git };
}

test('delegato esegue un solo test impattato, orchestratore verifica il delta Git e mantiene lo staging', t => {
  const { plan, enforceWorker, check, review } = require('../.claude/routing/delivery.cjs');
  const { root, git } = gitRepo(t);
  write(root, 'src.js', 'module.exports = 0;\n');
  git('add', 'src.js');
  git('commit', '-qm', 'base');
  write(root, 'src.js', '// modifica già staged\nmodule.exports = 0;\n');
  git('add', 'src.js');
  const staged = git('diff', '--cached');
  write(root, 'src.js', '// modifica già staged\n// modifica già unstaged\nmodule.exports = 0;\n');
  write(root, 'test parser.cjs', "const test=require('node:test'); const a=require('node:assert');\ntest('parser (A)',()=>a.equal(require('./src.js'),1));\ntest('altro test',()=>a.fail('fuori scope'));\n");

  const profile = 'ecc-tdd-guide';
  const planned = plan(root, {
    profile, files: ['src.js', 'nuovo.txt'],
    tests: [{ runner: 'node', file: 'test parser.cjs', selector: 'parser (A)', because: 'Regressione del parser' }],
  });
  const base = { cwd: root, session_id: 'parent', agent_id: 'worker', agent_type: profile };
  const parent = event(brief.replace('VINCOLI: sola lettura', 'VINCOLI: modifica i due file\nCAPABILITY: write\nREVIEW_ID: ' + planned.id));
  parent.session_id = 'parent';
  parent.tool_input.subagent_type = profile;
  validate(parent, root);
  assert.throws(() => enforceWorker(root, { ...base, tool_name: 'Bash', tool_input: { command: 'npm test' } }), /suite completa/);
  assert.throws(() => enforceWorker(root, { ...base, tool_name: 'PowerShell', tool_input: { command: planned.command + ' && npm test' } }), /test mirato/);
  assert.throws(() => enforceWorker(root, { ...base, tool_name: 'Edit', tool_input: { file_path: './README.md' } }), /fuori dal perimetro/);
  assert.doesNotThrow(() => enforceWorker(root, { session_id: 'parent', agent_type: 'orchestratore', tool_name: 'PowerShell', tool_input: { command: 'npm test' } }));
  assert.doesNotThrow(() => enforceWorker(root, { ...base, tool_name: 'PowerShell', tool_input: { command: planned.command } }));
  assert.equal(check(root, planned.id).ok, false);
  write(root, 'src.js', '// modifica già staged\n// modifica già unstaged\nmodule.exports = 1;\n');
  write(root, 'nuovo.txt', 'nuovo\n');
  const passing = check(root, planned.id);
  assert.equal(passing.ok, true, JSON.stringify(passing));
  const result = review(root, planned.id);
  assert.equal(result.checks, 'pass');
  assert.deepEqual(result.changed, ['nuovo.txt', 'src.js']);
  const patch = fs.readFileSync(result.patch, 'utf8');
  assert.match(patch, /^\+module.exports = 1;/m);
  assert.doesNotMatch(patch, /^\+.*modifica già/m);
  assert.match(patch, /^\+nuovo$/m);
  assert.equal(git('diff', '--cached'), staged);
  assert.throws(() => check(root, planned.id), /autorizzato/);
});

test('recezione senza match e test divenuti obsoleti non validano il diff', t => {
  const { plan, authorize, enforceWorker, check, review } = require('../.claude/routing/delivery.cjs');
  const { root } = gitRepo(t);
  const profile = 'implementazione-sonnet';
  write(root, 'x.test.js', "require('node:test')('actual', () => {});\n");
  const planned = plan(root, { profile, files: ['x.js'], tests: [{ runner: 'node', file: 'x.test.js', selector: 'missing', because: 'caso preciso' }] });
  authorize(root, planned.id, { session_id: 's', tool_input: { subagent_type: profile } });
  const worker = { cwd: root, agent_id: 'worker', session_id: 's', agent_type: profile, tool_name: 'Bash', tool_input: { command: planned.command } };
  enforceWorker(root, worker);
  assert.equal(check(root, planned.id).ok, false);
  write(root, 'x.test.js', "require('node:test')('missing', () => {});\n");
  const passing = check(root, planned.id);
  assert.equal(passing.ok, true, JSON.stringify(passing));
  assert.throws(() => enforceWorker(root, { ...worker, agent_id: 'secondo' }), /altro worker/);
  write(root, 'x.js', 'changed after test\n');
  assert.equal(review(root, planned.id).checks, 'stale');
});

test('piano senza filtro applicativo e delega scrivibile senza REVIEW_ID vengono respinti', t => {
  const { plan, enforceWorker } = require('../.claude/routing/delivery.cjs');
  const { root } = gitRepo(t);
  assert.throws(() => plan(root, { profile: 'ecc-tdd-guide', files: ['x.cs'], tests: [
    { runner: 'dotnet', file: 'tests/Tests.csproj', selector: '*', because: 'tutti' },
  ] }), /Selettore/);
  const parent = event(brief.replace('VINCOLI: sola lettura', 'VINCOLI: CAPABILITY\nCAPABILITY: write'));
  parent.tool_input.subagent_type = 'ecc-tdd-guide';
  assert.throws(() => validate(parent, root), /REVIEW_ID/);
  assert.throws(() => enforceWorker(root, { cwd: root, agent_id: 'read-only', session_id: 'x', agent_type: 'ecc-java-reviewer', tool_name: 'Bash', tool_input: { command: 'mvn test' } }), /Nessun piano/);
});

test('avvio aggiorna i profili ECC validati e prova RTK tramite WinGet senza cambiare le regole locali', async t => {
  const { createHash } = require('node:crypto');
  const { sync, profileReference } = require('../.claude/routing/dependencies.cjs');
  const manifest = require('../.claude/routing/ecc/manifest.json');
  const { root, git } = gitRepo(t);
  const commit = 'b'.repeat(40);
  const blob = bytes => ({
    type: 'file', encoding: 'base64', content: bytes.toString('base64'),
    sha: createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex'),
  });
  let flipped = false, version = '1.2.0', upstream = '2.2.4';
  const exec = (name, args) => {
    if (name === 'rtk') return { status: 0, stdout: 'rtk ' + version };
    assert.equal(name, 'winget');
    assert.deepEqual(args.slice(0, 4), ['upgrade', '--id', 'rtk-ai.rtk', '--exact']);
    version = '1.2.1';
    return { status: 0, stdout: 'ok' };
  };
  const get = async (repo, route) => {
    if (route === 'releases/latest') return { tag_name: 'v' + (repo.endsWith('ECC') ? upstream : '1.2.1') };
    if (route.startsWith('commits/')) return { sha: commit };
    if (route.startsWith('contents/LICENSE?')) return blob(Buffer.from('MIT License'));
    if (route.startsWith('contents/.claude-plugin/plugin.json?')) return blob(Buffer.from(JSON.stringify({ name: 'ecc', version: upstream, license: 'MIT' })));
    const name = route.match(/^contents\/agents\/([^/]+)\.md\?ref=/)?.[1];
    assert.ok(manifest.profiles[name]);
    const file = blob(Buffer.from('---\nname: ' + name + '\n---\nNuovo riferimento ECC\n'));
    return flipped && name === 'tdd-guide' ? { ...file, sha: 'a'.repeat(40) } : file;
  };
  const next = await sync(root, { get, exec, platform: 'win32' });
  assert.deepEqual(next.ecc, { version: '2.2.4', changed: true });
  assert.deepEqual(next.rtk, { version: '1.2.1', changed: true });
  const active = profileReference(root, 'ecc-tdd-guide');
  assert.match(fs.readFileSync(active, 'utf8'), /Nuovo riferimento ECC/);
  assert.equal(git('status', '--short'), '');
  upstream = '2.2.5';
  flipped = true;
  assert.match((await sync(root, { get, exec, platform: 'win32' })).ecc.error, /Hash Git incoerente/);
  assert.equal(profileReference(root, 'ecc-tdd-guide'), active);
  upstream = '3.0.0';
  assert.match((await sync(root, { get, exec, platform: 'win32' })).ecc.error, /cambia major/);
  assert.equal(profileReference(root, 'ecc-tdd-guide'), active);
});
