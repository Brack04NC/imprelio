# Verifica di Imprelio del 21 novembre 2026

## Ambienti e copertura

Le prove di scrittura hanno usato la demo e un ambiente Supabase locale con utenti, aziende, documenti e veicoli di prova. Sul progetto Supabase Cloud di Imprelio a Francoforte sono stati letti i cataloghi, le impostazioni dei bucket e i conteggi aggregati di coerenza dei PDF. Il sito pubblico risponde su HTTPS e indirizza un visitatore senza sessione al login.

| Area | Verifiche |
| --- | --- |
| Accessi, clienti e cantieri | Login, ruoli, inviti, gestione del cliente e collegamento di più cantieri alla stessa anagrafica |
| Dashboard e agenda | Widget e preferenze, selezione dei cantieri, viste giorno/settimana/mese, creazione e modifica degli interventi, conferma eliminazione e ripristino |
| Magazzino e personale | Carichi/scarichi decimali e scorta minima, vincolo sulla giacenza, assegnazioni a periodi, manutenzione, registro del mezzo, personale interno e squadre esterne |
| Presenze, scadenze e notifiche | Fasce orarie e luoghi, conflitti, scadenze operai, campanella, collegamenti alle schede e persistenza dello storico |
| Documenti e preventivi | Fatture, ordini, DDT, computi, listino, importazione PDF/foto, lettura OCR, archiviazione e riapertura degli originali |
| Statistiche e bilanci | Filtri temporali e per cantiere, grafici, ore, fatture, movimenti dei conti, saldi dopo ricarica e CSV |

Il gestionale dispone di anagrafiche clienti e cantieri. Un modulo autonomo **Commesse** e una pagina generale **Impostazioni** non figurano nell’inventario delle funzioni presenti.

La revisione grafica ha confrontato navigazione, gerarchia dei titoli, azioni principali, leggibilità delle tabelle e stati dei moduli su desktop e mobile. I test da tastiera hanno verificato apertura, contenimento del focus e ritorno al comando iniziale in sette finestre, tra cui campanella, menu mobile ed editor del calendario.

## Riscontri e correzioni

- Nel calendario mensile a 320 px i controlli del giorno e dell’aggiunta intervento scendevano fino a 15 px di larghezza. Ora possono andare su due righe e mantengono almeno 24 px. La verifica copre anche il formato da 390 px.
- Nel magazzino il filtro delle schede archiviate si trasferiva da Movimenti ad Articoli, nascondendo giacenze attive. Il cambio di sezione ora riapre le schede attive.
- Dopo una modifica in Agenda, la demo poteva mostrare nuovamente gli interventi di un cantiere nel cestino. La vista aggiornata riapplica il filtro anche prima del ricaricamento.
- Un nuovo invitato poteva uscire senza disporre di una password per il secondo accesso. Il percorso di invito ora include la scelta e conferma della password.
- L’Archivio documenti controlla la disponibilità del database prima di avviare l’importazione o l’OCR. Il cestino gestisce anche i documenti caricati nell’archivio.
- Aprendo la dashboard a 1440 px il menu avviava richieste per altre otto sezioni. Allo stesso viewport e senza interazioni, la build corretta ne avvia zero. Il gestionale dichiara inoltre la preferenza per l’esclusione dall’indicizzazione.

## Stato del database online

Il confronto in sola lettura del 21 novembre sul progetto Imprelio ha restituito **SCHEMA_DA_VERIFICARE** rispetto alla migrazione **202611180019**. Su 446 firme confrontate, 44 differiscono o sono assenti. Le differenze riguardano l’archivio delle importazioni e il suo collegamento al cestino. Un confronto separato con le migrazioni dalla 001 alla 016 e l’impostazione RLS della 018 ha restituito **OK**. Il registro della CLI è assente, perciò l’elenco delle migrazioni della CLI da solo sarebbe insufficiente.

Per portare questa installazione al livello del repository, i file da eseguire in ordine sono [017](../supabase/migrations/202611180017_archivio_documenti.sql), [018](../supabase/migrations/202611180018_cestino_rls.sql) e [019](../supabase/migrations/202611180019_cestino_documenti.sql). La 018 può essere ripetuta sul progetto in cui RLS è già attiva. Dopo l’aggiornamento eseguire di nuovo [verifica-schema.sql](../supabase/verifica-schema.sql).

## Integrità e ripetibilità

- Un’installazione pulita con `npm ci` ha utilizzato il lockfile del repository. `git fsck --full --no-dangling` ha verificato gli oggetti Git. Controllati anche i collegamenti locali della documentazione, i formati delle immagini e la decompressione dei due modelli OCR. `npm audit --omit=dev` ha restituito zero segnalazioni sulle dipendenze di esecuzione alla data del controllo.
- Su un database PostgreSQL 17.12 vuoto sono state applicate in ordine le 19 migrazioni. Il confronto ha restituito **OK** su tutte le 446 firme. Tutte le 20 RPC richiamate per nome nel codice applicativo sono presenti nel database locale. I test di integrazione applicano le migrazioni a PostgreSQL e verificano vincoli, accessi tra aziende, scritture e ripristini.
- Per i PDF dei computi già registrati online, il confronto tra archivio e metadati Storage ha restituito zero file finalizzati mancanti, zero dimensioni discordanti, zero oggetti senza registrazione e zero caricamenti incompleti. L’identità dei byte dei file è stata provata con originali sintetici su Supabase locale.
- Il controllo delle migrazioni è ripetibile dalla dashboard Supabase o da terminale. Le istruzioni e il significato dell’esito sono nella [procedura del README](../README.md#verifica-del-database-supabase).

La suite ha superato 73 test, senza salti. La verifica con Chromium 156 e axe 4.14.1 ha coperto 25 pagine o viste a 320 e 1440 px e sette stati di interazione. Nelle 57 verifiche non sono emersi errori JavaScript, risposte HTTP di errore o violazioni rilevate da axe. Il collaudo SMTP ha come destinazione un servizio locale. La consegna delle email da un dominio di produzione e le prestazioni su grandi volumi di dati aziendali restano fuori dalle prove.
