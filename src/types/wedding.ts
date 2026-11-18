export type GiftCategory =
  | 'Cozinha & Mesa'
  | 'Cama, Mesa & Banho'
  | 'Eletrodomésticos'
  | 'Decoração & Conforto'
  | 'Momentos a dois'
  | 'Lua de mel'
  | 'Contribuições especiais'
  | 'Nossa casa';

export type GiftType = 'full' | 'quota' | 'symbolic';

export type PixKeyType = 'cpf' | 'cnpj' | 'email' | 'phone' | 'evp' | 'unconfigured';

export type PixProviderMode = 'demo_unconfigured' | 'manual_pix' | 'webhook_provider';

export interface DressCodeColor {
  id: string;
  name: string;
  hex: string;
}

export type GuestGuidelineIcon = 'clock' | 'smartphone' | 'camera' | 'heart' | 'sparkles';

export interface GuestGuidelineItem {
  id: string;
  title: string;
  description: string;
  icon: GuestGuidelineIcon;
}

export type PadrinhoSide = 'noiva' | 'noivo';

export interface PadrinhoEntry {
  id: string;
  side: PadrinhoSide;
  name: string;
  published: boolean;
  order: number;
}

export interface SiteSettings {
  coupleNames: string;
  weddingDateIso: string;
  weddingDateDisplay: string;
  weddingTimeDisplay: string;
  venueName: string;
  venueCity: string;
  venueCep?: string;
  venueStreetAddress: string;
  venueCoordinates: string;
  venueMapUrl: string;
  venuePhotoUrl?: string;
  ceremonyPastor?: string;
  ceremonyPlanner?: string;
  dressCodeImageUrl?: string;
  dressCodeColors?: DressCodeColor[];
  dressCodeMessage?: string;
  guestGuidelines?: GuestGuidelineItem[];
  padrinhos?: PadrinhoEntry[];
  publicShareUrl: string;
  heroQuote: string;
  storyIntro: string;
  giftIntroMessage: string;
  rsvpDeadlineIso: string;
  rsvpMaxGuestsPerSubmission: number;
  giftReservationExpiryMinutes: number;
  pixEnabled: boolean;
  pixKey: string;
  pixKeyType: PixKeyType;
  pixBeneficiaryName: string;
  pixInstitution?: string;
  pixCity: string;
  pixProviderMode: PixProviderMode;
  goalAmountCents: number;
  goalTitle: string;
  lgpdContactEmail: string;
  updatedAt?: unknown;
}

export interface TimelineEvent {
  id: string;
  dateLabel: string;
  subtitle?: string;
  title: string;
  description: string;
  imageUrl?: string;
  galleryUrls?: string[];
  order: number;
  isDemoExample: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface GiftItem {
  id: string;
  title: string;
  description: string;
  category: GiftCategory;
  priceCents: number;
  imageUrl?: string;
  giftType: GiftType;
  totalQuotas: number;
  reservedQuotas: number;
  paidQuotas: number;
  desiredUnits?: number;
  quotasPerUnit?: number;
  sortOrder?: number;
  active: boolean;
  featured: boolean;
  isDemoExample: boolean;
  needsPhotoReview?: boolean;
  photoSource?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export type GiftOrderStatus =
  | 'reserved'
  | 'awaiting_confirmation'
  | 'confirmed'
  | 'expired'
  | 'cancelled';

export type GiftOrderPaymentMethod =
  | 'pix_manual'
  | 'pix_webhook'
  | 'mercadopago_card'
  | 'demo_preview';

export interface GiftOrderItemSnapshot {
  giftId: string;
  title: string;
  quotas: number;
  unitPriceCents: number;
  totalCents: number;
}

export interface GiftOrder {
  id: string;
  giftId?: string;
  giftTitle: string;
  itemsSnapshot?: GiftOrderItemSnapshot[];
  isCustomAmount: boolean;
  quotas: number;
  amountCents: number;
  giverName: string;
  giverContact: string;
  messageToCouple?: string;
  status: GiftOrderStatus;
  paymentMethod: GiftOrderPaymentMethod;
  orderTokenHash: string;
  idempotencyKey?: string;
  mpOrderId?: string;
  mpPaymentId?: string;
  mpTransactionStatus?: string;
  mpStatusDetail?: string;
  mpPaymentType?: string;
  mpCheckoutUrl?: string;
  receiptProofHash?: string;
  receiptNote?: string;
  receiptPath?: string;
  lgpdConsent: boolean;
  expiresAtIso?: string;
  confirmedAtIso?: string;
  adminArchived?: boolean;
  adminArchivedAtIso?: string;
  adminArchivedBy?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export type RsvpStatus = 'pending_review' | 'approved' | 'declined' | 'needs_adjustment';

export interface RsvpRecord {
  id: string;
  responsibleName: string;
  contact: string;
  attending: boolean;
  attendeesCount: number;
  attendeeNames: string[];
  notes?: string;
  status: RsvpStatus;
  editTokenHash: string;
  lgpdConsent: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface RsvpRevision {
  id: string;
  rsvpId: string;
  tokenHash: string;
  attending: boolean;
  attendeesCount: number;
  attendeeNames: string[];
  notes?: string;
  reviewStatus: 'pending' | 'applied' | 'rejected';
  createdAt?: unknown;
}

export type ModerationStatus = 'pending' | 'approved' | 'rejected';

export interface GuestbookMessage {
  id: string;
  authorName: string;
  relationship?: string;
  message: string;
  status: ModerationStatus;
  consentToPublish: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface GalleryAlbum {
  id: string;
  title: string;
  description?: string;
  allowGuestUploads: boolean;
  order: number;
  createdAt?: unknown;
}

export interface GalleryPhoto {
  id: string;
  albumId: string;
  imageUrl: string;
  caption?: string;
  uploadedBy: string;
  sizeBytes: number;
  status: ModerationStatus;
  consentToPublish: boolean;
  isPlaceholder?: boolean;
  createdAt?: unknown;
}

export interface CoverflowPhoto {
  id: string;
  imageUrl: string;
  caption?: string;
  order: number;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export type FaqCategory = 'RSVP' | 'Presentes' | 'Horários' | 'Crianças' | 'Cerimônia' | 'Geral';

export interface FaqItem {
  id: string;
  category: FaqCategory;
  question: string;
  answer: string;
  order: number;
  isDemoExample: boolean;
  updatedAt?: unknown;
}

export interface AdminLog {
  id: string;
  actorUid: string;
  actorEmail?: string;
  action: string;
  details: string;
  createdAt?: unknown;
}

export interface CartItem {
  gift: GiftItem;
  quotas: number;
  customAmountCents?: number;
}

export interface CeremonyChurchInfo {
  name: string;
  city: string;
  cep: string;
  streetAddress: string;
  coordinates: string;
  mapUrl: string;
  photoUrl: string;
  dateDisplay: string;
  timeDisplay: string;
  pastor: string;
  planner: string;
}

export interface CeremonyPublicData {
  version: number;
  updatedAt: string;
  updatedBy?: string;
  church: CeremonyChurchInfo;
  bridesmaids: PadrinhoEntry[];
  groomsmen: PadrinhoEntry[];
}

