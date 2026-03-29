import { type Db, type Document } from 'mongodb';

/** Maximum documents sampled per collection for schema inference. */
export const SAMPLE_LIMIT = 20;

/**
 * A JSON Schema fragment describing a single field's inferred type.
 * We only produce the subset of JSON Schema that makes sense for
 * MongoDB documents: string, number, boolean, null, array, object.
 */
export type JsonSchemaType =
  | 'string'
  | 'number'
  | 'integer'
  | 'boolean'
  | 'null'
  | 'array'
  | 'object';

export interface InferredField {
  /** JSON Schema types observed across sampled documents. */
  types: Set<JsonSchemaType>;
  /** True if the field was present in every sampled document. */
  presentInAll: boolean;
  /** Count of documents where this field was observed. */
  seenCount: number;
}

export interface InferredSchema {
  /** Field name → its inferred descriptor. */
  fields: Record<string, InferredField>;
  /** Total documents sampled. */
  sampleCount: number;
}

// ─── Primitive type inference ─────────────────────────────────────────────────

/**
 * Map a JavaScript runtime value to its JSON Schema type.
 * Integers are a sub-type of number; we report 'integer' when the value
 * is a whole number so that OpenAPI consumers can use it for validation.
 */
export function inferType(value: unknown): JsonSchemaType {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  // Date must come before the generic object check (typeof Date === 'object')
  if (value instanceof Date) return 'string';
  if (typeof value === 'object') return 'object';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'string') return 'string';
  if (typeof value === 'number') {
    return Number.isInteger(value) ? 'integer' : 'number';
  }
  // Fallback for other special types (ObjectId, Binary, Decimal128, etc.) — serialize as string
  return 'string';
}

// ─── Shape merging ────────────────────────────────────────────────────────────

/**
 * Merge a single document's field observations into the accumulator map.
 * Each call represents one sample document.
 *
 * @param acc     Running accumulator (mutated in-place)
 * @param doc     One MongoDB document
 * @param total   Total documents sampled so far (used to detect first-seen fields)
 */
export function mergeDocument(
  acc: Record<string, InferredField>,
  doc: Document,
  total: number
): void {
  const seenKeys = new Set<string>();

  for (const [key, value] of Object.entries(doc)) {
    seenKeys.add(key);
    const type = inferType(value);

    const existing = acc[key];
    if (existing === undefined) {
      // Field seen for the first time.  If total > 0 it was absent in earlier
      // docs, so presentInAll must be false.
      acc[key] = {
        types: new Set([type]),
        presentInAll: total === 0,
        seenCount: 1,
      };
    } else {
      existing.types.add(type);
      existing.seenCount += 1;
    }
  }

  // Any field already tracked but absent from this document can no longer
  // be "present in all".
  for (const key of Object.keys(acc)) {
    const field = acc[key];
    if (field !== undefined && !seenKeys.has(key)) {
      field.presentInAll = false;
    }
  }
}

// ─── Top-level sampler ────────────────────────────────────────────────────────

/**
 * Sample up to {@link SAMPLE_LIMIT} documents from a MongoDB collection and
 * infer a merged JSON Schema shape.
 *
 * Returns an {@link InferredSchema} containing per-field type info and the
 * number of documents actually sampled.
 */
export async function inferCollectionSchema(
  db: Db,
  collectionName: string
): Promise<InferredSchema> {
  const docs = await db
    .collection(collectionName)
    .find({})
    .limit(SAMPLE_LIMIT)
    .toArray();

  const fields: Record<string, InferredField> = {};

  for (let i = 0; i < docs.length; i++) {
    const doc = docs[i];
    if (doc !== undefined) {
      mergeDocument(fields, doc, i);
    }
  }

  return { fields, sampleCount: docs.length };
}

// ─── JSON Schema property builder ─────────────────────────────────────────────

/**
 * Convert an {@link InferredField} to a JSON Schema property object
 * suitable for embedding in an OpenAPI 3.1 schema.
 *
 * - Single type → `{ type: "string" }` (or whichever type)
 * - Multiple types → `{ anyOf: [{ type: "..." }, ...] }`
 */
export function buildPropertySchema(field: InferredField): Record<string, unknown> {
  const types = Array.from(field.types);

  if (types.length === 1) {
    return { type: types[0] };
  }

  // Multiple types — use anyOf
  return {
    anyOf: types.map((t) => ({ type: t })),
  };
}

/**
 * Build a full OpenAPI-compatible JSON Schema object from an
 * {@link InferredSchema}.  Fields present in < 50% of samples are
 * omitted from `required`.
 *
 * The returned schema includes the `x-schema-inference: "sampled"` extension
 * at the top level as required by the spec.
 */
export function buildSchemaObject(inferred: InferredSchema): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const [fieldName, field] of Object.entries(inferred.fields)) {
    properties[fieldName] = buildPropertySchema(field);

    // Present in > 50% of samples → required
    const threshold = inferred.sampleCount > 0 ? inferred.sampleCount * 0.5 : 0;
    if (field.seenCount > threshold) {
      required.push(fieldName);
    }
  }

  const schema: Record<string, unknown> = {
    'x-schema-inference': 'sampled',
    type: 'object',
    properties,
  };

  if (required.length > 0) {
    schema.required = required;
  }

  return schema;
}
