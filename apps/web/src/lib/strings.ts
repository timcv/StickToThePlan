/**
 * Centralised Swedish UI copy. Keeping labels, tooltip texts and the short
 * inline help rows in one place keeps terminology consistent across the form
 * and the result tables, and leaves a single seam for a future language toggle.
 */

/** Tooltip (ⓘ) and optional inline help text for a form field. */
export interface FieldHelp {
  /** Longer explanation shown in the ⓘ tooltip / popover. */
  tip: string;
  /** Short format/consequence hint shown directly under the input. */
  help?: string;
}

/** Field help texts, from the UX review's ⓘ table. */
export const FIELD_HELP: Record<string, FieldHelp> = {
  target: {
    tip: 'Din totala måltid inklusive planerade stopp. Exempel: 11:45 betyder 11 timmar och 45 minuter.',
    help: 'Inklusive planerade stopp.',
  },
  startTime: {
    tip: 'Din faktiska starttid. Används för att räkna ut ankomst- och avgångstider vid kontroller.',
    help: 'Används för ankomsttider i splitplan och styrkort.',
  },
  ftp: {
    tip: 'Din funktionella tröskeleffekt i watt. Använd ditt kända FTP-värde. Om du är osäker kan du börja med standardvärdet och justera senare.',
    help: 'Om du är osäker, börja med standardvärdet.',
  },
  riders: {
    tip: 'Antal cyklister som hjälps åt. Fler cyklister ger mer draghjälp och kan påverka beräknad fart och effekt.',
  },
  mass: {
    tip: 'Total vikt för cyklist, cykel, kläder, flaskor och packning. Ett ungefärligt värde räcker.',
  },
  watchTarget: {
    tip: 'Välj vad klockan ska guida dig mot: effekt när du ligger i dragläge eller gruppens genomsnitt.',
  },
  raceDate: {
    tip: 'Används för att hämta relevant väderprognos när vindjustering är aktiverad.',
  },
  maxRows: {
    tip: 'Begränsar antalet rader i det utskrivbara styrkortet så att det blir lättare att läsa på cykeln.',
    help: 'Lägre värde ger ett kortare, mer lättläst kort.',
  },
  gpx: {
    tip: 'Ruttfilen används för distans, höjdprofil och delsträckor. Standardrutten är redan inläst.',
  },
  fit: {
    tip: 'Valfri fil från en tidigare cykling. Används för att göra effektmålen mer personliga.',
  },
  weather: {
    tip: 'Välj lugnt väder för en förenklad plan eller väderprognos för vindjusterad pacing.',
  },
  terrain: {
    tip: 'Hur öppet landskapet är längs rutten. Öppna fält ger mer vind vid marken, skog och bebyggelse bromsar den. Påverkar hur mycket 10 m-prognosen räknas ned till vad du faktiskt möter.',
    help: 'Används när detaljerad exponering saknas för rutten.',
  },
};

/**
 * Tooltip copy for terms that show up in the result tables and summary (not
 * form fields). Same shape as FIELD_HELP so the InfoTip component is reused.
 */
export const TERM_HELP: Record<string, FieldHelp> = {
  effectiveWind: {
    tip: 'Vinden modellen tror att du faktiskt möter vid marken, lägre än 10 m-prognosen, justerad för hur öppet landskapet är.',
  },
  np: {
    tip: 'Normalized Power: ett viktat effektsnitt som speglar den fysiologiska belastningen bättre än rena medeleffekten. Mål-NP är effekten planen siktar på.',
  },
  if: {
    tip: 'Intensitetsfaktor: förar-NP delat med din FTP. 1,0 betyder att du kör på tröskeln. Lägre är mer uthålligt.',
  },
  spann: {
    tip: 'Tiden är ingen exakt prognos. Spannet visar rimlig variation från vind och exponering.',
  },
};
