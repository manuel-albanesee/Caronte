# Ricerca e criteri di misura

Ricerca del 17 novembre 2026. Per installazione e comportamento del kit aggiornato leggere GUIDA.md. Nessun benchmark del kit completo è stato eseguito.

## Scelta consigliata

Tieni Sonnet 5.5 a `medium` come thread principale. Affida a Haiku 5.5 a `low` le indagini che produrrebbero molte letture e a Opus 5.5 a `medium` le decisioni difficili da invertire. Usa ICM quando servono fasi con esiti verificabili o uno stato da riprendere. Per un lavoro minuscolo e isolato che richiede comunque un modello, avvia direttamente Haiku. Un comando locale resta la strada più corta per un conteggio, una ricerca esatta o un test già definito.

| Compito | Esecuzione | Come contenere il consumo |
|---|---|---|
| Cercare un simbolo o contare occorrenze | Comando locale, oppure tool diretto nel thread già aperto | Restringi directory, pattern e output |
| Domanda singola, estrazione o classificazione su testo delimitato | Haiku 5.5 `low`, da avvio diretto se è una nuova attività | Passa solo l'input necessario e il formato di uscita |
| Spoglio di più file, mappatura chiamanti, analisi di un log voluminoso | Haiku 5.5 `low` in un contesto separato | Un solo agente e un ritorno breve con riferimenti |
| Fix circoscritto o implementazione con test definiti | Sonnet 5.5 `medium` nel thread principale | Una fase coerente, test mirati e diff in repo |
| Decisione tecnica difficile, migrazione complessa o causa radice trasversale | Opus 5.5 `medium` per una domanda precisa | Passa evidenze e vincoli già raccolti. Prova `high` se emerge un dubbio decisivo |
| Attività autonoma eccezionalmente lunga o difficile | Fable 5.2, esplicitamente, se disponibile | Valutalo su task dove il costo di errori e rilavorazioni giustifica la prova |

Se un caso difficile richiede tutto il contesto già acquisito, l'Opus nel thread principale può essere più efficace di un delegato che deve ricostruirlo. Per lavori con un confine netto tra pianificazione ed esecuzione, `claude --model opusplan` usa Opus in Plan Mode e Sonnet in esecuzione. Il cambio di modello ricalcola il contesto per il modello di destinazione se la cache corrispondente è fredda. La pianificazione può inoltre avviare il subagent Plan. Usa questo percorso quando hai davvero bisogno di un piano, considerando entrambi i costi.

Anthropic documenta il routing per difficoltà e ha pubblicato prove nelle quali un effort maggiore aumenta la verifica degli edge case. RouteLLM mostra come valutare il compromesso tra costo e qualità su benchmark di routing. Questi risultati motivano la prova sul tuo repository, dove contano anche tool, cache e rilavorazioni.

Fonti [Modelli Claude Code](https://code.claude.com/docs/en/model-config), [Building effective agents](https://www.anthropic.com/research/building-effective-agents), [Using Claude Code: Spending your effort](https://claude.dev/blog/spending-your-effort/), [RouteLLM, ICLR 2025](https://arxiv.org/abs/2406.18665).

## Caveman e RTK

| Problema | Scelta nel kit e riscontro |
|---|---|
| Testo tra agente e subagent | Sei campi brevi con riferimenti e verifiche. Gli studi su handoff strutturati mostrano benefici su alcuni benchmark e regressioni con formati rigidi su altri. Qui campi stabili e prosa libera conservano i dettagli che guidano l'esecuzione. [Routed Graph Handoff, Findings of EMNLP 2026](https://aclanthology.org/2026.findings-emnlp.2008/) |
| Prosa generata dal modello | Adotta la concisione direttamente nel prompt. JetBrains ha osservato **−8,5% di token output** su 82 task agentici appaiati con Caveman forzato, con costo aggregato sensibile agli outlier. TokenTrial v0.3 ha misurato **+25% di costo su Sonnet 5.5** con Caveman v4.1.0 e un risultato inconcludente su Haiku 5.5. Questi studi riguardano sessioni, senza isolare il passaggio tra subagent. [JetBrains](https://blog.jetbrains.com/ai/2026/07/speak-to-ai-agents-like-cavemen-tosave-tokens/) · [TokenTrial](https://github.com/bishtashish708/tokentrial) |
| Output di Git, compilazione o test | RTK è mirato a ridurre l'output dei comandi prima che entri nel contesto. Il costo a fine task va misurato. Su 100 task SWE-bench Verified con Sonnet 4.6, il benchmark Dasein riportava **$2,05** per task riuscito con Caveman e **$3,07** con RTK, contro **$2,58** di base. In TokenTrial v0.3 l'effetto aggregato di RTK era inconcludente e il sottoinsieme Bash-heavy era più costoso. [RTK](https://github.com/rtk-ai/rtk) · [Dasein Code-Compression Bench](https://github.com/daseinlabs/code-compression-bench) · [TokenTrial](https://github.com/bishtashish708/tokentrial) |

`/caveman-compress` è documentato per file di memoria come `CLAUDE.md`. Il benchmark *CAVEWOMAN* mostra che comprimere l'input con stile telegrafico può degradare accuratezza e aumentare costo. Per il brief usa frasi brevi complete, riferimenti precisi e termini esatti. Il kit applica questa regola direttamente al passaggio. RTK, Caveman e Headroom restano prove indipendenti.

Fonti [Caveman benchmarks](https://docs.caveman.so/caveman/benchmarks), [CAVEWOMAN](https://arxiv.org/abs/2606.24083).

## Dove si riducono i token

- **Prima chiamata.** Apri direttamente il modello appropriato quando conosci già il tipo di lavoro. Eviti la chiamata del coordinatore necessaria per una delega automatica. Per una singola lettura piccola è in genere più economico usare il thread già aperto.
- **Contesto iniziale.** Tieni il routing in poche righe. Usa `.claude/rules/` con `paths:` e skill su richiesta per le istruzioni specialistiche. Un import `@file` in `CLAUDE.md` carica anche il file importato. Nel caso di ECC, controlla con `/context` quanto pesano le descrizioni dei molti agenti, le skill registrate e gli MCP. Evita di precaricare una libreria di skill negli agenti usati di routine.
- **Dati introdotti.** Fai produrre a `rg`, al test runner o a uno script il sottoinsieme pertinente prima che raggiunga il modello. Per una suite richiedi l'esito e i primi errori rilevanti, con il percorso al log completo. Mantieni gli snippet di codice necessari alla verifica.
- **Ragionamento e output.** Usa `low` per ricerca meccanica o classificazione e una risposta breve con formato esplicito. I token di thinking contano come output. Su Haiku, Sonnet e Opus 5.5 e Fable, Claude Code usa extended thinking sempre, quindi il controllo pratico è `effort`. Abbassarlo troppo può compromettere il successo al primo tentativo.
- **Ripetizione.** Usa il contesto già caldo per i turni della stessa attività. Usa `/clear` quando cambi obiettivo e `/compact` quando il lavoro è lo stesso e serve una sintesi. La compattazione richiede una chiamata e può ricostruire il prefisso della cache. Tieni un eventuale passaggio di fase in un brief con decisione, percorsi, test e stato.
- **Chiamate accessorie.** Per una baseline essenziale disattiva i suggerimenti della prossima domanda in `/config` e controlla le funzioni in idle se consumano budget. Evita catene di subagent e fan-out di default. Il lavoro in background continua a generare richieste. La riduzione del wall time e quella del consumo sono metriche diverse.

Fonti [Memoria e istruzioni](https://code.claude.com/docs/en/memory), [costi e consumo in background](https://code.claude.com/docs/en/costs), [prompt caching](https://code.claude.com/docs/en/prompt-caching), [effort](https://code.claude.com/docs/en/model-config).

## Headroom e cache

Usa Claude diretto come termine di confronto per i fix brevi. Per sessioni con log o output voluminosi, prova Headroom in **`cache`**, il default del profilo di coding. Prova **`token`** su ricerche isolate o input freddi se vuoi comprimere più aggressivamente. Il profilo `token` può riscrivere turni precedenti, perciò misura le scritture di cache e la qualità delle evidenze. L'output breve nasce da un task delimitato, effort adatto e formato di consegna conciso.

Nel tracker Headroom, l'issue #2438 riporta perdita di cache in una configurazione precedente. È una misura di un utente su versioni specifiche, utile per definire il test da fare oggi. Includi un controllo sull'esattezza di percorsi, righe e frammenti. Il rapporto di compressione del proxy descrive il suo intervento. Per sapere che cosa è successo al costo o al consumo di Claude, confronta l'usage riportato dal provider o dal client e l'eventuale dato di fatturazione.

Esempio ipotetico con Sonnet 5.5 e un output uguale da 1.000 token. Il turno con 60.000 token letti da cache e 2.000 input nuovi costa **$0,020**. Un turno con 30.000 input tutti scritti in cache a 5 minuti costa **$0,085**. Il secondo ha circa metà dei token di input e più di quattro volte il costo. La situazione opposta è possibile su input freddi che il proxy riesce a ridurre sensibilmente.

Fonti [Headroom proxy](https://github.com/headroomlabs-ai/headroom/blob/main/docs/content/docs/proxy.mdx), [issue Headroom #2438](https://github.com/headroomlabs-ai/headroom/issues/2438), [prezzi Anthropic](https://platform.claude.com/docs/en/about-claude/pricing).

## Prezzi API di riferimento

USD per milione di token. I piani in abbonamento misurano l'utilizzo con i propri limiti e possono usare crediti aggiuntivi.

| Modello | Input nuovo | Output | Scrittura 5 min | Scrittura 1 h | Lettura cache |
|---|---:|---:|---:|---:|---:|
| Haiku 5.5, prompt fino a 100.000 token | 0,10 | 0,50 | 0,125 | 0,20 | 0,01 |
| Haiku 5.5, prompt oltre 100.000 token | 0,50 | 2,50 | 0,625 | 1,00 | 0,05 |
| Sonnet 5.5 | 2,00 | 10,00 | 2,50 | 4,00 | 0,10 |
| Opus 5.5 | 4,00 | 20,00 | 5,00 | 8,00 | 0,20 |
| Fable 5.2 | 8,00 | 40,00 | 10,00 | 16,00 | 0,20 |

Haiku 5.5 supporta 1M di contesto su API Anthropic, mentre la fascia di prezzo cambia sopra 100.000 token di prompt. Per un profilo usato per indagini brevi, mira a rimanere molto sotto la soglia verificata in input effettivo. Il limite di contesto è una capacità del modello e il costo dipende anche da quanto contesto usi.

Fonti [Prezzi API](https://platform.claude.com/docs/en/about-claude/pricing), [finestra e prezzi di Haiku 5.5](https://code.claude.com/docs/en/model-config#haiku-5-5-context-window-and-pricing).

## Prova comparativa sul tuo repository

1. Scegli almeno tre task riproducibili con criterio di successo verificabile. Esempi pertinenti per te sono localizzare un mapping in un repo Angular/.NET, diagnosticare il primo errore significativo di un log di build e correggere un bug piccolo con esito di test noto. Aggiungi una decisione difficile se intendi misurare l'uso di Opus.
2. Parti da versioni, credenziali, impostazioni MCP, stato del repository e criteri identici. Registra versione e modalità di Headroom. Cambia una variabile per confronto. Usa la stessa directory e ripristina lo stato iniziale tra le prove in una copia dedicata. Percorsi di lavoro diversi possono cambiare il prefisso della cache.
3. Misura prima **Sonnet diretto vs routing selettivo**, usando lo stesso profilo Headroom. Misura poi **connessione diretta vs Headroom `cache` vs Headroom `token`**, usando la stessa configurazione di routing. Nel caso di un confronto con Anthropic diretto, verifica che l'avvio escluda davvero il proxy. Confronta prove che partono con la cache nello stesso stato.
4. Per ogni alternativa misura circa 3–5 ripetizioni per task, possibilmente alternando l'ordine. Separa la prova a freddo dalla sequenza di turni che crea e legge la cache. Un test a turno singolo dice poco sul beneficio della cache. Per task con agenti usa `/usage`, il riepilogo JSON o l'evento OpenTelemetry `claude_code.api_request`. Il campo `query_source` aiuta ad attribuire le richieste al thread principale, a un agente o a una compattazione.
5. Registra modello, effort, esito al primo tentativo, numero di richieste, input nuovo, output, letture e scritture di cache, eventuali retry e tempo. Confronta **token lordi per task riuscito** e, separatamente, **costo API per task riuscito**. Conta anche il consumo dei tentativi falliti nel numeratore. Su abbonamento verifica separatamente il consumo mostrato dal piano. Il costo stampato da Claude Code è una stima del client.
6. Per isolare il passaggio agente–subagent, mantieni modello, effort, strumenti, input e criteri fissi. Confronta un passaggio libero nella configurazione di controllo con il brief a sei campi del kit. Verifica esattezza di percorsi, valori e vincoli, esito finale, richieste per recuperare informazioni, token del chiamante e del subagent. Se vuoi valutare Caveman contro il brief compatto, aggiungilo come terzo braccio e conta il costo di caricarlo. Per RTK usa una prova separata con comandi che producono log. A parità di esito, misura se scendono i token dell'intero task.

Per l'uso non interattivo su PowerShell, un esempio di raccolta è il seguente. Mantieni le stesse opzioni che useresti nel lavoro vero.

```powershell
$task = 'Individua il punto di ingresso del flusso ordini. Indica percorso, riga e chiamante. Non modificare file.'
claude -p --model claude-sonnet-5-5 --effort medium --output-format json $task |
    Set-Content -Encoding utf8 sonnet-run.json
$receipt = Get-Content -Raw sonnet-run.json | ConvertFrom-Json
$receipt | Select-Object subtype, is_error, num_turns, total_cost_usd, usage, modelUsage |
    ConvertTo-Json -Depth 10
```

Per il totale lordo somma input nuovo, input letto da cache, input scritto in cache e output, su ogni richiesta. Le scritture per TTL sono un dettaglio delle scritture totali. Per il costo moltiplica ogni categoria per la tariffa del modello e della fascia di prompt corrispondente. Se fai `--resume` o `--continue` in print mode, il totale dichiarato include anche le esecuzioni precedenti. Usa l'ultimo totale o le differenze fra cumulati.

Promuovi il routing per una classe di task se a parità di criteri di accettazione richiede meno token per task riuscito. Valuta il costo separatamente. Per esempio, se un passaggio economico fallisce spesso e viene quasi sempre rifatto su Sonnet, somma i due passaggi. Un prezzo per token inferiore non garantisce meno token totali. Nel kit non ci sono misure del tuo repository né esecuzioni effettuate con le tue credenziali.

Fonti [Uso non interattivo](https://code.claude.com/docs/en/headless), [monitoraggio Claude Code](https://code.claude.com/docs/en/monitoring-usage), [valutazioni degli agenti](https://www.anthropic.com/research/demystifying-evals-for-ai-agents).
