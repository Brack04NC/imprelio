import { z } from 'zod';
import { documentDefinitions } from './operation-documents.ts';
import { resourceDefinitions } from './operation-resources.ts';
import { validateVehicleMaintenance } from './vehicle-maintenance.ts';
import { areas, operationKinds, type Definition, type Field, type OperationArea, type OperationKind, type OperationWrite, type Values } from './operation-types.ts';

const definitions = new Map<OperationKind, Definition>(
  [...resourceDefinitions, ...documentDefinitions].map(definition => [definition.kind, definition]),
);
export const operationDefinition = (kind: OperationKind) => definitions.get(kind)!;
export const isArea = (value: string): value is OperationArea => Object.hasOwn(areas, value);

const values = z.record(z.string().max(60), z.string().trim().max(2000));
const rawWrite = z.object({
  id: z.uuid(),
  action: z.enum(['save', 'archive', 'restore']),
  kind: z.enum(operationKinds),
  title: z.string().trim().min(1).max(160).optional(),
  status: z.string().max(64).optional(),
  site_id: z.uuid().nullable().optional(),
  record_date: z.iso.date().nullable().optional(),
  fields: values.optional(),
  lines: z.array(values).max(100).optional(),
});

export function applicableFields(fields: Field[], values: Values) {
  return fields.filter(field => !field.when || values[field.when.key] === field.when.value);
}

function cleanValues(fields: Field[], values: Values = {}): Values {
  const result: Values = {};
  for (const field of applicableFields(fields, values)) {
    const value = (values[field.key] ?? '').trim();
    if (!value) {
      if (field.required) throw new Error(`Compila il campo “${field.label}”.`);
      result[field.key] = '';
      continue;
    }

    let valid = true;
    switch (field.type) {
      case 'article': valid = z.uuid().safeParse(value).success; break;
      case 'select': valid = Boolean(field.options?.some(option => option.value === value)); break;
      case 'date': valid = z.iso.date().safeParse(value).success; break;
      case 'email': valid = z.email().safeParse(value).success; break;
      case 'number': {
        const decimal = value.replace(',', '.');
        const precision = field.decimals ?? 0;
        const pattern = precision ? new RegExp(`^\\d{1,9}(?:\\.\\d{1,${precision}})?$`) : /^\d{1,9}$/;
        valid = pattern.test(decimal) && Number(decimal) >= (field.min ?? 0) && Number(decimal) <= (field.max ?? 999_999_999);
        if (valid) { result[field.key] = decimal; continue; }
        break;
      }
    }
    if (!valid) throw new Error(`Controlla il valore di “${field.label}”.`);
    result[field.key] = value;
  }
  return result;
}

export function validateOperation(input: unknown): OperationWrite {
  const result = rawWrite.safeParse(input);
  if (!result.success) throw new Error('Controlla i dati della scheda prima di salvare.');
  const { action, id, kind, title, site_id = null, record_date = null, status, fields, lines } = result.data;
  if (action !== 'save') return { action, id, kind };
  const definition = operationDefinition(kind);
  if (!title) throw new Error(`Compila il campo “${definition.titleLabel}”.`);
  if (!status || !definition.statuses.some(option => option.value === status)) throw new Error('Seleziona uno stato valido.');
  if (definition.dateRequired && !record_date) throw new Error('Inserisci la data.');
  if (definition.site === 'required' && !site_id) throw new Error('Seleziona il cantiere.');
  const formFields = kind === 'crew' && fields?.team_type === undefined ? { ...fields, team_type: 'external' } : fields;
  const cleanFields = cleanValues(definition.fields, formFields);
  if (kind === 'article' && fields) Object.assign(cleanFields, validateVehicleMaintenance({ ...fields, category: cleanFields.category }));
  const cleanLines = definition.lineFields ? (lines ?? []).map((line, index) => {
    try { return cleanValues(definition.lineFields!, line); }
    catch (error) { throw new Error(`Riga ${index + 1}. ${error instanceof Error ? error.message : 'Controlla i dati.'}`); }
  }) : [];
  if (cleanLines.length < (definition.minLines ?? 0)) throw new Error('Aggiungi almeno una riga.');
  return { action, id, kind, title, site_id: definition.site === 'none' ? null : site_id,
    record_date: definition.dateLabel ? record_date : null, status, fields: cleanFields, lines: cleanLines };
}
