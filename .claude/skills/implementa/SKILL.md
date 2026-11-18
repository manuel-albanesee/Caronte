---
name: implementa
description: Prepara il brief dalla conversazione e delega una implementazione con verifica.
disable-model-invocation: true
---

Esegui nel contesto del coordinatore. Interpreta la richiesta qui sotto usando i fatti pertinenti della conversazione. Prepara tu il brief a sei campi indicato in CLAUDE.md, controllando prerequisiti, regole applicabili e tool del destinatario. In INPUT elenca i file necessari con INPUT_FILES (array JSON di percorsi relativi al progetto). Se è una fase ICM, aggiungi ICM_RUN e ICM_STAGE come righe separate. Conserva i letterali nei blocchi di codice. Non chiedere all'utente di compilare il brief.

Scegli il profilo specialista ECC indicato in CLAUDE.md se il ruolo corrisponde al lavoro. Usa Haiku per modifiche meccaniche circoscritte e Sonnet per sviluppo generale. Leggi ../../routing/CONSEGNA.md, salva la baseline e prepara il piano di test mirati e delega tramite Agent. Passa REVIEW_ID e il suo comando. Dopo il ritorno genera e leggi personalmente il diff Git. Controlla la ricevuta corrente dei test mirati. Soltanto l’orchestratore può eseguire la suite intera e può farlo dopo questa verifica.

Richiesta:
$ARGUMENTS
