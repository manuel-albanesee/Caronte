---
name: sviluppo-icm
description: Applica ICM a fasi dipendenti verificabili, riprese tra sessioni o processi ricorrenti.
---

1. Riusa piano, catalogo e contratto pertinenti. Per un intervento singolo basta .icm/<task>/CONTEXT.md con obiettivo, decisioni, riferimenti, esito e prossimo passo. Non creare una pipeline per un fix semplice.
2. Per fasi ricorrenti crea solo le fasi reali, contratti con input esatti, output del run e verifiche. Per architettura o ristrutturazione leggi ../icm-architect/SKILL.md e i riferimenti pertinenti. Mantieni i fatti canonici nei loro file. Conserva il routing del kit se riorganizzi CLAUDE.md.
3. Per una ripresa verificabile leggi ../../routing/ICM.md e crea il manifest del run. Elenca anche codice e script di test che determinano l'esito tra gli input. Il coordinatore registra i risultati dei worker in sola lettura. Per ogni fase indica nel manifest profile e class: il profilo più economico adatto per le fasi meccaniche o di ricerca, decisione-opus solo per la fase di scelta.
4. Da root esegui node .claude/routing/icm.cjs status <manifest>. Riprendi la prima fase non valida; l’orchestratore usa gate prima e check dopo la revisione del diff. Un check fallito ferma le fasi dipendenti. Non scrivere ricevute a mano. Usa controlli deterministici significativi, non comandi che restituiscono sempre successo. Registra revisioni di dipendenze esterne in un input locale.
5. Se deleghi, prepara il brief a sei campi con INPUT_FILES, ICM_RUN, ICM_STAGE, fatti della chat e perimetro. Scegli un worker con i tool necessari. Se scrive, prepara il piano e REVIEW_ID seguendo ../../routing/CONSEGNA.md. Con un run aperto ogni delega di scrittura dichiara la fase oppure ICM_SKIP: <motivo>. Non trasferire tutta la cronologia.
6. Mantieni il thread se il contesto condiviso e la cache lo rendono conveniente. Per fasi autonome verbose usa un contesto isolato. Salvare un handoff non svuota il contesto corrente. Verifica la ripresa a freddo leggendo solo catalogo, contratto, manifest e stato.
