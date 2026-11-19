# Deleghe con modifica, test e revisione Git

L’orchestratore sceglie lo specialista più adatto e scrive il brief. Ogni delega scrivibile nella root Git include un piano. Usa un solo worker scrivibile alla volta nel worktree. Per ricerche e revisioni in sola lettura basta il brief. Se occorre un secondo punto di vista, il reviewer riceve da leggere il diff Git e un quesito circoscritto. L’orchestratore controlla sempre il delta e l’esito direttamente.

## Prima di avviare il worker

Elenca con percorsi Git esatti i soli file che il worker può modificare o creare, inclusi i test. Scegli le verifiche applicative che coprono il comportamento cambiato o una regressione direttamente impattata. Verifica che il selettore e la configurazione del runner indirizzino solo le verifiche previste. Assegna un motivo concreto a ogni test e indica in `inputs` configurazioni o altre dipendenze del test da includere nell’impronta della ricevuta.

Esempio TypeScript con un test Vitest mirato:

```json
{
  "profile": "ecc-tdd-guide",
  "files": ["src/parser.ts", "tests/parser.test.ts"],
  "inputs": ["package.json", "vitest.config.ts"],
  "tests": [
    {
      "runner": "vitest",
      "file": "tests/parser.test.ts",
      "because": "Verifica la conversione del nuovo formato accettato dal parser"
    }
  ]
}
```

Passa il JSON da file temporaneo o da stdin. Esegui dalla root del worktree:

```text
node .claude/routing/delivery.cjs plan <file.json>
node .claude/routing/delivery.cjs plan -
```

Il comando salva la baseline del contenuto corrente dei soli file dichiarati, anche se già modificati o nuovi. Un indice Git temporaneo mantiene intatto lo staging dell’utente. Il risultato include un ID e il comando di verifica. In VINCOLI inserisci `CAPABILITY: write`, `REVIEW_ID: <id>` e i percorsi. In VERIFICA includi il comando restituito dal piano e cosa dimostra. L’hook controlla che il piano corrisponda al profilo e che i file siano ancora alla baseline quando autorizza Agent. Se il task ha criteri espliciti, aggiungili al JSON di piano come `criteria: [{"id":"c1","description":"..."}]`; chiedi al worker di restituire per ciascuno esito (`soddisfatto`, `non soddisfatto` o `non verificato`), prova osservabile e vincolo aperto. Il coordinatore registra il resoconto worker prima della review con `node .claude/routing/delivery.cjs handoff <id> <file.json>`. La review espone i criteri uno per uno; un criterio senza prova o con stato non soddisfatto impedisce l’accettazione.

## Test del worker

| Runner | Destinazione esplicita |
| --- | --- |
| `node` | `file` di test JavaScript |
| `vitest`, `jest` | `file` di test e runner installato nel `node_modules` della root |
| `pytest` | `file` Python, con pytest disponibile nell’interprete corrente |
| `dotnet` | `file` del progetto test e `selector` con nome test pienamente qualificato, tramite filtro VSTest |
| `maven` | `file` del POM del modulo e `selector` della classe o del metodo `Classe#metodo` |
| `gradle` | `file` wrapper e `task` preciso come `:modulo:test`, più `selector` pienamente qualificato |

Per Node, Vitest, Jest e pytest aggiungi `selector` quando solo alcuni test nel file sono impattati. Usa il nome esatto oppure, per pytest, il nodo del test come `TestParser::test_case`. Il singolo file basta se tutti i test in quel file sono pertinenti.

Il worker esegue soltanto `node .claude/routing/delivery.cjs check <id>`. Per TDD ripete il comando mirato prima e dopo il fix. Le chiamate dirette a Bash e PowerShell dei subagent vengono bloccate fuori da quel comando. I profili in sola lettura usano Read, Grep e Glob. Per una diagnostica aggiuntiva, l’orchestratore può fornire un log circoscritto.

Indica `tests: []` e `noTestsReason` solo quando manca una verifica applicativa pertinente. Per un runner non supportato, l’orchestratore può eseguire direttamente le verifiche mirate o occuparsi dell’intervento se la delega richiede test che il worker non potrebbe svolgere. Le configurazioni personalizzate dei progetti e gli script di build possono ampliare il comportamento di un runner. L’orchestratore verifica la configurazione prima di approvare il piano.

## Dopo la consegna

1. L’orchestratore esegue `node .claude/routing/delivery.cjs review <id>`.
2. Apre il file `review.diff` indicato dall’output e legge tutti gli hunk pertinenti, inclusi quelli dei test. Controlla i file interessati, le modifiche alla logica e che le asserzioni dei test dimostrino il comportamento richiesto. Il comando confronta due alberi Git, gestendo codice già sporco, nuovi file e cancellazioni nel perimetro. Se una modifica non è testuale, verifica l’artefatto e il delta Git con lo strumento appropriato.
3. Controlla la ricevuta prodotta dal runner e il riepilogo JSON di `review`: diff presente/vuoto, esito di ogni test mirato, freschezza e prossimo controllo. `suite: not-run` indica che il comando di review non esegue la suite. Riporta a parte l’esito effettivo della suite nella consegna. `pass` riguarda i file e gli input dichiarati. `stale` significa che qualcosa è cambiato dopo i test. Per test mirati in stato `fail` o `not-run`, risolvi e ripeti una verifica mirata prima di accettare. Se un runner conserva un log su disco, apri il percorso indicato dalla ricevuta; altrimenti usa il riepilogo e il comando mirato per riprodurre il dettaglio. Il testo del worker è un segnale di stato. L’accettazione si fonda sul diff Git letto dall’orchestratore, sui risultati reali e sui criteri provati.
4. Dopo il controllo, solo l’orchestratore può avviare la suite completa. Se la fase usa ICM, l’orchestratore esegue il check ICM e salva l’handoff con i riferimenti necessari.

`review` chiude il piano attivo anche se il worker si è fermato prima di completare. Per proseguire con un’altra modifica, crea un nuovo piano. I diff e i log vengono conservati nei metadati Git sotto `claude-routing-work`. I controlli riguardano gli hook nativi registrati e i runner scelti. Un MCP o un hook esterno con un proprio esecutore segue la configurazione di quel componente.
