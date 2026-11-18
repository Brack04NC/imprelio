# Imprelio

Imprelio è il gestionale operativo per il coordinamento dei cantieri e degli interventi di ponteggio. Il primo rilascio include ricerca e filtri sui cantieri, agenda, interventi per zona, anagrafiche minime dei clienti e gestione degli accessi per azienda.

## Avvio

Con Node.js 22 o superiore:

```sh
npm ci
npm run dev
```

Senza configurazione Supabase, l’app si avvia in modalità dimostrativa. Le modifiche alla demo restano nel browser. Il comando `npm run build && npm start` avvia la build di produzione.

## Dati condivisi e accessi

1. Avvia Supabase locale dalla radice del progetto con la CLI (`supabase start`) oppure usa un progetto Supabase dedicato. Il setup locale applica le migrazioni in automatico. Per Supabase Cloud, accedi alla CLI con il tuo account, esegui `supabase link --project-ref <project-ref>` e verifica che `supabase db push --dry-run` elenchi la migrazione Cantieri nel progetto previsto. Applica poi con `supabase db push`.
2. Copia `.env.example` in `.env.local`. Compila URL e chiave pubblicabile Supabase e aggiungi la chiave segreta lato server per gli inviti. In locale è possibile usare la chiave `service_role` della CLI se non è disponibile una chiave segreta. Su Vercel l’app usa automaticamente il dominio di produzione. Imposta `IMPRELIO_SITE_URL` soltanto per un dominio personalizzato o un ambiente non Vercel.
3. In Supabase Auth imposta **Site URL** allo stesso indirizzo di `IMPRELIO_SITE_URL` e aggiungi `<URL dell’app>/auth/conferma` ai redirect ammessi. Per il collaudo con l’app sul proprio computer, usa `http://localhost:3000`. Disattiva le iscrizioni pubbliche e carica i [template per inviti e link di accesso](supabase/templates/). Il servizio email predefinito di Supabase Cloud consegna solo agli indirizzi del team del progetto. Configura SMTP prima di invitare utenti esterni al team.
4. Crea il primo utente confermato da **Authentication → Users**. Nel SQL Editor esegui [bootstrap-admin.sql](supabase/bootstrap-admin.sql) dopo aver impostato il suo indirizzo e il nome dell’azienda. Ripetere il comando con lo stesso amministratore è sicuro. Se esiste un’azienda omonima con altri accessi, il comando si ferma.

L’amministratore richiede il link di accesso dalla schermata di login. In locale le email si leggono su Mailpit, sulla porta 54324. Da **Gestione accessi**, l’amministratore invita i coordinatori e può disattivare o riattivare i relativi profili aziendali.

Le letture sono protette da policy RLS. Le scritture passano da una funzione PostgreSQL che verifica il ruolo e l’azienda del chiamante. Le chiavi esterne composte impediscono di collegare cantieri, clienti e interventi tra aziende diverse.

## Verifica

```sh
npm run typecheck
npm test
npm run build
```

I test verificano ricerca, paginazione, calendario e interventi per zona. Eseguono inoltre la migrazione in PostgreSQL tramite PGlite per verificare permessi, isolamento, accettazione di un invito con email verificata e disattivazione dei coordinatori.

I prossimi moduli sono Clienti, Commesse, Preventivi, Magazzino, Dipendenti e Squadre, e infine la gestione economica delle commesse con fatture, DDT, costi, ricavi, scadenze, margini e statistiche.
