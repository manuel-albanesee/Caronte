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
      "verify": {"command": "node", "args": ["tests/check-analysis.cjs"], "timeoutMs": 120000}
    },
    {
      "id": "02_fix",
      "contract": ".icm/mapping/02_fix/CONTEXT.md",
      "inputs": [".icm/mapping/01_analisi/output/mapping-001/handoff.md", "tests/mapping.test.cjs"],
      "outputs": ["src/mapping.js", ".icm/mapping/02_fix/output/mapping-001/handoff.md"],
      "dependsOn": ["01_analisi"],
      "verify": {"command": "node", "args": ["--test", "tests/mapping.test.cjs"], "timeoutMs": 120000}
    }
  ]
}
```

Adatta input e controlli al progetto prima di eseguire. Il modello di esempio illustra la struttura, non è una pipeline pronta. **Una fase non deve modificare gli input di una fase precedente che resta prerequisito valido.** Se la fase successiva modifica `src/mapping.js`, l'analisi deve usare uno snapshot immutabile di quel file (inserito in `inputs`) e dichiarare nel contratto il commit di origine, come nel manifest sopra. Altrimenti invalidare l'analisi dopo il fix è il risultato corretto. Preferisci trasformazioni con snapshot di input e output distinti nei workflow di sviluppo. Evita anche input/output coincidenti nella stessa fase se il verificatore li modifica.

Comandi dalla root:

```text
node .claude/routing/icm.cjs status .icm/mapping/run.json
node .claude/routing/icm.cjs gate .icm/mapping/run.json 01_analisi
node .claude/routing/icm.cjs check .icm/mapping/run.json 01_analisi
```

- `status` mostra ogni fase e la prima non valida, senza eseguire modelli o test.
- `gate` richiede contratto/input presenti e tutte le dipendenze con ricevuta pass attuale. Non richiede l'output della fase da iniziare.
- Dopo aver controllato il diff e la ricevuta dei test mirati del worker, l’orchestratore esegue `check`. Il comando invalida il vecchio pass, esegue il verificatore senza shell, registra log e hash degli input/output. Se fallisce, un vecchio pass non sopravvive. Rifiuta input cambiati durante il controllo e output mancanti. Una nuova esecuzione status, anche in un altro processo, ricostruisce la validità.
- Le ricevute sono in `.state-<runId>/` accanto al manifest, insieme a `<fase>-check.md` e log. Questo è un adattamento esplicito della collocazione ICM originaria: una sola ricevuta canonica per fase/run. Gli handoff restano nelle cartelle output delle fasi.
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

Collaudo locale riproducibile del meccanismo: dalla cartella del kit `node --test tests/routing.test.cjs`. Per la prova sul tuo repo interrompi una fase, riapri Claude, esegui status; poi cambia un input e verifica che la fase e le sue dipendenze risultino non valide.
