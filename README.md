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

1. Avvia Supabase locale dalla radice del progetto con la CLI (`supabase start`) oppure usa un progetto Supabase dedicato. Il setup locale applica le migrazioni in automatico. Per Supabase Cloud, esegui `supabase link --project-ref <project-ref>` e controlla le migrazioni in attesa con `supabase db push --dry-run`. Applica poi con `supabase db push`. Se hai applicato Cantieri dal SQL Editor, esegui nello stesso editor, in ordine, le migrazioni ancora mancanti tra [Operatività](supabase/migrations/202611180002_operativita.sql), [Clienti](supabase/migrations/202611180003_clienti.sql), [Preventivi da computo](supabase/migrations/202611180004_preventivi_da_computo.sql) e [Assegnazioni veicoli](supabase/migrations/202611180005_assegnazioni_veicoli.sql). Applica le migrazioni prima di aggiornare l’app su Vercel.
2. Copia `.env.example` in `.env.local`. Compila URL e chiave pubblicabile Supabase e aggiungi la chiave segreta lato server per gli inviti. In locale è possibile usare la chiave `service_role` della CLI se non è disponibile una chiave segreta. Su Vercel l’app usa automaticamente il dominio di produzione. Imposta `IMPRELIO_SITE_URL` soltanto per un dominio personalizzato o un ambiente non Vercel.
3. In Supabase Auth imposta **Site URL** allo stesso indirizzo di `IMPRELIO_SITE_URL` e aggiungi `<URL dell’app>/auth/conferma` ai redirect ammessi. Per il collaudo con l’app sul proprio computer, usa `http://localhost:3000`. Disattiva le iscrizioni pubbliche e carica i [template per inviti e link di accesso](supabase/templates/). Il servizio email predefinito di Supabase Cloud consegna solo agli indirizzi del team del progetto. Configura SMTP prima di invitare utenti esterni al team.
4. Crea il primo utente confermato da **Authentication → Users**. Nel SQL Editor esegui [bootstrap-admin.sql](supabase/bootstrap-admin.sql) dopo aver impostato il suo indirizzo e il nome dell’azienda. Ripetere il comando con lo stesso amministratore è sicuro. Se esiste un’azienda omonima con altri accessi, il comando si ferma.

L’amministratore richiede il link di accesso dalla schermata di login. In locale le email si leggono su Mailpit, sulla porta 54324. Da **Gestione accessi**, l’amministratore invita i coordinatori e può disattivare o riattivare i relativi profili aziendali.

Le policy RLS limitano le letture all’azienda. Le scritture passano da funzioni PostgreSQL che verificano l’accesso. Le chiavi esterne composte impediscono di collegare schede di aziende diverse. I nuovi cantieri richiedono un cliente. Puoi assegnare un cliente ai cantieri precedenti che ne erano privi.

Il magazzino calcola le giacenze dai carichi e dagli scarichi registrati. Fatture, ordini e DDT sono registri interni. Il computo calcola le quantità a partire dalle misure e gli importi dai prezzi unitari.

In **Magazzino → Assegnazioni veicoli** puoi assegnare un veicolo a una squadra interna o esterna, a un operaio oppure a un dipendente. Salva insieme più periodi per lo stesso assegnatario. Le date di inizio e fine sono incluse e ogni veicolo può avere una sola assegnazione per giorno.

In **Computi metrici → Preventivo da PDF** puoi salvare un listino con codice o parole nel titolo, unità di misura, tipo di prezzo e durata inclusa. Il PDF viene letto nel browser. Il lettore riconosce i due formati dei computi campione con testo selezionabile, fino a 25 MB, 100 pagine e 350 voci. Puoi correggere le voci ambigue o escluderle esplicitamente, poi salvare il preventivo per il cantiere e stamparlo in PDF. Il salvataggio conserva le voci selezionate e i prezzi applicati.

## Verifica

```sh
npm run typecheck
npm test
npm run build
```

I test verificano ricerca, paginazione, calendario e interventi per zona. Applicano le migrazioni su PostgreSQL tramite PGlite e controllano permessi, isolamento tra aziende, inviti, collegamenti cliente-cantieri e coerenza delle giacenze.
