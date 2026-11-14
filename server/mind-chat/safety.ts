/**
 * Response validation and safety handling around the model. Deterministic rules
 * only: they never generate a reply on the model's behalf.
 */

export type Concern = 'none' | 'urgent';

const URGENT_PATTERNS: RegExp[] = [
  /\b(kill|hurt|harm|cut)\s+(myself|me)\b/i,
  /\bsuicid(e|al)\b/i,
  /\b(end|take)\s+(my|my own)\s+life\b/i,
  /\b(don'?t|do not)\s+want\s+to\s+(live|be alive|exist|wake up)\b/i,
  /\bwant\s+to\s+die\b/i,
  /\bbetter\s+off\s+dead\b/i,
  /\bno\s+(reason|point)\s+(to|in)\s+(live|living|going on)\b/i,
  /\bself[-\s]?harm\b/i,
  /\b(kill|hurt|harm)\s+(him|her|them|someone|somebody|a crewmate|my crewmate|the crew)\b/i,
  /\bI\s*(?:'m|am)\s+not\s+safe\b|\bI\s+(?:don'?t|do not)\s+feel\s+safe\b/i,
];

/** Classify an astronaut message. Used to steer the model and add the support notice. */
export function assessMessage(text: string): Concern {
  return URGENT_PATTERNS.some((p) => p.test(text)) ? 'urgent' : 'none';
}

/**
 * Shown alongside the model's reply when a message may describe a risk of harm. It
 * is labelled as an AEGIS notice, not model output, and promises nothing that does
 * not exist: no one is alerted automatically.
 */
export const SUPPORT_NOTICE =
  'If you are thinking about harming yourself or someone else, or you feel unsafe, please contact the flight surgeon or crew medical officer now, or tell a crewmate you trust. AEGIS Mind Companion is an AI and does not alert anyone automatically.';

const FORBIDDEN_CLAIMS: RegExp[] = [
  /\bI\s*(am|'m)\s+(a|your)\s+(licensed|certified|qualified|registered)?\s*(human\s+)?(therapist|psychotherapist|psychologist|psychiatrist|counsell?or|doctor|physician|clinician)\b/i,
  /\bas\s+your\s+(therapist|psychotherapist|psychologist|psychiatrist|counsell?or|doctor)\b/i,
  /\bI\s*(am|'m)\s+(a\s+)?human\b/i,
  /\bI\s+(diagnose|am diagnosing)\b/i,
  /\byou\s+(have|are suffering from)\s+(clinical\s+)?(depression|bipolar|ptsd|an?\s+anxiety disorder|schizophrenia|a\s+personality disorder)\b/i,
  /\btake\s+\d+(\.\d+)?\s*(mg|milligrams?|ml|tablets?|pills?)\b/i,
  /\bI\s*(have|'ve)\s+(alerted|notified|contacted|informed)\b/i,
  /\bhelp\s+is\s+on\s+(the|its)\s+way\b/i,
];

export type Validation =
  { ok: true; content: string } | { ok: false; reason: 'empty' | 'forbidden_claim' };

/** Check a model reply before it is stored or shown. */
export function validateReply(raw: string): Validation {
  const content = raw
    .replace(/^\s*(assistant|aegis mind companion)\s*:\s*/i, '')
    .replace(/<\/?(start_of_turn|end_of_turn)>|<(start|end)_of_turn>(model|user)?/g, '')
    .trim();
  if (!content) return { ok: false, reason: 'empty' };
  if (FORBIDDEN_CLAIMS.some((p) => p.test(content)))
    return { ok: false, reason: 'forbidden_claim' };
  return { ok: true, content };
}
