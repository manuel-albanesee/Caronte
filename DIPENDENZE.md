# Dipendenze all’avvio di Claude Code

Dopo aver installato il kit nel progetto, avvia Claude Code come al solito, anche tramite Headroom. L’hook `SessionStart` esegue il controllo sulle nuove sessioni e alla ripresa. Recupera le release stabili dai repository ufficiali di ECC e RTK. Una SessionStart riuscita può mostrare il cambio di versione all’utente. Lo stato dell’ultima verifica è in `claude-routing-deps/status.json` nei metadati Git del worktree.

| Componente | Come si aggiorna |
| --- | --- |
| ECC | Il kit include sette profili adattati da ECC 2.2.3, i sorgenti di riferimento e la licenza MIT. All’avvio recupera le nuove revisioni compatibili degli stessi riferimenti. Verifica commit, hash dei blob e formato, poi attiva il gruppo completo. Le regole, i modelli e i tool del kit restano definiti nei profili locali. |
| RTK | L’installer lo rileva e lo installa se manca. All’avvio, se c’è una release compatibile più recente, tenta l’aggiornamento tramite WinGet, Homebrew o Cargo dove l’installazione è riconosciuta. Una copia installata manualmente resta utilizzabile. |
| Claude Code | L’installazione nativa ha il proprio canale di aggiornamento. Le installazioni tramite gestore pacchetti seguono il relativo gestore. |
| Node e Git | Prerequisiti dell’ambiente. Node 22 o successivo interpreta il kit. Git deve essere disponibile e le deleghe di scrittura partono dalla root di un worktree. |
| ICM | I template e la metodologia sono inclusi nel kit, con licenza e riferimenti propri. Il loro aggiornamento segue le versioni del kit perché deve restare compatibile con manifest e ricevute già creati. |
| Headroom e Caveman | Configurazione e aggiornamento rimangono indipendenti. |

Il controllo degli aggiornamenti usa HTTPS verso GitHub. In assenza di rete, con API limitata, su cambio di major o se una release ECC rimuove o cambia in modo incompatibile un profilo, rimane in uso la copia valida precedente. Il risultato è registrato nello stato locale. Gli aggiornamenti di RTK dipendono anche dalla disponibilità del pacchetto presso il gestore. Nessuna credenziale GitHub è necessaria per consultare le release pubbliche.

I riferimenti ECC aggiornati si salvano nella cache Git e sono indicati ai profili soltanto quando partono. L’installer configura anche il [plugin ECC completo](GUIDA.md#ecc-completo-e-caronte), che include il catalogo, gli agenti nativi e gli hook. La provenienza dei riferimenti inclusi è in `.claude/routing/ecc/manifest.json`. Per tornare a quei riferimenti, rimuovi il puntatore `ecc-current.json` dalla cache Git. Il successivo avvio tenterà di nuovo l’aggiornamento se disponibile.

[Rilasci ECC](https://github.com/affaan-m/ECC/releases) · [Rilasci RTK](https://github.com/rtk-ai/rtk/releases) · [Aggiornamenti Claude Code](https://code.claude.com/docs/en/setup#auto-updates)
