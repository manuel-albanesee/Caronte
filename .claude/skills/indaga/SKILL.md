---
name: indaga
description: Prepara il brief dalla conversazione e delega una ricerca in sola lettura.
disable-model-invocation: true
---

Esegui nel contesto del coordinatore. Interpreta la richiesta qui sotto usando i fatti pertinenti della conversazione. Prepara tu il brief a sei campi indicato in CLAUDE.md, controllando prerequisiti, regole applicabili e tool del destinatario. In INPUT elenca i file necessari con INPUT_FILES (array JSON di percorsi relativi al progetto). Se è una fase ICM, aggiungi ICM_RUN e ICM_STAGE come righe separate. In VINCOLI aggiungi ROUTING: <classe> di ../../routing/policy.json; il destinatario può essere qualsiasi agent installato il cui modello resta entro il tetto della classe (elenco: node .claude/routing/policy.cjs). Aggiungi ESCALATION solo per superare il tetto o il modello dell'agent, citando il tentativo precedente e la nuova evidenza. Conserva i letterali nei blocchi di codice. Non chiedere all'utente di compilare il brief.

Avvia `ricerca-haiku` tramite Agent con quel prompt. Per implementa, usa invece `implementazione-haiku` solo se la modifica è meccanica, circoscritta, con test già definito e senza decisioni aperte. Dopo il risultato verifica l'evidenza e registra l'handoff se serve. Se manca un fatto essenziale non reperibile, restituisci BLOCCATO e il dato esatto.

Richiesta:
$ARGUMENTS
