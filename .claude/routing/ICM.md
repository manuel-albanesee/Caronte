# Ripresa ICM verificabile

Percorsi nel manifest e nel brief relativi alla root del progetto. Nei contratti Markdown, per il controllo con links.py usa percorsi relativi alla cartella del contratto; indica che i comandi si eseguono dalla root. File, non glob o directory. I manifest sono configurazione attendibile: `check` esegue il comando dichiarato con i permessi del processo. Il controllo non è una sandbox.

Per un task con più fasi salva, per esempio, `.icm/mapping/run.json`:

```json
{
  "version": 1,
  "runId": "mapping-001",
  "stages": [
    {
      "id": "01_analisi",
      "contract": ".icm/mapping/01_analisi/CONTEXT.md",
      "inputs": [".icm/mapping/snapshot/mapping.js", "tests/check-analysis.cjs"],
      "outputs": [".icm/mapping/01_analisi/output/mapping-001/handoff.md"],
      "dependsOn": [],
      "profile": "ricerca-haiku",
      "class": "ricerca",
      "verify": {"command": "node", "args": ["tests/check-analysis.cjs"], "timeoutMs": 120000}
    },
    {
      "id": "02_fix",
      "contract": ".icm/mapping/02_fix/CONTEXT.md",
      "inputs": [".icm/mapping/01_analisi/output/mapping-001/handoff.md", "tests/mapping.test.cjs"],
      "outputs": ["src/mapping.js", ".icm/mapping/02_fix/output/mapping-001/handoff.md"],
      "dependsOn": ["01_analisi"],
      "profile": "ecc-tdd-guide",
      "class": "regressione",
      "verify": {"command": "node", "args": ["--test", "tests/mapping.test.cjs"], "timeoutMs": 120000}
    }
  ]
}
```

Adatta input e controlli al progetto prima di eseguire. Il modello di esempio illustra la struttura, non è una pipeline pronta. **Una fase non deve modificare gli input di una fase precedente che resta prerequisito valido.** Se la fase successiva modifica `src/mapping.js`, l'analisi deve usare uno snapshot immutabile di quel file (inserito in `inputs`) e dichiarare nel contratto il commit di origine, come nel manifest sopra. Altrimenti invalidare l'analisi dopo il fix è il risultato corretto. Preferisci trasformazioni con snapshot di input e output distinti nei workflow di sviluppo. Evita anche input/output coincidenti nella stessa fase se il verificatore li modifica.

`profile` e `class` sono facoltativi. `profile` assegna il worker della fase: con la policy di delega attiva il validatore respinge un subagent diverso. `class` è la classe di routing di `.claude/routing/policy.json` e vale quando il brief non indica `ROUTING`. I file del piano di scrittura devono stare tra gli `outputs` della fase, e ogni delega di scrittura senza `ICM_RUN` e `ICM_STAGE` viene respinta: la metodologia ICM è obbligatoria e `ICM_SKIP` non è ammesso. Entrambi i campi fanno parte della configurazione della fase: cambiarli invalida la sua ricevuta.

Comandi dalla root:

```text
node .claude/routing/icm.cjs status .icm/mapping/run.json
node .claude/routing/icm.cjs gate .icm/mapping/run.json 01_analisi
node .claude/routing/icm.cjs check .icm/mapping/run.json 01_analisi
```

- `status` mostra obiettivo (se presente nel manifest), ultima ricevuta valida, prima fase non valida, input cambiati quando la ricevuta conserva le impronte per file e il prossimo passo. L'attribuzione della modifica resta `unavailable`: gli hash non provano chi l'ha fatta. I manifest e le ricevute precedenti senza impronte per file mostrano il cambiamento come non disponibile.
- `gate` richiede contratto/input presenti e tutte le dipendenze con ricevuta pass attuale. Non richiede l'output della fase da iniziare.
- Dopo aver controllato il diff e la ricevuta dei test mirati del worker, l’orchestratore esegue `check`. Il comando invalida il vecchio pass, esegue il verificatore senza shell, registra log e hash degli input/output. Se fallisce, un vecchio pass non sopravvive. Rifiuta input cambiati durante il controllo e output mancanti. Una nuova esecuzione status, anche in un altro processo, ricostruisce la validità.
- Le ricevute sono in `.state-<runId>/` accanto al manifest, insieme a `<fase>-check.md` e log. Questo è un adattamento esplicito della collocazione ICM originaria: una sola ricevuta canonica per fase/run. Gli handoff restano nelle cartelle output delle fasi.
- Per un riepilogo più utile aggiungi `objective` al manifest e, facoltativamente, a ciascuna fase. `status` non inventa obiettivi assenti e distingue una fase mai verificata da un pass obsoleto o fallito.
- Modifiche a contratto, input, output o configurazione della fase invalidano il risultato e le fasi dipendenti. Il contenuto dei file elencati viene letto per intero localmente: non viene inviato al modello. Elenca script di verifica, lockfile e revisioni esterne rilevanti tra gli input. Variabili d'ambiente, servizi remoti e file non dichiarati non sono osservati automaticamente.
- Una sola verifica per run alla volta. Se il processo è terminato forzatamente può restare `.lock`: dopo aver verificato che nessun check sia attivo, rimuovilo e riesegui il controllo. I worker non devono condividere gli stessi output in scrittura.
- Windows: `command` deve essere un eseguibile (`node`, `dotnet`, `python`), non una stringa con argomenti. Per uno script npm usa `node` con il percorso del relativo file JS oppure un wrapper di progetto esplicito. Non usare pipe o `&&` negli args.

Brief per una delega ICM, nella sezione INPUT:

```text
INPUT: consulta soltanto il contratto e i riferimenti indicati.
INPUT_FILES: [".icm/mapping/01_analisi/CONTEXT.md"]
ICM_RUN: .icm/mapping/run.json
ICM_STAGE: 01_analisi
```

L'hook esegue `gate` prima di Agent/Task solo quando questi metadati sono dichiarati. Non può rilevare una fase ICM omessa intenzionalmente dal mandato. Il lavoro svolto direttamente nel thread segue i comandi indicati nella procedura; non esiste un blocco globale su ogni scrittura. Un pass prova l'esito del comando, non la completezza della specifica o la qualità di un test debole.

Per verificare i collegamenti sotto `.icm`, passa quella cartella esplicitamente allo script originale, che altrimenti ignora le sottocartelle nascoste:

```text
python .claude/skills/icm-architect/scripts/links.py .icm
```

## Task e barra di avanzamento

Un task per fase, con `[ICM:<percorso run.json>/<id fase>]` nel titolo o nella descrizione. L'hook `.claude/hooks/icm-task.cjs` (eventi TaskCreated e TaskCompleted) blocca con exit 2 un task che punta a un run o a una fase inesistenti e il completamento di una fase senza ricevuta `pass` valida; senza marcatore, o se la lettura fallisce, consente. Segna completed solo dopo `check`.

Collaudo locale riproducibile del meccanismo: dalla cartella del kit `node --test tests/routing.test.cjs tests/icm-task.test.cjs`. Per la prova sul tuo repo interrompi una fase, riapri Claude, esegui status; poi cambia un input e verifica che la fase e le sue dipendenze risultino non valide.
