# Caronte — guida del kit 2.4.0

Aggiornato il 18 novembre 2026. Brief preparati dal coordinatore, ricerca e sviluppo delegati per scopo, ripresa ICM verificabile. Il kit conserva Headroom e gli hook esistenti. Ricerca e benchmark esterni sono in [RICERCA.md](RICERCA.md).

## Installazione

Servono Git, Node.js 22+, Python 3.11+ e Claude Code 2.1.327+. Per installare RTK su Windows serve WinGet se il binario manca.

Nel clone permanente di Caronte esegui `npm link` una volta per collegare il comando `caronte` al clone. Da quel momento `git pull` aggiorna anche il comando collegato. L’installer mostra il percorso del clone e la revisione usata. Apri la root del progetto e lancia:

```powershell
caronte install-project
```

Il comando installa Caronte, ECC, Headroom e RTK nella cartella corrente. Aggiungi `--dry-run` per vedere le modifiche previste oppure `--verify` per verificare l’installazione.

Nel terminale interattivo Caronte mostra il logo ASCII arancione, una percentuale per ciascun componente, aggiornata al completamento delle fasi, e le percentuali di download degli strumenti che le espongono. Le copie riutilizzate sono indicate durante il controllo. I messaggi di avanzamento usano stderr. Il riepilogo JSON finale esce su stdout.

Caronte cerca Headroom nel PATH e nella cartella utente `.local/bin`. Una copia funzionante viene riutilizzata prima dell’ambiente del progetto. Se Windows nega l’avvio e manca un’altra copia funzionante, il riepilogo indica l’eseguibile bloccato.

Caronte riusa ECC se il plugin è già abilitato, registrato per il progetto o l’utente, e il suo percorso contiene GateGuard. Cerca RTK anche nelle directory utente di Scoop, WinGet e Cargo. `caronte start` aggiunge il percorso RTK selezionato al PATH della sessione Claude Code.

Per puntare direttamente all’eseguibile Headroom già installato, passa il suo percorso:

```powershell
caronte install-project "--headroom-path=C:\strumenti\headroom.exe"
```

Puoi indicare anche `--ecc-path=<directory>` per un plugin ECC già abilitato in Claude Code e `--rtk-path=<eseguibile>` per RTK. La riscrittura Bash richiede anche che il binario RTK scelto sia raggiungibile col nome `rtk` nel PATH. I percorsi espliciti vengono salvati nei settings locali del progetto e usati dalle verifiche successive.

Puoi anche avviare lo script direttamente dal clone o da uno ZIP estratto in una cartella separata dal progetto:

```powershell
node --test tests/routing.test.cjs
node install.cjs "C:\percorso\mio-progetto" --dry-run
node install.cjs "C:\percorso\mio-progetto"
node install.cjs "C:\percorso\mio-progetto" --verify
```

L'installer copia i componenti `.claude`, inserisce un blocco aggiornabile in CLAUDE.md e integra gli hook in `.claude/settings.local.json`. Conserva proxy, permessi e altri hook. Se trova gli hook di routing del kit nello scope di progetto, li migra allo scope locale per evitare duplicazioni; gli hook estranei restano al loro posto. Imposta Sonnet/medium solo se quelle impostazioni locali non esistono già; mostra il modello locale risultante. Flag CLI, variabili d'ambiente e policy possono prevalere. Se il tuo modello era diverso e vuoi la baseline proposta avvia `claude --model claude-sonnet-5-5 --effort medium` tramite il tuo collegamento Headroom abituale.

È ripetibile: una seconda installazione identica non cambia file. Prima di scrivere verifica conflitti sui file del kit; accetta automaticamente i file originali dei kit da 1 a 2.2. Se hai personalizzato un file che collide, si ferma prima delle modifiche, così Claude può integrare il diff preservando le personalizzazioni. I settings devono essere JSON valido; per JSON con commenti serve un merge consapevole. Il backup delle modifiche è in `.claude-routing-backups/<data>/`, con manifest dei file preesistenti. Non includere backup con configurazioni locali nel repository pubblico.

Dopo l’installazione avvia Claude Code dalla root del progetto:

```powershell
caronte start
```

Il comando mostra il logo con il link GitHub e usa la copia Headroom selezionata dall’installer. Puoi passargli le opzioni di Claude Code, per esempio `caronte start --resume`.

L’avvio salta per impostazione predefinita la preparazione di Serena gestita da Headroom. Per abilitarla esplicitamente usa `caronte start --code-memory serena`. Caronte mostra il percorso scelto e lancia direttamente Headroom. Le verifiche della CLI avvengono durante l’installazione o con `caronte install-project --verify`. Se il percorso salvato è mancante, Caronte cerca Headroom nel PATH, in `.local/bin` e poi nella copia del progetto. Se Windows nega l’avvio dell’eseguibile selezionato, Caronte riporta l’errore.

Puoi anche aprire Claude Code nella root del progetto e incollare il [prompt di installazione autonoma](INSTALL_PROMPT.md). `--verify` verifica i file, ECC, il runtime Headroom e l’hook RTK. Se un’installazione precedente aveva solo Caronte, riesegui `caronte install-project` per aggiungere le dipendenze.

Per avviare Headroom con il Python dell’installazione `uv` esistente, usa questo comando. Caronte cerca nella directory standard degli strumenti `uv` o in `UV_TOOL_DIR`, se impostata.

```powershell
caronte start --headroom-python --verbose
```

Per un interprete in un altro ambiente, puoi indicare il percorso assoluto con `--headroom-python=<percorso>`.

Usa `caronte install-project --headroom-python` per riusare lo stesso ambiente durante l’installazione. Usa `caronte install-project --verify --headroom-python` per verificarlo in un progetto già installato.

## Aggiornamento automatico di Caronte

Quando avvii con `caronte start` da un progetto già installato, Caronte applica la revisione del clone locale prima di aprire Claude Code. Se trova file della sidebar distribuiti dal kit che differiscono dalla versione attesa, li salva nel backup e installa quelli della nuova revisione. Le modifiche locali ai file gestiti fuori dalla sidebar continuano a richiedere una risoluzione del conflitto.

Se avvii Claude Code direttamente, puoi ottenere lo stesso aggiornamento con l’hook utente.

Attiva l'hook una volta nel clone Git che userai come sorgente. Su Windows, per
esempio:

```powershell
Set-Location "C:\git\Caronte"
git pull --ff-only
node .\install.cjs --enable-auto-update
```

Da quel momento basta eseguire `git pull --ff-only` nel clone di Caronte e
avviare o riprendere Claude Code nella root del progetto. L'hook utente
`SessionStart` riconosce anche le installazioni precedenti con il blocco Caronte
in `CLAUDE.md` e il relativo hook nel progetto. Ogni worktree con Caronte
installato viene aggiornato al proprio avvio.

La versione del kit è il commit Git registrato in
`.claude-routing-backups/caronte-install.json`. Caronte legge i file
committati in `HEAD` dal clone locale e applica solo revisioni successive.
Il controllo funziona senza rete. Il merge mantiene i permessi, gli hook
estranei e la configurazione di ECC. I conflitti nei file gestiti rimandano
l'aggiornamento e producono un messaggio con il percorso da verificare.
Gli aggiornamenti applicati conservano un backup. Le eventuali risorse già
caricate da Claude Code all'inizio della sessione vengono rilette al riavvio.

L'aggiornamento del kit funziona anche senza RTK o WinGet. L'installer manuale
continua a gestire ECC, Headroom e RTK. Il controllo delle dipendenze segue
[la propria procedura](DIPENDENZE.md).

Se sposti il clone, esegui di nuovo `--enable-auto-update` dalla nuova posizione.
Per rimuovere l'hook utente usa `node install.cjs --disable-auto-update`.
Se un'interruzione forzata lascia `.claude-routing-backups/.caronte-install.lock`,
rimuovilo solo dopo aver verificato che nessuna installazione sia in corso.

## RTK per Git, build e test

`node install.cjs` cerca RTK (Rust Token Killer) nel PATH e nelle posizioni utente più comuni e verifica binario e comandi. Se manca lo installa con WinGet (`rtk-ai.rtk`, scope utente) su Windows. Su macOS e Linux usa Homebrew o Cargo, oppure una release ufficiale verificata in `~/.local/bin` se trova `curl` e `tar`. Il dry-run mostra il metodo previsto.

Il kit registra un hook Bash in `.claude/settings.local.json` e invoca RTK dopo il via libera di GateGuard. Per impostazione predefinita usa il GateGuard incluso nella copia di ECC del progetto.

In PowerShell puoi eseguire direttamente i comandi compatibili, per esempio `rtk git status`. Dopo l'installazione riapri il terminale se WinGet ha appena aggiornato il PATH. Controlla `rtk --version` nel terminale e `/hooks` in Claude Code. Fai eseguire `git status` tramite Bash e controlla le attività RTK con `rtk gain --history`.

Se l'installer trova un altro programma con nome `rtk`, ti segnala la collisione. Con una versione vecchia priva di hook nativo riusa un hook legacy già configurato o indica di aggiornare RTK. Se RTK resta indisponibile, il routing viene comunque installato e il comando termina con codice 1 e un motivo nel campo `rtk.error`. Risolto il problema, puoi rieseguire lo stesso comando.

[Riferimento RTK per installazione e hook](https://github.com/rtk-ai/rtk/blob/develop/INSTALL.md).

### GateGuard ECC prima di RTK

La sequenza è il comportamento predefinito della riscrittura automatica su Bash. Per usare un altro GateGuard, imposta `CARONTE_ECC_GATEGUARD` oppure passa `--gate-rtk` con il percorso al file
`scripts/hooks/gateguard-fact-force.js` di una copia di ECC che amministri
e consideri attendibile.

```powershell
node install.cjs "C:\progetto" "--gate-rtk=C:\ECC\scripts\hooks\gateguard-fact-force.js" --dry-run
node install.cjs "C:\progetto" "--gate-rtk=C:\ECC\scripts\hooks\gateguard-fact-force.js"
node install.cjs "C:\progetto" --verify
```

Il nuovo hook Bash chiama il modulo GateGuard con il payload originale.
Invoca RTK solo quando il modulo restituisce il payload come via libera.
In caso di riscrittura mantiene gli altri argomenti e lascia il controllo
dei permessi a Claude Code. La sequenza resta configurata agli aggiornamenti.

L'installer sostituisce la registrazione locale RTK standard di Caronte.
Gli hook RTK autonomi riconoscibili nei settings utente o di progetto
devono essere rimossi prima della migrazione. Usa `/hooks` in una nuova
sessione per controllare anche gli hook caricati da plugin e policy.
Se usi il plugin ECC completo, disattiva la sua registrazione Bash autonoma
`pre:bash:gateguard-fact-force` per questa configurazione, così GateGuard
viene eseguito una sola volta. Caronte richiama il modulo direttamente,
quindi il filtro per profilo del runner ECC non si applica a questa
registrazione. La configurazione riguarda Bash. Gli hook ECC per PowerShell
e gli altri tool continuano a seguire la configurazione di ECC.

## ECC e accettazione del lavoro

I sette profili ECC inclusi si aggiungono a quelli del kit. Il coordinatore seleziona il ruolo quando si adatta al problema, prepara un brief autosufficiente e un piano mirato per ogni delega che modifica file. La revisione del lavoro resta all’orchestratore, che apre il diff Git e controlla la ricevuta dei test. L’unico soggetto che esegue la suite completa è l’orchestratore dopo il controllo. La procedura e i runner sono in [.claude/routing/CONSEGNA.md](.claude/routing/CONSEGNA.md).

Avvia Claude Code normalmente dopo l’installazione. Il controllo dei riferimenti ECC e di RTK è in [DIPENDENZE.md](DIPENDENZE.md).

### ECC completo e Caronte

Esegui `caronte install-project` dalla root del progetto.

L’installer scarica il repository completo della release ECC 2.2.3 in
`.claude/skills/ecc/`, lo esclude dall'indice Git locale e lo rende disponibile
come plugin `ecc@skills-dir`. Il primo download richiede accesso a GitHub.
Se hai già una registrazione ECC attiva da un marketplace, Caronte la riusa
per evitare di eseguire gli hook due volte.

Apri una nuova sessione nella root del progetto. `/plugin`, `/agents` e
`/hooks` mostrano i componenti caricati. La configurazione rispetta
l'impostazione dei fork già decisa per il progetto.

- Per i flussi ECC usa i suoi comandi, skill e subagent nativi. Anche le loro
  deleghe generiche conservano il flusso di ECC. Le normali approvazioni di
  Claude Code e gli hook di ECC continuano ad applicarsi.
- Per `/implementa` e gli altri flussi Caronte valgono il brief e i controlli del
  kit. Puoi assegnare un profilo esterno a un piano Caronte dichiarando il nome
  completo e il `REVIEW_ID`. Le deleghe Caronte in sola lettura e le
  sotto-deleghe di un worker gestito usano i profili del kit.
- L'autoformattazione di ECC può aggiornare i file dopo una verifica. Se
  cambia un input, la ricevuta del test diventa obsoleta e va rigenerata
  prima di usare quei risultati per accettare la consegna.

## Messaggi nella chat principale

All’avvio compare un avviso quando il kit aggiorna ECC o RTK. Durante il lavoro, il coordinatore comunica i passaggi che incidono sul risultato o richiedono una decisione. Alla consegna espone l’effetto della modifica, le evidenze che ha controllato e ciò che resta da fare. Per una richiesta di sola analisi, riporta i risultati e le fonti pertinenti.

Esempio di consegna per una correzione .NET:

> **Corretto l’import CSV.** Se manca `Note`, l’import prosegue con il campo vuoto. Le colonne obbligatorie restano validate.
>
> **Diff Git verificato.** `CsvImporter.cs` e `CsvImporterTests.cs`.
>
> **Verifiche.** Tre test mirati passati. Suite completa non eseguita.
>
> **Stato.** Modifica in locale. Nessuna migrazione necessaria.

I riferimenti al diff e alle ricevute vengono dalla verifica dell’orchestratore. I log e i dettagli delle deleghe sono disponibili su richiesta.

## Pannello subagent in Claude Code

Avvia `claude` dalla root del worktree dove hai installato Caronte e conferma la
fiducia nel progetto al primo avvio. Il mod fa parte del progetto e il pannello
si apre automaticamente se Claude Code ha spazio. Usa `/tui fullscreen` per
vederlo sulla destra. In un terminale stretto, `/caronte-panel` lo apre sopra il
prompt. Lo stesso comando lo chiude anche durante una risposta.

La sidebar ha sfondo nero. Il primo 20% contiene il logo e il link GitHub
dell'autore. In Claude Desktop e nell’estensione Claude Code per VS Code il
logo è un SVG dell’ASCII art originale su una griglia da 200 × 100. Nel
terminale viene mostrata la scritta CARONTE arancione. La versione 3D da 47 × 11
caratteri compare quando il riquadro è abbastanza grande. Nei riquadri più
piccoli compare la scritta 3D compatta, oppure la scritta semplice se manca
spazio per cinque righe. Il 60% centrale mostra le attività in corso,
le deleghe concluse, gli strumenti usati e i checkpoint. Cambia pagina con
**↑** e **↓**, oppure con `/caronte-panel prev` e `/caronte-panel next`.
L’ultimo 20% mostra il nome della cartella radice del repository Git, i totali
per input, output, cache read e cache write, e la stima del costo in USD
riportata da Claude Code.

Le schede delle deleghe e i contatori vengono salvati localmente a partire
dalla prima sessione con questa versione della sidebar. Lo storico usa la
directory `.git/caronte-sidebar/` del repository principale, condivisa dai
worktree collegati. I riepiloghi delle deleghe conservano la descrizione
mostrata in sidebar e i nomi degli strumenti. Il pannello usa uno storico
locale distinto dalla telemetria del dashboard.

Seleziona **ASCII** o usa `/caronte-panel ascii` per aprire l'originale.
Usa **←** e **→** per vedere tutte le colonne, oppure digita
`/caronte-panel left` o `/caronte-panel right`. Scorri in verticale per
vedere tutte le righe. Seleziona **Subagent** per tornare al pannello.

Per disattivarlo nei prossimi avvii di quel progetto, esegui dalla root
`claude plugin disable caronte-panel@skills-dir --scope local`. Per riattivarlo
usa `claude plugin enable caronte-panel@skills-dir --scope local`.
Il mod è stato verificato su Claude Code 2.1.327 e si carica insieme al plugin
ECC completo.

| Dato | Come leggerlo |
| --- | --- |
| Stato e attività | Stato nativo dell’agente, descrizione della delega e strumento in esecuzione quando disponibile. |
| In / Out | Token di input senza cache e token generati, dai contatori di Claude Code per l’agente e dai totali dei turni conclusi. |
| Cache ↓ / ↑ | Token letti dalla cache e token scritti in cache durante le richieste dell’agente. |
| Avanzamento | Checkpoint osservati nel piano Caronte del worktree e della sessione. Uno per l’assegnazione, uno per i test mirati se previsti e uno per la revisione del diff. Se la revisione vede test obsoleti, il relativo checkpoint torna incompleto. |

Un trattino indica che Claude Code non ha ancora fornito contatori o che il
pannello non ha osservato un piano misurabile per quell’agente. Il 100% indica il
completamento dei checkpoint previsti dal piano. Il pannello aggiorna la vista
in memoria, senza chiamate al modello o nuove registrazioni nel dashboard locale.
Aprilo prima di delegare per seguire anche l’assegnazione del piano.

## Telemetria locale

La raccolta locale parte al primo avvio di Claude Code con Caronte. Dalla root
del worktree usa `/caronte-telemetry-off` per fermarla e `/caronte-telemetry-on`
per riattivarla. Il report
locale distingue blocchi, retry candidati, test mirati e conteggi token
presenti nelle sessioni Claude Code. Vedi [TELEMETRY.md](TELEMETRY.md).

## Contesto e compattazione

| Sessione | Finestra configurata | Turni massimi |
| --- | ---: | ---: |
| Orchestratore | 200.000 token | — |
| Ricerca Haiku | 100.000 token | 5 |
| Decisione Opus | 100.000 token | 6 |
| Implementazione Haiku | 100.000 token | 8 |
| Implementazione Sonnet | 100.000 token | 12 |

L'installer abilita la compattazione e imposta `autoCompactWindow: 200000` in `.claude/settings.local.json`. Allinea eventuali finestre già salvate per modello nello stesso file e conserva le altre impostazioni dei modelli. I 100.000 token dei worker del kit sono il minimo documentato per il loro frontmatter. La finestra è una soglia nativa approssimativa di contesto attivo. La capacità del modello, la riserva di Claude Code, la compattazione in inattività e la dimensione dell'ultimo output possono influire su quando la compattazione viene osservata. La soglia e i turni non sono limiti ai token fatturati. Il kit imposta i 100k sui propri profili. Per altri profili valgono i loro settings e la finestra ereditata.

`CLAUDE_CODE_FORK_SUBAGENT=0` disattiva i fork automatici di conversazione nel progetto. Il coordinatore delega un esito verificabile con scope, fonti, test e condizione di arresto. Raggruppa operazioni che condividono input e verifica per evitare preparazioni duplicate. Usa ricerche mirate e letture per intervallo. Il worker restituisce esito, evidenze e percorsi, salvando i log estesi su disco quando ha i permessi. Se cambia lo scope, usa un worker nuovo con il suo brief. Se il worker raggiunge il limite di turni, usa il risultato parziale e riprendilo solo se la sua cronologia contiene letture che è vantaggioso riusare.

L'hook `PreCompact` per compattazioni automatiche chiede al riepilogo di preservare vincoli, decisioni, verifiche e prossimo passo. Per ICM indica anche di conservare il percorso del manifest e l'ultima fase verificata. L'hook non lancia richieste al modello. Dopo la compattazione, usa il manifest per rileggere lo stato effettivo del run.

Nella tua sessione Headroom, `/autocompact` senza argomenti mostra la finestra della sessione principale e `/context` mostra quanto occupa il contesto. Se la finestra differisce, controlla flag di avvio, impostazioni gestite e variabili. Se presente, `CLAUDE_CODE_AUTO_COMPACT_WINDOW` può prevalere anche sui 100k dei worker. Controlla anche `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE`, `DISABLE_AUTO_COMPACT` e `DISABLE_COMPACT`. L'installer segnala queste variabili se le vede nel suo processo o nei settings locali/del progetto, senza rimuoverle. Può non vedere quelle aggiunte solo dal wrapper al lancio. Con `claude --debug` puoi cercare `invalid autoCompactWindow` per diagnosticare un valore ignorato.

Riferimenti Anthropic: [finestra automatica](https://code.claude.com/docs/en/model-config#set-the-auto-compact-window), [impostazioni](https://code.claude.com/docs/en/settings-reference#autocompactwindow), [finestra dei subagent](https://code.claude.com/docs/en/sub-agents#frontmatter-reference).

## Uso quotidiano

Scrivi normalmente il lavoro da fare. CLAUDE.md indica al coordinatore come scegliere il profilo e comporre il mandato nel proprio turno.

| Profilo | Scopo | Tool |
|---|---|---|
| ricerca-haiku | Ricerca estesa con ritorno breve | Lettura |
| decisione-opus | Decisione tecnica precisa | Lettura |
| implementazione-haiku | Modifica meccanica, scope ristretto e test noto | Lettura, scrittura, Bash/PowerShell |
| implementazione-sonnet | Implementazione circoscritta più articolata | Lettura, scrittura, Bash/PowerShell |

I worker inclusi sono foglie: non aprono altri agenti. La regola del brief e l'hook valgono anche per altri agenti autorizzati a delegare, entro i limiti nativi di Claude Code. Usa il tool shell disponibile nel tuo ambiente; i profili dichiarano Bash e PowerShell. I profili di sviluppo preservano CLAUDE.md e non estendono permessi; l’hook applica il perimetro di scrittura e i test mirati ai tool nativi coperti. Il ricercatore Haiku mantiene `omitClaudeMd: true`, perciò il coordinatore deve fornirgli le regole pertinenti.

Comandi espliciti:

```text
/indaga trova chi modifica il totale dopo lo sconto
/decisione valuta questa modifica al contratto API usando i fatti già raccolti
/implementa correggi il calcolo nei file indicati e verifica il test concordato
```

Questi comandi girano nel coordinatore, che vede la conversazione e prepara il brief; poi usano Agent. Non richiedono all'utente i sei campi. /implementa preferisce Sonnet e seleziona Haiku solo per il caso meccanico definito. I task minimi possono restare nel thread principale senza comandi dedicati.

## Contratto di delega

```text
OBIETTIVO: lavoro circoscritto.
INPUT: percorsi e sezioni pertinenti.
INPUT_FILES: ["src/cart.js", "tests/cart.test.cjs"]
FATTI: decisioni, evidenze con fonte, informazioni solo in chat; ipotesi distinte.
VINCOLI: modifica solo src/cart.js; preserva API e lavoro preesistente.
CAPABILITY: write
USCITA: diff sul disco, esito e riferimenti essenziali.
VERIFICA: node --test tests/cart.test.cjs; fermati al pass o al blocco motivato.
```

Per input/fatti/vincoli realmente assenti è ammesso `nessuno`. Non è ammesso al posto di obiettivo, uscita o verifica. L'hook rifiuta campi vuoti, duplicati, disordinati, placeholder comuni e blocchi di codice non chiusi. Le etichette dentro blocchi di codice chiusi sono dati letterali. I metadati INPUT_FILES, ICM_RUN e ICM_STAGE devono stare fuori dai blocchi di codice, su righe proprie dentro INPUT; per i nomi riservati citati come esempio usa un blocco di codice.

`INPUT_FILES` viene controllato sul filesystem. Non elencare output ancora da creare. I riferimenti testuali generici non sono interpretati come percorsi. Le liste supportano file relativi al progetto, anche con spazi e Unicode; i riferimenti esterni richiedono una copia o un riferimento locale appropriato prima della delega.

Il chiamante verifica contenuto e tool nel proprio turno. Lo script non può provare che i fatti siano veri o sufficienti, né scoprire dati della chat omessi. Non aggiunge un modello revisore per ogni brief. La risposta del worker contiene esito, evidenze, controllo effettuato e ostacolo preciso. Riprendi un worker per integrare dati mancanti senza ripetere inutilmente tutta l'indagine.

## Copertura reale

In modalità ECC completo, il validatore delle deleghe della tabella si
applica ai profili del kit, ai brief Caronte espliciti e alle sotto-deleghe
dei worker gestiti dal kit.

| Superficie | Comportamento |
|---|---|
| Agent/Task dal principale | Validazione del brief prima dell'avvio |
| Agent/Task da un subagent | Stesso validatore se gli hook di progetto sono attivi |
| /indaga, /decisione, /implementa del kit | Preparazione nel coordinatore, poi Agent validato |
| SubagentStart, anche con CLAUDE.md omesso | Promemoria breve del protocollo, senza chiamata LLM aggiuntiva |
| SendMessage/ripresa di agente esistente | Procedura di delta nelle istruzioni; nessun controllo sintattico del messaggio |
| Fork manuali, skill di terze parti con context: fork, team e processi CLI separati | Non hanno copertura pre-avvio completa da questo validatore; non usarli come alternative ai comandi del kit per deleghe controllate |
| Hook disabilitati/policy che li escludono | Nessuna garanzia tecnica del validatore |

SubagentStart propaga istruzioni: non valida il prompt prima dell'avvio. Nessun kit basato solo su questi hook può attestare la completezza di ogni possibile superficie esterna. Il routing per scopo resta una decisione del modello guidata dai profili; il validatore non seleziona il modello.

## ICM e controllo della ripresa

Per un lavoro singolo salva un handoff minimo. Per fasi dipendenti ricorrenti usa contratti e manifest seguendo [.claude/routing/ICM.md](.claude/routing/ICM.md). Il comando status identifica risultati mancanti, falliti o obsoleti. Il comando check esegue la verifica dichiarata e registra hash, esito e log. Il gate blocca le fasi che dipendono da ricevute non più valide.

Nelle deleghe ICM includi ICM_RUN e ICM_STAGE in INPUT: il gate viene allora eseguito automaticamente dall'hook. Nel thread principale la procedura richiede gli stessi comandi; non viene intercettata ogni operazione di scrittura. L'adattamento delle ricevute centralizzate per run è documentato in ICM.md.

Cambiare contratto non svuota la cronologia. Mantieni il contesto caldo quando utile; usa un worker isolato per una fase autonoma verbosa. Per riprese lunghe salva l'handoff e ricostruisci da file. Non creare un subagent per ogni microfase.

Per controllare i link nascosti usa esplicitamente `python .claude/skills/icm-architect/scripts/links.py .icm`. Lo script originale ICM non è stato alterato.

## Verifiche e limiti della consegna

I test inclusi esercitano parser, metadati, hook tramite stdin, invalidazione delle dipendenze, log, esiti falliti, timeout, ripresa in processo nuovo e installer. Leggi [VERIFICA.md](VERIFICA.md) per l'esito della versione consegnata. Non equivalgono a una sessione Claude Code autenticata o a una prova del comportamento del modello.

Sul tuo PC completa questi controlli:

1. /indaga con una richiesta normale: osserva Agent, il modello scelto e il mandato generato.
2. Chiedi un Agent di prova con un campo mancante: deve essere respinto; con un brief completo deve partire.
3. Esegui una piccola modifica con test e controlla diff ed esito reale del worker.
4. Per un run ICM approva la prima fase, cambia un input e accerta che la successiva sia bloccata. Riavvia Claude e ricostruisci lo stato da status.
5. Confronta task equivalenti con la tua baseline. Conta anche retry, tutti i subagent e cache. Nessuna percentuale di risparmio del kit è ancora dimostrata.

Fonti tecniche: [hook](https://code.claude.com/docs/en/hooks), [subagent](https://code.claude.com/docs/en/sub-agents), [skill](https://code.claude.com/docs/en/skills), [modelli](https://code.claude.com/docs/en/model-config).
