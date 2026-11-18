import {
  DEFAULT_GUEST_GUIDELINES,
  DEFAULT_PADRINHOS_SLOTS,
  DEFAULT_SITE_SETTINGS,
} from '../data/defaults';
import { DressCodeColor, GuestGuidelineIcon, GuestGuidelineItem, PadrinhoEntry, SiteSettings } from '../types/wedding';

const VALID_GUIDELINE_ICONS: GuestGuidelineIcon[] = ['clock', 'smartphone', 'camera', 'heart', 'sparkles'];

export function normalizeVenueCityDisplay(rawCity?: string): string {
  const cleaned = (rawCity || '')
    .replace(/,?\s*CEP\s*\d{5}-?\d{3}/gi, '')
    .trim();
  return cleaned || DEFAULT_SITE_SETTINGS.venueCity;
}

export function resolveCeremonyPastor(rawPastor?: string): string {
  const clean = (rawPastor || '').trim();
  if (!clean) {
    return DEFAULT_SITE_SETTINGS.ceremonyPastor || 'Pr. Fabiano Paulo de Andrade';
  }
  return clean;
}

export function sanitizeDressCodeColors(items?: DressCodeColor[]): DressCodeColor[] {
  if (!Array.isArray(items)) return [];
  return items
    .slice(0, 16)
    .map((item, idx) => ({
      id: (item?.id || `color-${idx + 1}`).toString().slice(0, 80),
      name: (item?.name ?? '').toString().trim().slice(0, 60),
      hex: /^#[0-9a-fA-F]{3,8}$/.test((item?.hex || '').trim())
        ? item.hex.trim()
        : '#C6A46A',
    }));
}

export function sanitizeGuestGuidelines(items?: GuestGuidelineItem[]): GuestGuidelineItem[] {
  if (!Array.isArray(items)) return DEFAULT_GUEST_GUIDELINES;
  return items
    .slice(0, 10)
    .filter((item) => item && (item.title?.trim() || item.description?.trim()))
    .map((item, idx) => ({
      id: (item.id || `guide-${idx + 1}`).toString().slice(0, 80),
      title: (item.title || 'Orientação').trim().slice(0, 80),
      description: (item.description || '-').trim().slice(0, 400),
      icon: VALID_GUIDELINE_ICONS.includes(item.icon) ? item.icon : 'heart',
    }));
}

export function sanitizePadrinhos(items?: PadrinhoEntry[]): PadrinhoEntry[] {
  if (!Array.isArray(items)) return [];
  const seenIds = new Set<string>();
  const result: PadrinhoEntry[] = [];
  for (let idx = 0; idx < items.length && result.length < 30; idx++) {
    const item = items[idx];
    const side: PadrinhoEntry['side'] = item?.side === 'noivo' ? 'noivo' : 'noiva';
    let id = (item?.id || `padrinho-${side}-${idx + 1}`).toString().trim().slice(0, 80);
    if (!id) {
      id = `padrinho-${side}-${idx + 1}`;
    }
    if (seenIds.has(id)) {
      let suffix = 2;
      while (seenIds.has(`${id.slice(0, 72)}-${suffix}`)) {
        suffix += 1;
      }
      id = `${id.slice(0, 72)}-${suffix}`;
    }
    seenIds.add(id);
    result.push({
      id,
      side,
      name: (item?.name ?? '').toString().trim().slice(0, 120),
      published: item?.published !== false,
      order: Math.min(100, Math.max(1, Math.round(Number(item?.order) || idx + 1))),
    });
  }
  return result;
}

export function resolvePadrinhosList(items?: PadrinhoEntry[]): PadrinhoEntry[] {
  if (items === undefined || items === null) {
    return DEFAULT_PADRINHOS_SLOTS;
  }
  if (!Array.isArray(items)) {
    return DEFAULT_PADRINHOS_SLOTS;
  }
  return sanitizePadrinhos(items);
}

const VALID_PIX_KEY_TYPES: SiteSettings['pixKeyType'][] = [
  'cpf',
  'cnpj',
  'email',
  'phone',
  'evp',
  'unconfigured',
];

const VALID_PIX_PROVIDER_MODES: SiteSettings['pixProviderMode'][] = [
  'demo_unconfigured',
  'manual_pix',
  'webhook_provider',
];

function nonEmptyMin2(value: string | undefined, fallback: string, maxLen: number): string {
  const trimmed = (value ?? '').trim().slice(0, maxLen);
  return trimmed.length >= 2 ? trimmed : fallback;
}

/**
 * Strips any `undefined` properties and normalizes strings/lists to match firestore.rules strictly.
 */
export function sanitizeSiteSettingsForFirestore(raw: SiteSettings): Record<string, unknown> {
  const weddingDateIso = (raw.weddingDateIso ?? '').trim().slice(0, 40);
  const safePixKeyType = VALID_PIX_KEY_TYPES.includes(raw.pixKeyType)
    ? raw.pixKeyType
    : 'unconfigured';
  const safePixProviderMode = VALID_PIX_PROVIDER_MODES.includes(raw.pixProviderMode)
    ? raw.pixProviderMode
    : 'demo_unconfigured';

  const pixInstitution = (raw.pixInstitution ?? '').trim().slice(0, 80);

  return {
    coupleNames: nonEmptyMin2(raw.coupleNames, DEFAULT_SITE_SETTINGS.coupleNames, 100),
    weddingDateIso: weddingDateIso.length >= 4 ? weddingDateIso : DEFAULT_SITE_SETTINGS.weddingDateIso,
    weddingDateDisplay: (raw.weddingDateDisplay ?? DEFAULT_SITE_SETTINGS.weddingDateDisplay).trim().slice(0, 100),
    weddingTimeDisplay: (raw.weddingTimeDisplay ?? DEFAULT_SITE_SETTINGS.weddingTimeDisplay).trim().slice(0, 40),
    venueName: nonEmptyMin2(raw.venueName, DEFAULT_SITE_SETTINGS.venueName, 200),
    venueCity: nonEmptyMin2(normalizeVenueCityDisplay(raw.venueCity), DEFAULT_SITE_SETTINGS.venueCity, 120),
    venueCep: (raw.venueCep ?? DEFAULT_SITE_SETTINGS.venueCep ?? '').trim().slice(0, 20),
    venueStreetAddress: (raw.venueStreetAddress ?? '').trim().slice(0, 240),
    venueCoordinates: (raw.venueCoordinates ?? '').trim().slice(0, 80),
    venueMapUrl: (raw.venueMapUrl ?? '').trim().slice(0, 500),
    venuePhotoUrl: (raw.venuePhotoUrl ?? '').trim().slice(0, 600),
    ceremonyPastor: (raw.ceremonyPastor ?? DEFAULT_SITE_SETTINGS.ceremonyPastor ?? '').trim().slice(0, 120),
    ceremonyPlanner: (raw.ceremonyPlanner ?? DEFAULT_SITE_SETTINGS.ceremonyPlanner ?? '').trim().slice(0, 120),
    dressCodeImageUrl: (raw.dressCodeImageUrl ?? '').trim().slice(0, 600),
    dressCodeColors: sanitizeDressCodeColors(raw.dressCodeColors),
    dressCodeMessage: (raw.dressCodeMessage ?? DEFAULT_SITE_SETTINGS.dressCodeMessage ?? '').trim().slice(0, 600),
    guestGuidelines: sanitizeGuestGuidelines(raw.guestGuidelines),
    padrinhos: sanitizePadrinhos(raw.padrinhos),
    publicShareUrl: (raw.publicShareUrl ?? '').trim().slice(0, 200),
    heroQuote: nonEmptyMin2(raw.heroQuote, DEFAULT_SITE_SETTINGS.heroQuote, 400),
    storyIntro: (raw.storyIntro ?? '').trim().slice(0, 1500),
    giftIntroMessage: nonEmptyMin2(raw.giftIntroMessage, DEFAULT_SITE_SETTINGS.giftIntroMessage, 500),
    rsvpDeadlineIso: (raw.rsvpDeadlineIso ?? '').trim().slice(0, 40),
    rsvpMaxGuestsPerSubmission: Math.min(15, Math.max(1, Math.round(Number(raw.rsvpMaxGuestsPerSubmission) || 6))),
    giftReservationExpiryMinutes: Math.min(10080, Math.max(5, Math.round(Number(raw.giftReservationExpiryMinutes) || 60))),
    pixEnabled: Boolean(raw.pixEnabled),
    pixKey: (raw.pixKey ?? '').trim().slice(0, 140),
    pixKeyType: safePixKeyType,
    pixBeneficiaryName: (raw.pixBeneficiaryName ?? '').trim().slice(0, 80),
    ...(pixInstitution ? { pixInstitution } : {}),
    pixCity: (raw.pixCity ?? '').trim().slice(0, 40),
    pixProviderMode: safePixProviderMode,
    goalAmountCents: Math.max(0, Math.round(Number(raw.goalAmountCents) || 0)),
    goalTitle: (raw.goalTitle ?? '').trim().slice(0, 140),
    lgpdContactEmail: (raw.lgpdContactEmail ?? '').trim().slice(0, 160),
  };
}

const CORE_LEGACY_SITE_SETTINGS_KEYS = [
  'coupleNames',
  'weddingDateIso',
  'weddingDateDisplay',
  'weddingTimeDisplay',
  'venueName',
  'venueCity',
  'venueStreetAddress',
  'venueCoordinates',
  'venueMapUrl',
  'venuePhotoUrl',
  'publicShareUrl',
  'heroQuote',
  'storyIntro',
  'giftIntroMessage',
  'rsvpDeadlineIso',
  'rsvpMaxGuestsPerSubmission',
  'giftReservationExpiryMinutes',
  'pixEnabled',
  'pixKey',
  'pixKeyType',
  'pixBeneficiaryName',
  'pixCity',
  'pixProviderMode',
  'goalAmountCents',
  'goalTitle',
  'lgpdContactEmail',
] as const;

export function pickCoreSiteSettingsForLegacyRules(
  sanitized: Record<string, unknown>
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of CORE_LEGACY_SITE_SETTINGS_KEYS) {
    if (key in sanitized) {
      result[key] = sanitized[key];
    }
  }
  return result;
}

export interface SanitizedPixSettingsPatch {
  pixEnabled: boolean;
  pixKey: string;
  pixKeyType: SiteSettings['pixKeyType'];
  pixBeneficiaryName: string;
  pixInstitution?: string;
  pixCity: string;
  pixProviderMode: SiteSettings['pixProviderMode'];
  giftReservationExpiryMinutes: number;
}

export function sanitizePixSettingsPatch(
  raw: SiteSettings,
  options: { includeEmptyInstitution?: boolean } = {}
): SanitizedPixSettingsPatch {
  const safePixKeyType = VALID_PIX_KEY_TYPES.includes(raw.pixKeyType)
    ? raw.pixKeyType
    : 'unconfigured';
  const safePixProviderMode = VALID_PIX_PROVIDER_MODES.includes(raw.pixProviderMode)
    ? raw.pixProviderMode
    : 'demo_unconfigured';
  const pixInstitution = (raw.pixInstitution ?? '').trim().slice(0, 80);

  return {
    pixEnabled: Boolean(raw.pixEnabled),
    pixKey: (raw.pixKey ?? '').trim().slice(0, 140),
    pixKeyType: safePixKeyType,
    pixBeneficiaryName: (raw.pixBeneficiaryName ?? '').trim().slice(0, 80),
    ...(pixInstitution || options.includeEmptyInstitution ? { pixInstitution } : {}),
    pixCity: (raw.pixCity ?? '').trim().slice(0, 40),
    pixProviderMode: safePixProviderMode,
    giftReservationExpiryMinutes: Math.min(
      10080,
      Math.max(5, Math.round(Number(raw.giftReservationExpiryMinutes) || 60))
    ),
  };
}

export function sanitizeGeneralSettingsPatch(raw: SiteSettings): Record<string, unknown> {
  return {
    venueStreetAddress: (raw.venueStreetAddress ?? '').trim().slice(0, 240),
    venueCoordinates: (raw.venueCoordinates ?? '').trim().slice(0, 80),
    venueMapUrl: (raw.venueMapUrl ?? '').trim().slice(0, 500),
    venuePhotoUrl: (raw.venuePhotoUrl ?? '').trim().slice(0, 600),
    rsvpDeadlineIso: (raw.rsvpDeadlineIso ?? '').trim().slice(0, 40),
    rsvpMaxGuestsPerSubmission: Math.min(
      15,
      Math.max(1, Math.round(Number(raw.rsvpMaxGuestsPerSubmission) || 6))
    ),
    lgpdContactEmail: (raw.lgpdContactEmail ?? '').trim().slice(0, 160),
    goalTitle: (raw.goalTitle ?? '').trim().slice(0, 140),
    goalAmountCents: Math.max(0, Math.round(Number(raw.goalAmountCents) || 0)),
    heroQuote: nonEmptyMin2(raw.heroQuote, DEFAULT_SITE_SETTINGS.heroQuote, 400),
    giftIntroMessage: nonEmptyMin2(raw.giftIntroMessage, DEFAULT_SITE_SETTINGS.giftIntroMessage, 500),
  };
}
