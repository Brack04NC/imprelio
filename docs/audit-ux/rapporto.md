# Audit UX e funzionale di Imprelio

**21 novembre 2026 · Bozza del gestionale**. Confronto con il codice del commit `21b8dfa`. I percorsi operativi sono stati provati con dati dimostrativi. Sul dominio pubblico sono stati controllati l’arrivo al login e il modulo anonimo. Sul progetto Supabase online è stato eseguito il confronto strutturale in sola lettura.

## Cosa vede chi lavora

| Situazione | Prima | Dopo |
| --- | --- | --- |
| Apertura della campanella su telefono | Lista bianca, con la priorità affidata soprattutto a una piccola etichetta. [Schermata](campanella-prima.png) | Testata distinta, conteggio degli avvisi in evidenza, schede con bordo, icona e testo di priorità. [Schermata](campanella-dopo.png) |
| Eliminazione di un intervento | Fascia bianca in fondo alla pagina. [Schermata](ripristina-prima.png) | Scheda ambra in rilievo con nome dell’intervento e pulsante **Ripristina**. [Schermata](ripristina-dopo.png) |
| Salvataggio da un modulo lungo | In diverse sezioni il messaggio compariva in una posizione fissa del documento, anche fuori dallo schermo. | Esito visibile nella finestra mentre si lavora su personale, cantieri, clienti, veicoli, movimenti, computi e documenti. Istruzioni e correzioni dei campi restano nel modulo. |
| Aggiornamento incompleto delle notifiche | Una sorgente in errore poteva accompagnarsi a un messaggio di elenco vuoto. | Il pannello distingue i dati parziali e permette di aggiornare. La vista completa mantiene filtri, cronologia e accesso alla scheda. |

Il rosso identifica urgenze ed errori, l’ambra una richiesta di attenzione, il blu le informazioni e il verde la conferma di un’azione. Le coppie testo/sfondo dei quattro toni hanno rapporti di contrasto compresi fra 6,76 e 7,64. Icone e diciture distinguono il significato anche in assenza di colore. Il comando di annullamento resta disponibile durante l’interazione da mouse o tastiera. Il timer di eliminazione è di tre secondi e si sospende anche quando la scheda del browser è nascosta. Il Cestino conserva gli elementi recuperabili.

## Difetti riprodotti e corretti

| Priorità | Riscontro | Riprova |
| --- | --- | --- |
| Alta | Trascinare una selezione di testo oltre il bordo del modulo poteva scartare una bozza. | Il testo del nuovo cantiere rimane nel modulo. Il clic sullo sfondo e il tasto Esc continuano a chiuderlo. |
| Alta | Descrizioni valide ma molto lunghe potevano bloccare la registrazione di più notifiche nello stesso gruppo. | In PostgreSQL locale sono stati registrati 200 avvisi con testo Unicode. La ripetizione ha mantenuto il totale e l’isolamento tra utenti. |
| Media | Una schermata lasciata aperta oltre mezzanotte poteva riportare la priorità del giorno prima. | Simulato il cambio di data a Roma con browser su New York. La scadenza è passata automaticamente a **Scade oggi · Urgente**. |
| Media | Su un telefono stretto il nome della scheda nel percorso di navigazione poteva ridursi a zero pixel. | A 320 px il ritorno al modulo è ora leggibile e azionabile. |
| Media | Su rete lenta il clic a una voce del menu lasciava visibile la vecchia pagina senza riscontro. | In una navigazione ritardata compare il nome della sezione in apertura. Verificati anche tastiera e menu mobile. |
| Media | I documenti appena importati offrivano azioni diverse dagli altri elenchi del gestionale. | Provati clic destro, Maiusc+F10 e pressione prolungata per aprire i dati, consultare l’originale o avviare l’eliminazione con conferma. |
| Bassa | Al login, un invito scaduto suggeriva di richiedere un link senza indicare a chi. | Il messaggio distingue chi ha già impostato la password da chi deve chiedere un altro invito all’amministratore. |

## Prove

- La build finale è stata aperta su 25 viste a 390, 768 e 1440 px. A queste 75 navigazioni si aggiungono sette prove di finestre modali a 320 e 1440 px. Tutte le pagine hanno risposto HTTP 200. Nelle 82 misurazioni Chromium 156 e axe 4.14.1 hanno registrato zero errori JavaScript, zero richieste fallite, zero debordamenti orizzontali della pagina e zero violazioni delle regole di accessibilità eseguite. In ogni finestra sono stati verificati l’ingresso del focus, 12 passaggi con Tab, Esc e il ritorno al comando iniziale.
- Verificati in Chromium i percorsi di clienti con più cantieri, calendario, presenze con conflitti di orario, giacenze, assegnazione e manutenzione dei mezzi, scadenze operai, importazione e riapertura degli originali, OCR di PDF e foto, preventivi con listino, fatture, ordini, DDT, statistiche, estratti conto e CSV.
- Sulle notifiche sono stati provati apertura e chiusura con tastiera, ritorno del focus alla campanella, filtri, paginazione, cronologia, apertura del veicolo dalla revisione, eliminazione con annullamento immediato e visualizzazione di un errore persistente. Raffronti visivi a 390, 768 e 1440 px.
- Build di produzione e suite applicativa superate, con 77 test eseguiti. Lo schema Supabase online coincide con la migrazione `202611180020` su tutte le 449 firme verificate.
- Il dominio pubblico `app.imprelio.it` ha risposto in HTTPS e ha indirizzato al login. Il certificato è stato verificato tramite il trust store di sistema. Il collaudo grafico anonimo del modulo ha usato il browser del laboratorio. La prova del recapito di email reali, l’uso con uno screen reader da parte di una persona e le prestazioni su volumi aziendali elevati restano da effettuare.

## Due proposte da provare con chi usa il gestionale

1. **Indicatore degli urgenti sulla campanella chiusa.** Oggi il dettaglio viene caricato all’apertura. Un conteggio leggero per azienda e utente permetterebbe di distinguere subito «c’è una scadenza urgente» da «qui trovi le notifiche». Il criterio di accettazione è un conteggio aggiornato senza scaricare la cronologia a ogni cambio pagina.
2. **Altezza automatica dei widget su telefono.** A 390 px, a parità di altezza configurata, il calendario scorre internamente mentre Magazzino e Computi lasciano spazio vuoto. Affiancare un’altezza automatica all’opzione manuale permetterebbe di provare una dashboard più compatta con la stessa disposizione scelta dall’utente.
