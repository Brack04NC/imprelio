# Imprelio

Imprelio è il gestionale operativo per i cantieri e gli interventi di ponteggio. Ogni cliente può avere più cantieri. Dalla scheda cantiere si accede ai movimenti di magazzino, al personale, ai documenti e ai computi metrici collegati.

## Avvio

Con Node.js 22.13 o superiore:

```sh
npm ci
npm run dev
```

Senza configurazione Supabase, l’app si avvia in modalità dimostrativa. Le modifiche alla demo restano nel browser. Il comando `npm run build && npm start` avvia la build di produzione.

## Dati condivisi e accessi

1. Avvia Supabase locale dalla radice del progetto con la CLI (`supabase start`) oppure usa un progetto Supabase dedicato. Per un progetto Cloud gestito con la CLI, esegui `supabase link --project-ref <project-ref>`, controlla `supabase migration list --linked` e l’anteprima `supabase db push --dry-run`. Per aggiornare, applica le migrazioni in ordine prima della distribuzione dell’app. Se hai installato da SQL Editor, usa la [verifica dello schema](#verifica-del-database-supabase) per identificare gli oggetti già presenti prima di applicare file SQL.
2. Copia `.env.example` in `.env.local`. Compila URL e chiave pubblicabile Supabase e aggiungi la chiave segreta lato server per gli inviti. In locale è possibile usare la chiave `service_role` della CLI se non è disponibile una chiave segreta. Su Vercel l’app usa automaticamente il dominio di produzione. Imposta `IMPRELIO_SITE_URL` soltanto per un dominio personalizzato o un ambiente non Vercel.
3. In Supabase Auth imposta **Site URL** allo stesso indirizzo di `IMPRELIO_SITE_URL` e aggiungi `<URL dell’app>/auth/conferma` ai redirect ammessi. Per il collaudo con l’app sul proprio computer, usa `http://localhost:3000`. Disattiva le iscrizioni pubbliche e carica i [template per inviti e link di accesso](supabase/templates/). Il servizio email predefinito di Supabase Cloud consegna solo agli indirizzi del team del progetto. Configura SMTP prima di invitare utenti esterni al team.
4. Crea il primo utente confermato con una password da **Authentication → Users**. Nel SQL Editor esegui [bootstrap-admin.sql](supabase/bootstrap-admin.sql) dopo aver impostato il suo indirizzo e il nome dell’azienda. Ripetere il comando con lo stesso amministratore è sicuro. Se esiste un’azienda omonima con altri accessi, il comando si ferma.

L’amministratore accede con email e password. Al primo invito il coordinatore sceglie e conferma la password, poi può rientrare dal login aziendale. In locale le email di invito si leggono su Mailpit, sulla porta 54324. Da **Gestione accessi**, l’amministratore invita i coordinatori e può disattivare o riattivare i relativi profili aziendali.

Le policy RLS limitano le letture all’azienda. Le scritture passano da funzioni PostgreSQL che verificano l’accesso. Le chiavi esterne composte impediscono di collegare schede di aziende diverse. I nuovi cantieri richiedono un cliente. Puoi assegnare un cliente ai cantieri precedenti che ne erano privi.

Il magazzino calcola le giacenze dai carichi e dagli scarichi registrati. Fatture, ordini e DDT sono registri interni. Il computo calcola le quantità a partire dalle misure e gli importi dai prezzi unitari.

In **Magazzino → Assegnazioni veicoli** puoi assegnare un veicolo a una squadra interna o esterna, a un operaio oppure a un dipendente. La [migrazione 009](supabase/migrations/202611180009_manutenzione_veicoli.sql) abilita anche l’assegnazione diretta a un cantiere e la manutenzione programmata. Salva insieme più periodi per lo stesso assegnatario. Le date di inizio e fine sono incluse e ogni veicolo può avere una sola assegnazione per giorno.

Nella scheda di un articolo di categoria **Veicoli**, attiva **Manutenzione (meccanico)** e imposta le date. Il mezzo risulta **Fuori uso** nei giorni del fermo e torna allo stato impostato sulla scheda il giorno successivo. Se il fermo si sovrappone a un’assegnazione già registrata, riprogramma l’assegnazione prima di salvare. Da **Assegnazioni veicoli** puoi seguire i periodi di manutenzione. Per le attività di cantiere usa **Agenda → Calendario** e aggiungi un intervento nella data o fascia oraria prevista.

Da **Magazzino → Veicoli** puoi creare un mezzo con targa, matricola, categoria, posizione e note. Apri **Scheda veicolo** per consultare scadenze, periodi di assegnazione e ultima posizione registrata. La [migrazione 016](supabase/migrations/202611180016_registro_veicoli.sql) abilita il registro di utilizzo e gli interventi ordinari e straordinari. Registra gli utilizzi effettivi con operatore, periodo e cantiere o luogo. Per riservare un periodo di fermo, usa **Manutenzione (meccanico)** nell’anagrafica del mezzo.

La [migrazione 010](supabase/migrations/202611180010_presenze.sql) abilita **Presenze** per dipendenti e operai. Dal calendario o dall’anagrafica seleziona un giorno e registra una fascia di lavoro in cantiere, magazzino o ufficio. Puoi registrare più fasce nella stessa giornata e segnare assenze per l’intera giornata o per un orario. **Statistiche** riepiloga le ore registrate per persona e luogo, con i filtri del periodo e del cantiere.

La [migrazione 011](supabase/migrations/202611180011_scadenze_operai.sql) abilita **Personale e squadre → Operai → Scadenze**. Registra visite mediche, certificazioni o altre scadenze con la data di completamento, la scadenza o entrambe. Le voci in scadenza entro 30 giorni e quelle già scadute sono evidenziate. Puoi archiviare e ripristinare le registrazioni. Lo storico degli operai archiviati è consultabile in sola lettura.

Da **Notifiche** segui gli interventi dell’Agenda entro 7 giorni e le scadenze di fatture, ordini e operai entro 30 giorni, con i ritardi ancora aperti. Il centro mostra anche computi in bozza o in revisione, computi approvati di recente e preventivi PDF appena salvati. La [migrazione 012](supabase/migrations/202611180012_notifiche.sql) aggiunge i PDF in attesa di preventivo. Imprelio confronta il nome del file e il cantiere con i preventivi salvati e cestinati. Gli avvisi si aggiornano all’apertura della sezione e premendo **Aggiorna**.

In **Computi metrici → Preventivo da PDF** puoi salvare un listino con codice o parole nel titolo, unità di misura, tipo di prezzo e durata inclusa. Il PDF viene letto nel browser. Il lettore riconosce i due formati dei computi campione con testo selezionabile, fino a 25 MB, 100 pagine e 350 voci. Puoi correggere le voci ambigue o escluderle esplicitamente, poi salvare il preventivo per il cantiere e stamparlo in PDF. Il salvataggio conserva le voci selezionate e i prezzi applicati.

Da **Preventivi da PDF**, seleziona un cantiere e premi **Salva PDF originale** per aggiungere il documento all’**Archivio computi PDF**. Puoi salvare il file mentre stai ancora rivedendo il preventivo. La migrazione 006 crea il bucket privato e abilita l’accesso ai PDF per i membri dell’azienda.

In **Archivio documenti**, importa PDF o foto JPG, PNG e WebP fino a 25 MB. Imprelio estrae il testo nel browser, con riconoscimento ottico per foto e scansioni. Verifica categoria, numero, data, intestazioni e totale, poi salva la riga e il file originale. Ogni riga permette di aprire l’originale e consultare il testo acquisito. Le importazioni archiviate da **Preventivi da PDF** compaiono nello stesso elenco. Per Supabase applica la [migrazione 017](supabase/migrations/202611180017_archivio_documenti.sql), che crea un bucket privato e abilita il salvataggio dei dati estratti per azienda. Nella demo, file e dati restano nel browser.

**Statistiche** riepiloga l’operatività e gli importi delle fatture per periodo e cantiere. **Bilanci e conti** comprende il bilancio gestionale dalle fatture e il registro dei conti, abilitato dalla migrazione 007. Per ottenere un estratto conto, inserisci il saldo iniziale del conto e registra le entrate e le uscite. Il riepilogo, il resoconto fatture e l’estratto conto si possono scaricare in CSV.

La campanella vicino all’account mostra gli avvisi attivi e apre il **Centro notifiche**. In **Cronologia** trovi gli avvisi rilevati all’apertura del pannello o del Centro e gli eventi già ricostruibili dalle schede. La [migrazione 015](supabase/migrations/202611180015_cronologia_notifiche.sql) salva la cronologia per utente e azienda. Le scadenze di assicurazione, bollo, revisione e tagliando compaiono tra gli avvisi a partire da 30 giorni prima della data indicata nella scheda del veicolo.

Con la migrazione 008, puoi eliminare un intervento dalla sua scheda in **Agenda** o **Calendario**, e un preventivo dalla lista **Preventivi salvati**. Dopo la conferma, Imprelio conserva la scheda nel cestino e mostra **Ripristina** per circa tre secondi. Il timer si ferma mentre il cursore o il focus sono sulla notifica.

Applica le migrazioni [013](supabase/migrations/202611180013_cestino_schede.sql) e [014](supabase/migrations/202611180014_cestino_controlli.sql) per usare **Elimina** su schede attive e archiviate di magazzino, personale, documenti, computi e scadenze operai, oltre a clienti, cantieri e PDF originali. Dal menu **Cestino** puoi ripristinare le schede anche dopo la chiusura dell’avviso. La [migrazione 018](supabase/migrations/202611180018_cestino_rls.sql) abilita RLS nella tabella privata del cestino. La [migrazione 019](supabase/migrations/202611180019_cestino_documenti.sql) estende eliminazione e ripristino ai nuovi documenti importati, conservando lo stesso file originale. Un cantiere eliminato conserva i collegamenti storici e i relativi interventi tornano disponibili quando lo ripristini. Prima di eliminare un cliente, riassegna o elimina i cantieri collegati. Le eliminazioni di magazzino rispettano i controlli sulle giacenze e sui movimenti attivi.

## Verifica del database Supabase

Apri il progetto corretto in Supabase, entra in **SQL Editor → New query** ed esegui tutto il contenuto di [verifica-schema.sql](supabase/verifica-schema.sql). La query legge i cataloghi PostgreSQL e le impostazioni dei bucket. Confronta la struttura effettiva con le migrazioni del repository anche per le installazioni fatte a mano dal SQL Editor.

Puoi eseguire lo stesso controllo dalla radice del repository con il client `psql`. Copia host, porta e utente da **Connect → Session pooler**. La password del database viene richiesta al terminale.

```sh
PGSSLMODE=require psql -X -W -h '<host Session pooler>' -p 5432 \
  -U 'postgres.<project-ref>' -d postgres -v ON_ERROR_STOP=1 \
  -f supabase/verifica-schema.sql
```

**OK** con `differenze = []` indica che gli oggetti controllati corrispondono al repository. **SCHEMA_DA_VERIFICARE** elenca gli oggetti mancanti, differenti o imprevisti. Verifica le differenze prima di applicare una migrazione. Il confronto copre colonne, vincoli, indici, funzioni, trigger, permessi dei ruoli applicativi, policy e configurazione dei bucket. I contenuti dei file e le righe aziendali richiedono un controllo distinto.

## Verifica

```sh
npm run typecheck
npm test
npm run build
```

Il [resoconto del collaudo del 21 novembre 2026](docs/verifica-gestionale.md) raccoglie la copertura dei flussi, i problemi riprodotti e la verifica online.

I test verificano ricerca, paginazione, calendario e interventi per zona. Applicano le migrazioni su PostgreSQL tramite PGlite e controllano permessi, isolamento tra aziende, inviti, collegamenti cliente-cantieri e coerenza delle giacenze.
