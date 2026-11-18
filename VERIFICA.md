# Verifica Caronte 2.4.0

18 novembre 2026. Ambiente di esecuzione Linux, Node v24.22.3. Lo ZIP contiene la suite e il relativo risultato TAP, eseguibili senza dipendenze npm.

## Esiti locali

- 63 test automatici superati, zero fallimenti (`node --test tests/routing.test.cjs tests/telemetry.test.cjs`).
- Installazione da CLI: `--verify` prima e dopo il setup, `--dry-run` senza scritture, regole preesistenti conservate e seconda installazione senza modifiche. RTK è stato simulato nella prova d’installazione.
- Integrazione: binario ufficiale Claude Code 2.1.327 su Linux con API Anthropic simulata in locale. Una nuova sessione ha caricato `CLAUDE.md`, negato un brief incompleto, avviato `ecc-tdd-guide`, bloccato `npm test` nel worker ed eseguito con successo il comando di test mirato autorizzato. Questo verifica il collegamento effettivo degli hook, dei profili e del runner con il CLI.
- Telemetria: attivazione locale al primo avvio, disattivazione persistente, cancellazione, deduplica, ripartenza del confronto dopo un edit e nessun dato grezzo nei registri. Prova con Claude Code 2.1.327 e API simulata: 6 richieste nel report, 1 blocco del worker e 1 verifica mirata. I token del collaudo sono sintetici.
- Migrazione 2.3.2 → 2.4.0 verificata anche con il file settings precedente in CRLF.
- Chat principale: il blocco del kit in `CLAUDE.md` definisce gli aggiornamenti e il resoconto di consegna. L’applicazione del formato da parte di Claude resta da osservare in una sessione reale.
- Parser: campi, placeholder, CRLF, blocchi di codice backtick/tilde e annidati, stringhe letterali, metadati, file con spazi e Unicode, rifiuti restituiti come JSON.
- Deleghe: stessa validazione per nomi di modello diversi e metadati annidati simulati; promemoria SubagentStart tramite stdin; comandi manuali senza fork diretto; profili scrivibili dedicati.
- ICM: due fasi, gate, verifica, nuovo processo per la ripresa, modifiche a input/contratti/output/test, comando cambiato, verificatore fallito, timeout, output assente, ricevuta corrotta, lock e dipendenze cicliche.
- Consegna: repository Git temporanei con staging preesistente, baseline del worktree, blocco di shell e modifiche fuori perimetro, test selettivo reale con RED/GREEN, file nuovo, diff e ricevuta obsoleta dopo ulteriori modifiche.
- ECC: sette profili adattati con namespace locale. I testi upstream inclusi sono associati alla revisione e ai blob riconosciuti in `.claude/routing/ecc/manifest.json`.
- Avvio: release ECC compatibile e upgrade RTK via WinGet simulati. Blob errato o cambio major lasciano attiva la copia precedente.
- RTK: test del riuso binario e hook utente, dry-run, argomenti WinGet, registrazione locale senza duplicati e gestione di un errore del gestore. I processi WinGet e RTK sono simulati nella suite.
- Contesto: installazione della finestra 200k, override locali per modello, fork disattivato, configurazione del riepilogo e segnalazione delle variabili che possono prevalere.
- Installer: mantenimento di proxy, modello locale preesistente e hook estranei, dry-run, idempotenza, conflitti, aggiornamento dal validatore precedente e deduplicazione degli hook del kit tra scope progetto/locale.
- Sintassi degli script JavaScript/Python e JSON verificata. I 25 file vendorizzati ICM conservano gli hash della versione originaria, eccetto la sola aggiunta già dichiarata nel frontmatter.

## Chiusura dei rilievi dell'audit

| Rilievo | Risoluzione e confine |
|---|---|
| R1 — etichette letterali nel parser | Corretto; i blocchi di codice chiusi non producono intestazioni o metadati attivi |
| R2 — placeholder e completezza | Placeholder comuni rifiutati, INPUT_FILES verificati; sufficienza semantica affidata al controllo del chiamante, esplicitamente non certificata |
| R3 — avvii | Comandi del kit nel coordinatore, poi Agent; promemoria agli agenti. Matrice di copertura e superfici escluse in GUIDA.md |
| R4 — sviluppo | Aggiunti worker Haiku/Sonnet con scrittura e shell; foglie senza delega ulteriore. Ruolo dell'handoff attribuito al coordinatore, non al nome del modello |
| R5 — ripresa | Runtime locale con ricevute, hash, dipendenze e gate su Agent quando il run è dichiarato; controllo link .icm con root esplicita |
| R6 — contesto | Documentata la scelta tra thread caldo e fase isolata; nessuna promessa di svuotamento automatico o tetto 8.000 token |
| R7 — installazione e misure | Installer e test riproducibili; collaudo Claude Code/Windows/Headroom e benchmark di consumo restano da eseguire nell'ambiente utente |

## Limiti delle prove

Il collaudo locale verifica la configurazione di compattazione e i relativi file. La soglia effettiva osservata nella tua sessione e il consumo di token richiedono Claude Code e Headroom in esecuzione.

Il collaudo CLI usa risposte del modello pilotate e un RTK simulato. Restano da verificare la scelta spontanea dei profili, il comportamento del modello autenticato, WinGet su Windows e la compressione del traffico con Headroom. Nessuna percentuale di riduzione token/costo viene dichiarata.

Una ricevuta pass dimostra che il comando scelto è terminato con successo sugli input dichiarati; non dimostra che i test coprano tutti i requisiti. Lo stato su disco non è protetto da un agente autorizzato a modificarlo e non è una misura contro un attore ostile. Non sono previsti agenti concorrenti che modificano lo stesso run.

Il progetto sintetico della prova di ripresa viene descritto qui sotto separatamente dalla suite automatica.

## Prova su progetto sintetico separato

Un agente senza la cronologia di sviluppo del kit ha seguito la procedura per creare due fasi reali: trasformazione di nomi in maiuscolo e conteggio, con script e test locali. Ha fermato il primo processo dopo la prima fase. Un processo nuovo ha ricostruito lo stato e completato solo la seconda. Il controllo iniziale produceva 4 nomi, 3 unici.

Alterando il totale dell'output a 999, il verificatore è fallito e il precedente pass è stato invalidato; la ripresa ha riparato soltanto la seconda fase. Aggiungendo poi un nome all'input, status ha indicato la prima fase obsoleta e la seconda invalida per dipendenza; gate della seconda fase ha restituito exit 1. Il controllo dei link sotto .icm ha verificato 14 riferimenti senza errori.

Il rapporto e i risultati sono stati letti e lo stato finale è stato ricontrollato dal coordinatore. È una prova di uso della procedura e del runtime locale, non una misura delle prestazioni di Claude né un benchmark di token.
