import { z } from 'zod';
import { calendarRange } from './calendar.ts';
import { plusDays, romeDate, type Job, type JobKind, type SiteState } from './domain.ts';
import type { QuoteSummary } from './estimate-pricing.ts';
import { documentTotals } from './operation-documents.ts';
import { getWarehouseAvailability, isBelowMinimum, isStockArticle } from './operation-resources.ts';
import type { OperationRecord, SiteOption } from './operation-types.ts';
import { isSelectableAssignee, isSelectableVehicle, vehicleAssignmentState, type VehicleAssignment } from './vehicle-assignments.ts';
import { vehicleMaintenance, vehicleMaintenanceState } from './vehicle-maintenance.ts';

export type ReportSite = SiteOption & { status: SiteState };
export type ReportJob = Pick<Job, 'id' | 'site_id' | 'kind' | 'due_date' | 'status'>;
export type ReportData = {
  sites: ReportSite[];
  jobs: ReportJob[];
  records: OperationRecord[];
  quotes: QuoteSummary[];
  assignments: VehicleAssignment[] | null;
};
export type ReportFilters = { from: string; to: string; site: string };
type ReportParams = { dal?: string | string[]; al?: string | string[]; cantiere?: string | string[] };

const isoDate = z.iso.date();
const id = z.uuid();

function validDate(value: unknown) {
  const verified = isoDate.safeParse(value);
  return verified.success && !verified.data.startsWith('0000-') ? verified.data : '';
}

export function parseReportFilters(params: ReportParams, today: string): ReportFilters {
  const end = validDate(params.al) || today;
  const start = validDate(params.dal) || `${end.slice(0, 7)}-01`;
  const from = start <= end ? start : end;
  const to = start <= end ? end : start;
  const site = id.safeParse(params.cantiere);
  return { from, to, site: site.success ? site.data.toLowerCase() : '' };
}

function emptyBalance() {
  return { revenue: 0n, cost: 0n, balance: 0n };
}

function emptyFinancials() {
  return {
    ...emptyBalance(), revenueGross: 0n, costGross: 0n, revenueVat: 0n, costVat: 0n,
    receivables: 0n, payables: 0n, overdueReceivables: 0n, overduePayables: 0n,
  };
}

type Balance = ReturnType<typeof emptyBalance>;
type Financials = ReturnType<typeof emptyFinancials>;
type Direction = 'outgoing' | 'incoming';
type InvoiceState = 'draft' | 'open' | 'paid';
type Amounts = NonNullable<ReturnType<typeof documentTotals>>;
export type ReportInvoice = {
  id: string; siteId: string; siteName: string; title: string; date: string;
  party: string; direction: Direction | null; status: InvoiceState | null;
  dueDate: string | null; paidDate: string | null; net: bigint | null; vat: bigint | null; gross: bigint | null;
  overdue: boolean; incomplete: boolean;
};

function addBalance(balance: Balance, direction: Direction, net: bigint) {
  if (direction === 'outgoing') balance.revenue += net;
  else balance.cost += net;
  balance.balance = balance.revenue - balance.cost;
}

function addFinancials(money: Financials, direction: Direction, invoice: ReportInvoice, totals: Amounts) {
  addBalance(money, direction, totals.net);
  if (direction === 'outgoing') {
    money.revenueGross += totals.total;
    money.revenueVat += totals.vat;
    if (invoice.status === 'open') money.receivables += totals.total;
    if (invoice.overdue) money.overdueReceivables += totals.total;
  } else {
    money.costGross += totals.total;
    money.costVat += totals.vat;
    if (invoice.status === 'open') money.payables += totals.total;
    if (invoice.overdue) money.overduePayables += totals.total;
  }
}

function monthNumber(date: string) {
  return Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1;
}

function monthlyBalances({ from, to }: ReportFilters) {
  const months = new Map<string, Balance>();
  const first = monthNumber(from);
  const last = monthNumber(to);
  // Wide ranges retain every month with activity without allocating empty buckets for centuries.
  const monthlyOmittedEmpty = last - first >= 120;
  if (monthlyOmittedEmpty) return { months, monthlyOmittedEmpty };
  for (let index = first; index <= last; index += 1) {
    const year = String(Math.floor(index / 12)).padStart(4, '0');
    const month = String(index % 12 + 1).padStart(2, '0');
    months.set(`${year}-${month}`, emptyBalance());
  }
  return { months, monthlyOmittedEmpty };
}

type ActivityGranularity = 'day' | 'week' | 'month' | 'year';

function trendGranularity({ from, to }: ReportFilters): ActivityGranularity {
  const days = (Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86_400_000 + 1;
  if (days <= 14) return 'day';
  if (days <= 70) return 'week';
  if (monthNumber(to) - monthNumber(from) < 24) return 'month';
  return 'year';
}

function trendPeriod(date: string, granularity: ActivityGranularity) {
  switch (granularity) {
    case 'day': return { key: date, from: date, to: date };
    case 'week': {
      const { from, to } = calendarRange({ view: 'settimana', date });
      return { key: from, from, to };
    }
    case 'month': {
      const key = date.slice(0, 7);
      const from = key + '-01';
      const end = new Date(from + 'T00:00:00Z');
      end.setUTCMonth(end.getUTCMonth() + 1, 0);
      return { key, from, to: end.toISOString().slice(0, 10) };
    }
    case 'year': {
      const key = date.slice(0, 4);
      return { key, from: key + '-01-01', to: key + '-12-31' };
    }
  }
}

type ActivityPoint = ReturnType<typeof trendPeriod> & { total: number; completed: number; overdue: number };

function activityBuckets(filters: ReportFilters) {
  const granularity = trendGranularity(filters);
  const omittedEmpty = granularity === 'year' && Number(filters.to.slice(0, 4)) - Number(filters.from.slice(0, 4)) >= 24;
  const points = new Map<string, ActivityPoint>();
  function pointAt(date: string) {
    const { key, from, to } = trendPeriod(date, granularity);
    const existing = points.get(key);
    if (existing) return existing;
    const point = {
      key, from: from < filters.from ? filters.from : from, to: to > filters.to ? filters.to : to,
      total: 0, completed: 0, overdue: 0,
    };
    points.set(key, point);
    return point;
  }

  if (!omittedEmpty) {
    let date = filters.from;
    while (date <= filters.to) {
      const { to } = pointAt(date);
      if (to === filters.to) break;
      date = plusDays(to, 1);
    }
  }
  return { pointAt, points, granularity, omittedEmpty };
}

function makeSite(id: string, site?: ReportSite) {
  return { id, name: site?.name ?? 'Senza cantiere', city: site?.city ?? '', client: site?.client ?? '',
    status: site?.status ?? null, ...emptyFinancials(), invoiceCount: 0, jobCount: 0 };
}

function invoiceDetail(record: OperationRecord, siteName: string, today: string) {
  const date = validDate(record.record_date);
  const dueDate = validDate(record.fields.due_date) || null;
  const paidDate = validDate(record.fields.paid_date) || null;
  const direction = record.fields.direction === 'incoming' || record.fields.direction === 'outgoing' ? record.fields.direction : null;
  const status = record.status === 'open' || record.status === 'paid' || record.status === 'draft' ? record.status : null;
  const party = record.fields.party?.trim() ?? '';
  const complete = Boolean(date && direction && party && (status === 'open' || status === 'paid') && record.lines.length
    && record.lines.every(line => line.description?.trim() && line.unit?.trim()));
  const amounts = complete ? documentTotals('invoice', record.fields, record.lines) : null;
  const row: ReportInvoice = {
    id: record.id, siteId: record.site_id ?? '', siteName, title: record.title, date, party, direction, status, dueDate, paidDate,
    net: amounts?.net ?? null, vat: amounts?.vat ?? null, gross: amounts?.total ?? null,
    overdue: Boolean(amounts && status === 'open' && dueDate && dueDate < today),
    incomplete: status !== 'draft' && amounts === null,
  };
  return { row, amounts };
}

/** Current statuses and gross open amounts for issued documents, with separate flows by payment date. */
export function buildBusinessReport(data: ReportData, filters: ReportFilters, today: string) {
  const inPeriod = (date: string | null) => Boolean(date && date >= filters.from && date <= filters.to);
  const inSite = (site: string | null) => !filters.site || filters.site === site;
  const sites = [...new Map(data.sites.filter(site => inSite(site.id)).map(site => [site.id, site])).values()];
  const siteRows = new Map(sites.map(site => [site.id, makeSite(site.id, site)]));
  const unassigned = makeSite('');
  const { months, monthlyOmittedEmpty } = monthlyBalances(filters);
  const trend = activityBuckets(filters);
  const summary = { ...emptyFinancials(), collected: 0n, paid: 0n, drafts: 0, incomplete: 0, missingPaidDate: 0 };
  const invoices: ReportInvoice[] = [];
  const settledInvoices: ReportInvoice[] = [];
  const currentRecords = [...new Map(data.records.map(record => [record.id, record])).values()].filter(record => !record.archived);
  const scopedRecords = currentRecords.filter(record => inSite(record.site_id));
  const stockArticles = currentRecords.filter(isStockArticle);
  const stock = getWarehouseAvailability(currentRecords);
  const jobsByKind: Record<JobKind, number> = { survey: 0, assembly: 0, adjustment: 0, dismantling: 0, other: 0 };
  const clients = new Set(sites.map(site => site.client_id || site.client.trim().toLowerCase()).filter(Boolean));
  const sitesByStatus: Record<SiteState, number> = { active: 0, planned: 0, paused: 0, closed: 0 };
  for (const site of sites) sitesByStatus[site.status] += 1;
  const activity = {
    activeSites: sitesByStatus.active, sites: sites.length, sitesByStatus, clients: clients.size,
    jobs: 0, jobsCompleted: 0, jobsOverdue: 0, jobsByKind, orders: 0, ddt: 0, estimates: 0, quotes: 0,
    employees: 0, workers: 0, crews: 0, stockArticles: stockArticles.length,
    lowStock: stockArticles.filter(article => isBelowMinimum(article, stock.get(article.id) ?? 0n)).length,
    vehiclesAssigned: data.assignments === null ? null : 0,
  };

  for (const record of scopedRecords) {
    switch (record.kind) {
      case 'employee': activity.employees += 1; break;
      case 'worker': activity.workers += 1; break;
      case 'crew': activity.crews += 1; break;
      case 'ddt': if (inPeriod(record.record_date)) activity.ddt += 1; break;
      case 'order': if (inPeriod(record.record_date)) activity.orders += 1; break;
      case 'estimate': if (inPeriod(record.record_date)) activity.estimates += 1; break;
    }
    if (record.kind !== 'invoice') continue;

    const siteRow = record.site_id ? siteRows.get(record.site_id) : unassigned;
    const { row, amounts } = invoiceDetail(record, siteRow?.name ?? 'Cantiere non disponibile', today);
    const { direction } = row;
    if (row.status === 'paid' && amounts && direction) {
      if (!row.paidDate) summary.missingPaidDate += 1;
      else if (inPeriod(row.paidDate)) {
        if (direction === 'outgoing') summary.collected += amounts.total;
        else summary.paid += amounts.total;
        settledInvoices.push(row);
      }
    }

    // Undated documents cannot belong to a month but must be visible for correction.
    if (row.date && !inPeriod(row.date)) continue;
    invoices.push(row);
    if (siteRow) siteRow.invoiceCount += 1;
    if (row.status === 'draft') summary.drafts += 1;
    else if (row.incomplete) summary.incomplete += 1;
    if (!amounts || !direction) continue;
    addFinancials(summary, direction, row, amounts);
    if (siteRow) addFinancials(siteRow, direction, row, amounts);
    const monthKey = row.date.slice(0, 7);
    const month = months.get(monthKey) ?? emptyBalance();
    addBalance(month, direction, amounts.net);
    months.set(monthKey, month);
  }

  for (const job of new Map(data.jobs.map(job => [job.id, job])).values()) {
    if (!inSite(job.site_id) || !inPeriod(job.due_date) || !validDate(job.due_date)) continue;
    activity.jobs += 1;
    jobsByKind[job.kind] += 1;
    const point = trend.pointAt(job.due_date);
    point.total += 1;
    if (job.status === 'done') {
      activity.jobsCompleted += 1;
      point.completed += 1;
    } else if (job.due_date < today) {
      activity.jobsOverdue += 1;
      point.overdue += 1;
    }
    const siteRow = siteRows.get(job.site_id);
    if (siteRow) siteRow.jobCount += 1;
  }

  for (const quote of new Map(data.quotes.map(quote => [quote.id, quote])).values()) {
    const created = new Date(quote.created_at);
    if (inSite(quote.site_id) && Number.isFinite(created.getTime()) && inPeriod(romeDate(created))) activity.quotes += 1;
  }

  if (data.assignments !== null) {
    const vehicles = new Set(currentRecords.filter(record => {
      if (!isSelectableVehicle(record)) return false;
      const maintenance = vehicleMaintenance(record);
      return !maintenance || vehicleMaintenanceState(maintenance, today) !== 'active';
    }).map(record => record.id));
    const assignees = new Set(scopedRecords.filter(isSelectableAssignee).map(record => record.id));
    const siteIds = new Set(sites.map(site => site.id));
    const assigned = new Set<string>();
    for (const assignment of data.assignments) {
      if (!vehicles.has(assignment.vehicle_id) || vehicleAssignmentState(assignment, today) !== 'active') continue;
      const inScope = assignment.site_id ? siteIds.has(assignment.site_id)
        : assignment.assignee_id && assignees.has(assignment.assignee_id);
      if (inScope) assigned.add(assignment.vehicle_id);
    }
    activity.vehiclesAssigned = assigned.size;
  }

  const sortedSites = [...siteRows.values()].sort((a, b) => a.name.localeCompare(b.name, 'it'));
  if (unassigned.invoiceCount) sortedSites.push(unassigned);
  invoices.sort((a, b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title, 'it'));
  settledInvoices.sort((a, b) => (b.paidDate ?? '').localeCompare(a.paidDate ?? '') || a.title.localeCompare(b.title, 'it'));

  const monthly = [...months].sort(([a], [b]) => a.localeCompare(b)).map(([month, balance]) => ({ month, ...balance }));
  const activityTrend = {
    granularity: trend.granularity, omittedEmpty: trend.omittedEmpty,
    points: [...trend.points.values()].sort((a, b) => a.key.localeCompare(b.key)),
  };
  return { filters, summary, monthly, monthlyOmittedEmpty,
    sites: sortedSites, invoices, settledInvoices, activity, activityTrend };
}
