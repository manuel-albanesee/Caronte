---
name: implementa
description: Prepara il brief dalla conversazione e delega una implementazione con verifica.
disable-model-invocation: true
---

Esegui nel contesto del coordinatore. Interpreta la richiesta qui sotto usando i fatti pertinenti della conversazione. Prepara tu il brief a sei campi indicato in CLAUDE.md, controllando prerequisiti, regole applicabili e tool del destinatario. In INPUT elenca i file necessari con INPUT_FILES (array JSON di percorsi relativi al progetto). Se è una fase ICM, aggiungi ICM_RUN e ICM_STAGE come righe separate. In VINCOLI aggiungi ROUTING: <classe> di ../../routing/policy.json; il destinatario può essere qualsiasi agent installato il cui modello resta entro il tetto della classe (elenco: node .claude/routing/policy.cjs). Aggiungi ESCALATION solo per superare il tetto o il modello dell'agent, citando il tentativo precedente e la nuova evidenza. Conserva i letterali nei blocchi di codice. Non chiedere all'utente di compilare il brief.

Scegli lo specialista installato (kit o plugin ECC) se il ruolo corrisponde al lavoro. Per modifiche meccaniche usa implementazione-sonnet con effort low (ROUTING: meccanica); implementazione-haiku solo per trasformazioni deterministiche su al massimo 2 file con un test mirato. Negli altri casi implementazione-sonnet o ecc-tdd-guide (ROUTING: sviluppo o regressione). In una fase ICM usa il profile della fase. Leggi ../../routing/CONSEGNA.md, salva la baseline e prepara il piano di test mirati e delega tramite Agent. Passa REVIEW_ID e il suo comando. Dopo il ritorno genera e leggi personalmente il diff Git. Controlla la ricevuta corrente dei test mirati. Soltanto l’orchestratore può eseguire la suite intera e può farlo dopo questa verifica.

Richiesta:
$ARGUMENTS
