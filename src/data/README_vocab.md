# Vocabulary Data Model

This directory contains thematic, scenario‑driven vocabulary datasets plus the JSON Schema used to validate them.

## Current Files

- `vocab_schema_v1.json` – Validation schema (strict) for v1.
- `vocab_schema_v2.json` – Extended schema with optional pragmatic / functional metadata.
- `vocab_en.json` – English pragmatic scenario categories (content currently mostly v1 fields; can gradually adopt v2 fields).
- `vocab_fr.json` – Early French scaffold re‑using English IDs for alignment.

## v1 Object Shape

Root object:

```
{
  language: string,
  version: number,
  generatedAt?: ISO 8601 string,
  categories: Array<{
    id: string,
    label: string,
    items: Array<{
      id: string,
      term: string,
      cefr: "A1"|"A2"|"B1"|"B2"|"C1"|"C2",
      tags?: string[],
      example?: string,
      hint?: string
    }>
  }>
}
```

All additional properties are disallowed to ensure forward changes are explicit.

## v2 Schema Goals

Add realistic metadata for dialogue generation, adaptive sequencing, and pragmatic coaching. All new fields are optional so migration can be incremental.

| Field | Purpose | Example |
|-------|---------|---------|
| `register` | Formality / tone | `neutral`, `casual`, `polite`, `formal` |
| `function` | Communicative function taxonomy | `request`, `hedge`, `repair`, `escalate`, `mitigate` |
| `chunkType` | Linguistic nature | `lexeme`, `multiword`, `formulaic`, `collocation` |
| `scenario` | Optional override if item belongs to multiple categories; canonical scenario id | `coffee_shop` |
| `pragmatics` | Brief usage/pragmatic note | "Softens a direct refusal" |
| `variations` | Alternate forms / inflections / region variants | `["to-go", "takeaway (UK)"]` |
| `translations` | Map of language code -> term translation (parallel IDs across langs) | `{ "fr": "...", "de": "..." }` |
| `appliesTo` | Narrow context / slot constraint | `payment`, `closing`, `greeting` |
| `frequency` | Rough band for prioritization | `high`, `med`, `low` |

### Draft v2 Item Snippet (Example)

```jsonc
{
  "id": "for_here_or_to_go",
  "term": "for here or to go?",
  "cefr": "A2",
  "register": "neutral",
  "function": ["service_question"],
  "chunkType": "formulaic",
  "scenario": "coffee_shop",
  "pragmatics": "Default service question offering consumption mode choice.",
  "variations": ["for here or takeaway?"],
  "translations": { "fr": "sur place ou à emporter ?", "de": "zum Hieressen oder mitnehmen?" },
  "frequency": "high",
  "example": "Barista: For here or to go?",
  "hint": "barista default service question"
}
```

## Versioning Strategy

- Increment the numeric `version` inside each vocab file when **content** changes (add/remove categories, items, examples, CEFR adjustments).
- Introduce a new schema file (`vocab_schema_v2.json`) when the **structure** changes. Keep older schemas for historical validation.

## ID Conventions

- Use lowercase snake_case IDs.
- Keep item IDs stable across languages so translation mapping is straightforward (English file can be the canonical set of IDs).

## Validation Workflow

Implemented script: `npm run validate:vocab` (also auto‑runs before `npm run dev`). It:

1. Loads all `vocab_*.json`.
2. Validates each against the v1 schema (v2 adoption in data is allowed because extra fields are only in the v2 file—when we switch validator we’ll point to v2).
3. Reports schema errors & duplicate item IDs.

### Planned Enhancement
Add a light resolver allowing each vocab file to specify a `schemaVersion` property to choose which schema to validate against; fallback to v1 if absent.

## Migration to v2 Fields

Recommended staged approach:

1. Add high‑value fields first: `function`, `register`, `pragmatics` to items most frequently used in dialogue generation.
2. Add `variations` where regional or alternative phrasing matters.
3. Introduce `translations` only after cross‑language review (avoid machine translation drift—curate manually or semi‑automatically with human check).
4. Populate `frequency` to power spaced repetition / prioritization UI.
5. Use `scenario` only when an item logically appears in more than one category (prevents duplication).

## Enrichment Guidelines

- Keep pragmatic notes concise (<90 chars) and pedagogically actionable.
- Limit `function` taxonomy to a curated set (draft list): `service_question`, `request`, `softener`, `hedge`, `repair`, `escalate`, `mitigate`, `confirmation`, `clarify`, `closure`.
- Use `chunkType` heuristics:
  - Formulaic: fixed service / social phrases.
  - Multiword: compositional but common phrase.
  - Collocation: frequent co‑occurrence (e.g., "file a claim").
  - Lexeme: single lexical item.
- Frequency bands: `high` = core survival / ubiquitous; `med` = useful but situational; `low` = niche or advanced nuance.

## Planned Dialogue Generation Usage

The dialogue API will:

1. Accept selected item IDs.
2. Provide each to the model with its `function`, `pragmatics`, and `register` metadata as constraints.
3. Ask the model to tag which items were used per turn (enabling highlighting + spaced repetition tracking).

## Future Considerations

- Potential `difficultyScore` numeric field (0–1) derived from corpus frequency.
- Add `deprecated` boolean when retiring / replacing items.
- Provide a `source` field for citation if items come from curated corpora.

## Roadmap

1. Switch validator to choose schema per file (v1 vs v2) via optional `schemaVersion`.
2. Enrich top 30 high‑impact English items with v2 fields.
3. Add minimal translation pairs (EN ↔ FR) for the enriched subset.
4. Implement dialogue generation endpoint leveraging enriched metadata.
5. Add UI filtering by CEFR, function, register.
6. Integrate spaced repetition scheduling using `frequency` + user performance.

---
Questions / adjustments welcome. This doc should evolve with the data model.
