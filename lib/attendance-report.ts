import { attendanceMinutes, attendancePlaceLabels, type AttendanceEntry, type AttendancePerson } from './attendance.ts';
import type { ReportFilters, ReportSite } from './business-reports.ts';

export type AttendanceReportData = { entries: AttendanceEntry[]; people: AttendancePerson[] };
type AbsenceKind = Exclude<AttendanceEntry['kind'], 'work'>;

function emptyAbsence() {
  return { fullDayAbsences: 0, timedAbsences: 0, absenceMinutes: 0 };
}

function emptyPresence() {
  return { workMinutes: 0, workDays: 0 };
}

type Presence = ReturnType<typeof emptyPresence>;
type Absence = ReturnType<typeof emptyAbsence>;
type PersonRow = Presence & Absence & { id: string; name: string; kind: AttendancePerson['kind'] | null; archived: boolean };
type PlaceRow = Presence & { key: string; label: string };

function registerAbsence(tally: Absence, minutes: number | null) {
  if (minutes === null) tally.fullDayAbsences += 1;
  else {
    tally.timedAbsences += 1;
    tally.absenceMinutes += minutes;
  }
}

function workPlace(entry: AttendanceEntry, sites: ReadonlyMap<string, string>) {
  if (entry.workplace === 'site') return {
    key: `site:${entry.site_id ?? ''}`,
    label: entry.site_id ? sites.get(entry.site_id) || 'Cantiere non disponibile' : 'Cantiere non specificato',
  };
  return { key: entry.workplace ?? 'unknown', label: entry.workplace ? attendancePlaceLabels[entry.workplace] : 'Luogo non specificato' };
}

export function buildAttendanceReport(data: AttendanceReportData, filters: ReportFilters, sites: Pick<ReportSite, 'id' | 'name'>[]) {
  const people = new Map(data.people.map(person => [person.id, person]));
  const siteNames = new Map(sites.map(site => [site.id, site.name]));
  const peopleRows = new Map<string, PersonRow>();
  const placeRows = new Map<string, PlaceRow>();
  const absenceRows = new Map<AbsenceKind, Absence>();
  const workedDays = new Set<string>();
  const placeDays = new Set<string>();
  const summary = { ...emptyPresence(), ...emptyAbsence(), incomplete: 0 };
  const showAbsences = !filters.site;

  for (const entry of new Map(data.entries.map(row => [row.id, row])).values()) {
    if (entry.work_date < filters.from || entry.work_date > filters.to) continue;
    if (!showAbsences && (entry.kind !== 'work' || entry.workplace !== 'site' || entry.site_id !== filters.site)) continue;
    const minutes = attendanceMinutes(entry);
    const fullDay = entry.kind !== 'work' && entry.start_time === null && entry.end_time === null;
    if (minutes === null && !fullDay) {
      summary.incomplete += 1;
      continue;
    }
    const person = people.get(entry.person_id);
    const samePerson = peopleRows.get(entry.person_id) ?? {
      id: entry.person_id, name: person?.name ?? 'Persona non disponibile', kind: person?.kind ?? null,
      archived: person?.archived ?? false, ...emptyPresence(), ...emptyAbsence(),
    };
    peopleRows.set(entry.person_id, samePerson);

    if (entry.kind !== 'work') {
      const absence = absenceRows.get(entry.kind) ?? emptyAbsence();
      registerAbsence(absence, minutes);
      registerAbsence(samePerson, minutes);
      registerAbsence(summary, minutes);
      absenceRows.set(entry.kind, absence);
      continue;
    }
    if (minutes === null) continue;

    const place = workPlace(entry, siteNames);
    const samePlace = placeRows.get(place.key) ?? { ...place, ...emptyPresence() };
    placeRows.set(place.key, samePlace);
    samePlace.workMinutes += minutes;
    samePerson.workMinutes += minutes;
    summary.workMinutes += minutes;

    const day = `${entry.person_id}:${entry.work_date}`;
    if (!workedDays.has(day)) {
      workedDays.add(day);
      samePerson.workDays += 1;
    }
    const placeDay = `${place.key}:${day}`;
    if (!placeDays.has(placeDay)) {
      placeDays.add(placeDay);
      samePlace.workDays += 1;
    }
  }
  summary.workDays = workedDays.size;

  return {
    summary, showAbsences,
    people: [...peopleRows.values()].sort((a, b) => a.name.localeCompare(b.name, 'it') || a.id.localeCompare(b.id)),
    places: [...placeRows.values()].sort((a, b) => a.label.localeCompare(b.label, 'it') || a.key.localeCompare(b.key)),
    absences: [...absenceRows].map(([kind, value]) => ({ kind, ...value })),
  };
}

export type AttendanceReport = ReturnType<typeof buildAttendanceReport>;
