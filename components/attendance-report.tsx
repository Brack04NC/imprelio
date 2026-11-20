'use client';

import { Download } from 'lucide-react';
import { useId } from 'react';
import { attendanceKindLabels } from '@/lib/attendance';
import type { AttendanceReport as Report } from '@/lib/attendance-report';
import type { ReportFilters } from '@/lib/business-reports';
import { downloadCsv } from '@/lib/csv-download';
import styles from './attendance-report.module.css';

const workplaceBarLimit = 6;

export function formatWorkDuration(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

function personKind(kind: Report['people'][number]['kind']) {
  return kind === 'employee' ? 'Dipendente' : kind === 'worker' ? 'Operaio' : '';
}

function WorkplaceHours({ places }: { places: Report['places'] }) {
  const heading = useId();
  const top = [...places].sort((a, b) => b.workMinutes - a.workMinutes).slice(0, workplaceBarLimit);
  const maximum = top[0]?.workMinutes ?? 0;
  if (maximum <= 0) return null;
  return <section className={styles.hoursChart} aria-labelledby={heading}>
    <h3 id={heading}>Ore registrate per luogo</h3>
    {places.length > workplaceBarLimit && <p>I primi {workplaceBarLimit} luoghi per ore lavorate.</p>}
    <ol role="list" className={styles.hoursRows}>
      {top.map(place => <li key={place.key}>
        <div className={styles.hoursRowLabel}>
          <span>{place.label}</span><strong>{formatWorkDuration(place.workMinutes)}</strong>
        </div>
        <div className={styles.hoursTrack} aria-hidden="true">
          <span style={{ inlineSize: `${place.workMinutes / maximum * 100}%` }}/>
        </div>
      </li>)}
    </ol>
  </section>;
}

export function AttendanceReport({ report, filters, siteLabel, pending }: {
  report: Report; filters: ReportFilters; siteLabel: string; pending: boolean;
}) {
  const heading = useId();
  const { summary, people, places, absences, showAbsences } = report;
  const facts = [
    { label: 'Ore di lavoro registrate', value: formatWorkDuration(summary.workMinutes) },
    { label: 'Giornate di lavoro', value: summary.workDays },
    ...(showAbsences ? [
      { label: 'Assenze a giornata', value: summary.fullDayAbsences },
      { label: 'Assenze a ore', value: summary.timedAbsences },
      { label: 'Ore di assenza registrate', value: formatWorkDuration(summary.absenceMinutes) },
    ] : []),
  ];

  function exportAttendance() {
    downloadCsv(`imprelio-presenze-${filters.from}.csv`, [
      ['Dal', filters.from, 'Al', filters.to, 'Cantiere', siteLabel || 'Tutti'],
      ['Persona', 'Tipo', 'Archiviata', 'Giornate di lavoro', 'Minuti lavorati registrati',
        ...(showAbsences ? ['Assenze a giornata', 'Assenze a ore', 'Minuti di assenza registrati'] : [])],
      ...people.map(person => [person.name, personKind(person.kind), person.archived ? 'Sì' : '', person.workDays, person.workMinutes,
        ...(showAbsences ? [person.fullDayAbsences, person.timedAbsences, person.absenceMinutes] : [])]),
      [],
      ['Luogo di lavoro', 'Giornate di lavoro', 'Minuti lavorati registrati'],
      ...places.map(place => [place.label, place.workDays, place.workMinutes]),
      ...(showAbsences ? [
        [], ['Motivo assenza', 'Assenze a giornata', 'Assenze a ore', 'Minuti di assenza registrati'],
        ...absences.map(absence => [attendanceKindLabels[absence.kind], absence.fullDayAbsences, absence.timedAbsences, absence.absenceMinutes]),
      ] : []),
      ...(summary.incomplete ? [[], ['Registrazioni con orario incompleto escluse', summary.incomplete]] : []),
    ]);
  }

  return <section className={`panel ${styles.report}`} aria-labelledby={heading}>
    <div className={styles.heading}>
      <div><h2 id={heading}>Presenze e ore lavorate</h2><p>Calcolate sulle registrazioni del periodo selezionato.</p></div>
      <button type="button" className={`button secondary ${styles.export}`} disabled={pending || !people.length} onClick={exportAttendance}>
        <Download size={16} aria-hidden="true"/> Presenze CSV
      </button>
    </div>
    {people.length > 0 ? <>
      <dl className={styles.metrics}>{facts.map(fact => <div key={fact.label}>
        <dt>{fact.label}</dt><dd>{fact.value}</dd>
      </div>)}</dl>
      <WorkplaceHours places={places}/>
      <p className={styles.note}>Una giornata vale una volta per persona. Chi lavora in più luoghi compare in ciascuno dei relativi riepiloghi.
        {showAbsences && ' Le assenze a giornata si contano a parte, senza convertirle in ore.'}</p>
      <div className={styles.tables}>
        <div className={styles.scroll} role="region" aria-label="Presenze per persona" tabIndex={0}>
          <table data-wide={showAbsences}>
            <caption>Per persona</caption>
            <thead><tr><th scope="col">Persona</th><th scope="col">Giornate di lavoro</th><th scope="col">Ore lavorate</th>
              {showAbsences && <><th scope="col">Assenze a giornata</th><th scope="col">Assenze a ore</th><th scope="col">Ore di assenza</th></>}</tr></thead>
            <tbody>{people.map(person => <tr key={person.id}>
              <th scope="row">{person.name}<small>{[personKind(person.kind), person.archived ? 'Archiviata' : ''].filter(Boolean).join(' · ')}</small></th>
              <td>{person.workDays}</td><td>{formatWorkDuration(person.workMinutes)}</td>
              {showAbsences && <><td>{person.fullDayAbsences}</td><td>{person.timedAbsences}</td><td>{formatWorkDuration(person.absenceMinutes)}</td></>}
            </tr>)}</tbody>
          </table>
        </div>
        {places.length > 0 && <div className={styles.scroll} role="region" aria-label="Presenze per luogo di lavoro" tabIndex={0}>
          <table><caption>Per luogo di lavoro</caption>
            <thead><tr><th scope="col">Luogo</th><th scope="col">Giornate di lavoro</th><th scope="col">Ore lavorate</th></tr></thead>
            <tbody>{places.map(place => <tr key={place.key}>
              <th scope="row">{place.label}</th><td>{place.workDays}</td><td>{formatWorkDuration(place.workMinutes)}</td>
            </tr>)}</tbody>
          </table>
        </div>}
        {showAbsences && absences.length > 0 && <div className={styles.scroll} role="region" aria-label="Riepilogo per tipo di assenza" tabIndex={0}>
          <table><caption>Per tipo di assenza</caption>
            <thead><tr><th scope="col">Tipo</th><th scope="col">Assenze a giornata</th><th scope="col">Assenze a ore</th><th scope="col">Ore di assenza</th></tr></thead>
            <tbody>{absences.map(absence => <tr key={absence.kind}>
              <th scope="row">{attendanceKindLabels[absence.kind]}</th><td>{absence.fullDayAbsences}</td>
              <td>{absence.timedAbsences}</td><td>{formatWorkDuration(absence.absenceMinutes)}</td>
            </tr>)}</tbody>
          </table>
        </div>}
      </div>
    </> : <p className={styles.note}>Non ci sono registrazioni di presenza {showAbsences ? 'o assenza ' : ''}nei filtri selezionati.</p>}
    {!showAbsences && <p className={styles.note}>Per vedere le assenze, seleziona Tutti i cantieri.</p>}
    {summary.incomplete > 0 && <p className={styles.note}>Registrazioni escluse perché l’orario è incompleto o non valido: {summary.incomplete}.</p>}
  </section>;
}
