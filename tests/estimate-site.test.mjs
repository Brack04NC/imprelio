import assert from 'node:assert/strict';
import test from 'node:test';
import { extractEstimateSite } from '../lib/estimate-site.ts';

test('legge oggetto e committente a più righe e ricava il civico dall’oggetto', () => {
  const text = `Studio tecnico
COMPUTO METRICO ESTIMATIVO

OGGETTO:
RISTRUTTURAZIONE DI FABBRICATO CONDOMINIALE VIA LIGURIA
26

COMMITTENTE:
CONDOMINIO AURORA

DATA:
21 maggio 2025
\f
Numero INDICAZIONE DEI LAVORI DIMENSIONI IMPORTI
Comune di Un altro comune`;

  assert.deepEqual(extractEstimateSite(text), {
    name: 'RISTRUTTURAZIONE DI FABBRICATO CONDOMINIALE VIA LIGURIA 26', city: '',
    address: 'VIA LIGURIA 26', clientName: 'CONDOMINIO AURORA',
  });
});

test('usa comune e indirizzo dichiarati e ignora la sede legale', () => {
  const text = `Comune di Castellammare di Stabia (NA)
Oggetto: Restauro facciate
Indirizzo del cantiere: via 24 Maggio, 12/A
Committente: Impresa Test S.r.l.
Sede legale: via Milano 123, Roma
Nome Quantità Costo unitario Totale parziale`;

  assert.deepEqual(extractEstimateSite(text), {
    name: 'Restauro facciate', city: 'Castellammare di Stabia', address: 'via 24 Maggio, 12/A', clientName: 'Impresa Test S.r.l.',
  });
});

test('una tabella senza dati di testata lascia i campi vuoti', () => {
  const text = `Dettagli preventivo
Preventivi #: IT-100
Nome Quantità Costo unitario Totale parziale
1 Allestimento di ponteggi
Committente: Nome trovatosi nella descrizione
Comune di Francavilla al Mare
Ubicazione: via Roma 7`;

  assert.deepEqual(extractEstimateSite(text), { name: '', city: '', address: '', clientName: '' });
});

test('non sceglie tra due indirizzi e non usa l’indirizzo del committente', () => {
  assert.deepEqual(extractEstimateSite(`OGGETTO: Ponteggio tra via Roma 25 e via Po 12
COMMITTENTE: Condominio sito in via Torino 34
INDIRIZZO: via Milano 14, 65100 Pescara (PE)`), {
    name: 'Ponteggio tra via Roma 25 e via Po 12', city: '', address: '', clientName: 'Condominio sito in via Torino 34',
  });
});

test('ricava il comune dal CAP e dalla provincia nell’indirizzo di cantiere', () => {
  const site = extractEstimateSite('Ubicazione: Via Verdi 8, 66023 Francavilla al Mare (CH)');
  assert.equal(site.city, 'Francavilla al Mare');
  assert.equal(site.address, 'Via Verdi 8, 66023 Francavilla al Mare (CH)');
});

test('separa le pagine e distingue il comune committente dalla sede dei lavori', () => {
  const text = 'Oggetto: Manutenzione per il Comune di Roma\nCommittente: Ente pubblico\fStudio Tecnico Aurora\nIndicazione dei lavori';
  assert.deepEqual(extractEstimateSite(text), {
    name: 'Manutenzione per il Comune di Roma', city: '', address: '', clientName: 'Ente pubblico',
  });
  assert.equal(extractEstimateSite('Oggetto: Manutenzione nel Comune di Roma').city, 'Roma');
});
