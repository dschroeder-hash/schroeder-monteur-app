import type { ChecklistItem } from './checklist.js';

/**
 * "Servicecheckliste (gelbe Karte)" as in BC (screenshots from the service office, 20.11.2026). The field types
 * (checkbox / number / choice / unit) are derived from the screenshots and must be confirmed (OFFENE-PUNKTE OP-44);
 * the choice lists for oils and greases are placeholders until they come from BC.
 */
const h = (id: string, text: string, orderTypes?: string[]): ChecklistItem => ({
  id,
  text,
  kind: 'heading',
  ...(orderTypes ? { orderTypes } : {}),
});
const tick = (id: string, text: string, extra: Partial<ChecklistItem> = {}): ChecklistItem => ({
  id,
  text,
  kind: 'line',
  checkbox: true,
  answer: 'none',
  ...extra,
});
const num = (id: string, text: string, unit?: string | string[]): ChecklistItem => ({
  id,
  text,
  kind: 'line',
  answer: 'number',
  ...(Array.isArray(unit) ? { unitOptions: unit } : unit ? { unit } : {}),
});
const txt = (id: string, text: string): ChecklistItem => ({ id, text, kind: 'line', answer: 'text' });
const choice = (id: string, text: string, options: string[]): ChecklistItem => ({
  id,
  text,
  kind: 'line',
  answer: 'option',
  options,
});
const LST = ['Liter', 'St.'];
const OILS = ['15W-40', '10W-40', '5W-30', 'Sonstiges'];
const GEAR_OILS = ['UTTO / STOU', 'Hydrauliköl HVLP 46', 'Getriebeöl 80W-90', 'Sonstiges'];
const ANTIFREEZE = ['G12', 'G11', 'Sonstiges'];
const GREASE = ['Lithium EP2', 'Hochleistungsfett', 'Sonstiges'];

export const YELLOW_CARD: ChecklistItem[] = [
  h('maschinendaten', 'Maschinendaten'),
  tick('betriebsstunden', 'Betriebsstunden', { answer: 'number', unit: 'h' }),
  tick('weitere_maschinendaten', 'weitere Maschinendaten'),
  txt('maschinenangabe_inhalt', 'Maschinenangabe Inhalt'),
  tick('weitere_maschinendaten_1', 'weitere Maschinendaten 1'),
  txt('maschinenangabe_inhalt_1', 'Maschinenangabe Inhalt 1'),
  tick('pol_kennzeichen', 'Pol. Kennzeichen', { answer: 'text' }),

  h('fahrtkosten', 'Fahrtkosten/Transportkosten'),
  tick('kdw_kennzeichen', 'KDW Kennzeichen', { answer: 'text' }),
  num('kdw_km', 'Km', 'km'),
  tick('lkw_tieflader', 'LKW-Tieflader'),
  num('lkw_km', 'Km', 'km'),
  tick('traktor_tieflader', 'Traktor-Tieflader'),
  num('traktor_km', 'Km', 'km'),
  tick('anhaenger', 'Anhänger'),
  num('anhaenger_km', 'Km', 'km'),

  h('klimaservice', 'Klimaservice'),
  tick('klimageraet', 'Klimagerät (1035)'),
  tick('kaeltemittel_art', 'Kältemittel Art', { answer: 'text' }),
  num('kaeltemittel', 'Kältemittel', 'g'),
  num('leuchtmittel', 'Leuchtmittel', 'ml'),
  num('pag_oel', 'PAG-Öl', 'ml'),

  h('verbrauch_etc', 'Verbrauchsmaterial etc.'),
  tick('stickstoff', 'Stickstofffüllung (1025)'),
  tick('eisenmaterial', 'Eisenmaterial (Kleinmat.)'),
  txt('eisenmaterial_bemerkung', 'Bemerkung'),
  tick('reinigungsmaterial', 'Reinigungsmaterial (Kleinmat.)'),
  txt('reinigungsmaterial_bemerkung', 'Bemerkung'),
  tick('verbrauch_sonstiges', 'Sonstiges', { answer: 'text' }),
  tick('diesel', 'Dieselkraftstoff', { answer: 'number', unit: 'ltr.' }),
  tick('adblue', 'Adblue', { answer: 'number', unit: 'ltr.' }),

  h('werkzeuge', 'Werkzeuge etc.'),
  tick('motorbremse', 'Motorbremse (150..)'),
  num('motorbremse_ps', 'PS', 'PS'),
  tick('abdrehwerkzeug', 'Abdrehwerkzeug'),
  num('abdrehwerkzeug_nm', 'Nm', 'Nm'),
  tick('computer_diagnose', 'Computer Diagnose'),
  tick('spurvermessung', 'Spurvermessung'),
  tick('reifenmontiergeraet', 'Reifenmontiergerät'),
  num('reifenmontiergeraet_stk', 'Stk.', 'Stk.'),
  tick('altreifenentsorgung', 'Altreifenentsorgung (Altreifen)'),
  num('altreifen_stk', 'Stk.', 'Stk.'),
  tick('lichteinstellgeraet', 'Lichteinstellgerät'),
  tick('schweissen', 'Schweißen'),
  tick('werkzeuge_sonstiges', 'Sonstiges', { answer: 'text' }),

  h('pruefungen', 'Prüfungen etc.'),
  tick('uvv', 'UVV-Prüfung'),
  tick('hu_sp', 'HU / SP'),
  tick('abgas', 'Abgas-Prüfung'),
  tick('pruefungen_sonstiges', 'Sonstiges', { answer: 'text' }),

  h('betriebsstoffe', 'Verbrauchsmaterial (Öl, Gas, etc.)'),
  tick('motoroel', 'Motoröl'),
  choice('motoroel_auswahl', 'Auswahl Motoröl', OILS),
  num('motoroel_menge', 'Menge Motoröl', LST),
  tick('hydraulikoel', 'Getriebe- und Hydrauliköl'),
  choice('hydraulikoel_auswahl', 'Auswahl Getriebe- und Hydrauliköl', GEAR_OILS),
  num('hydraulikoel_menge', 'Menge Getriebe- und Hydrauliköl', LST),
  tick('hydraulikoel_1', 'Getriebe- und Hydrauliköl 1'),
  choice('hydraulikoel_1_auswahl', 'Auswahl Getriebe- und Hydrauliköl 1', GEAR_OILS),
  num('hydraulikoel_1_menge', 'Menge Getriebe- und Hydrauliköl 1', LST),
  tick('achsoel', 'Getriebe- und Achsöle'),
  choice('achsoel_auswahl', 'Auswahl Getriebe- und Achsöle', GEAR_OILS),
  num('achsoel_menge', 'Menge Getriebe- und Achsöle', LST),
  tick('achsoel_1', 'Getriebe- und Achsöle 1'),
  choice('achsoel_1_auswahl', 'Auswahl Getriebe- und Achsöle 1', GEAR_OILS),
  num('achsoel_1_menge', 'Menge Getriebe- und Achsöle 1', LST),
  tick('frostschutz', 'Frostschutz'),
  choice('frostschutz_auswahl', 'Auswahl Frostschutz', ANTIFREEZE),
  num('frostschutz_menge', 'Menge Frostschutz', LST),
  tick('scheibenfrostschutz', 'Scheibenfrostschutz'),
  num('scheibenfrostschutz_menge', 'Menge Scheibenfrostschutz', LST),
  tick('fette', 'Fette'),
  choice('fette_auswahl', 'Auswahl Fette', GREASE),
  num('fette_menge', 'Menge Fette', ['Kg', 'St.']),
  tick('verbrauch_sonstige', 'Verbrauchsmaterial Sonstige', { answer: 'text' }),
  num('verbrauch_sonstige_menge', 'Menge Verbrauchsmaterial Sonstige', LST),
  tick('verbrauch_sonstige_1', 'Verbrauchsmaterial Sonstige 1', { answer: 'text' }),
  num('verbrauch_sonstige_1_menge', 'Menge Verbrauchsmaterial Sonstige 1', LST),

  h('kulanz', 'Nur bei Kulanz- und Gewährleistungsaufträgen auszufüllen', ['GARANTIE', 'KULANZ']),
  tick('altteile', 'Altteile sauber eingelagert'),
  txt('regalfach', 'Regalfach'),
  tick('bilder_schaden', 'Bilder/Video vom Schaden'),
  txt('bilder_gesendet', 'Gesendet an'),
  tick('messungen_schaden', 'Messungen vom Schaden'),
  txt('messungen_gesendet', 'Gesendet an'),
  tick('kommunikation_hersteller', 'Nummer der Kommunikation mit dem Hersteller / Lieferanten', {
    answer: 'text',
  }),
  tick('schadensbauteil', 'Schadenverursachendes Bauteil'),
  txt('schadensbauteil_artikel', 'Artikel-Nr.'),

  h('reparaturende', 'Checkliste für das Reparaturende'),
  ...[
    'Alle Arbeiten ausgeführt und notiert ?',
    'Alle Betriebsstoffe kontrolliert und notiert?',
    'Alle Werkzeuge, Zusatzmaterialien etc. notiert ?',
    'Lichtanlage und Funktionen kontrolliert ?',
    'Fehlercodes notiert und Speicher zurückgesetzt ?',
    'Radmutter bzw. Schrauben nachgezogen ?',
    'Maschine von außen gereinigt ?',
    'Kabine von innen mindestens Besenrein ?',
    'Besonderheiten mit Werkstattleitung besprochen ?',
    'Arbeitsplatz aufgeräumt und gesäubert ?',
    'Zeiterfassung/Anwesenheit im System eingetragen ?',
    'Aufkleber nächster Kundendienst ?',
  ].map((text, i) => tick(`ende_${i + 1}`, text, { required: true })),
];
