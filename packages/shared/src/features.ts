/**
 * Feature flags per module. Enforced server-side per location (BetrVG § 87 Abs. 1 Nr. 6).
 * Default for production is OFF for every module that requires works council approval.
 */
export const FEATURES = [
  'stamping',
  'productivity.self',
  'productivity.team',
  'team.overview',
  'planning.board',
  'materials',
  'consumables',
  'photos',
  'chat',
  'dictation',
  'dictation.ai',
  'parts.cartAi',
  'absence.sick',
  'absence.vacation',
] as const;

export type Feature = (typeof FEATURES)[number];

/** Modules that constitute technical performance/behaviour monitoring and need works council approval. */
export const WORKS_COUNCIL_FEATURES: readonly Feature[] = [
  'stamping',
  'productivity.self',
  'productivity.team',
  'team.overview',
];

export const FEATURE_LABELS: Record<Feature, string> = {
  stamping: 'Stempelung',
  'productivity.self': 'Produktivität (eigene Sicht)',
  'productivity.team': 'Produktivität (Teamansicht Meister)',
  'team.overview': 'Teamübersicht Meister',
  'planning.board': 'Plantafel',
  materials: 'Artikel & Ersatzteile',
  consumables: 'Verbrauchsstoffe',
  photos: 'Fotos',
  chat: 'Auftrags-Chat',
  dictation: 'Diktat',
  'dictation.ai': 'KI-Umformulierung Diktat',
  'parts.cartAi': 'KI: Warenkorb aus Herstellershop übernehmen',
  'absence.sick': 'Krankmeldung',
  'absence.vacation': 'Urlaubsanträge',
};

export function isFeature(value: string): value is Feature {
  return (FEATURES as readonly string[]).includes(value);
}

/** Default state of a flag when no row exists for a location. */
export function defaultFeatureState(feature: Feature, environment: 'dev' | 'test' | 'prod'): boolean {
  if (environment !== 'prod') return true;
  if (feature === 'dictation.ai' || feature === 'parts.cartAi') return false;
  return !WORKS_COUNCIL_FEATURES.includes(feature);
}
