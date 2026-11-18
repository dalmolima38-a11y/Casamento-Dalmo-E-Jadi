export function formatBRL(cents: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(cents / 100);
}

export function generateRandomToken(byteLength = 16): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer), (b) => b.toString(16).padStart(2, '0')).join('');
}

function normalizeAscii(str: string, maxLen: number): string {
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9 \-.]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
}

export function normalizePixTxid(raw?: string): string {
  const cleaned = (raw || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .slice(0, 25);
  return cleaned || 'CASAMENTO';
}

function tlv(id: string, value: string): string {
  const len = String(value.length).padStart(2, '0');
  return `${id}${len}${value}`;
}

export function crc16Ccitt(payload: string): string {
  let crc = 0xffff;
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      if ((crc & 0x8000) !== 0) {
        crc = ((crc << 1) ^ 0x1021) & 0xffff;
      } else {
        crc = (crc << 1) & 0xffff;
      }
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

export function verifyPixBrCodeCrc(brCode: string): boolean {
  if (!brCode || brCode.length < 12) return false;
  const crcMarkerIdx = brCode.lastIndexOf('6304');
  if (crcMarkerIdx === -1 || crcMarkerIdx + 8 !== brCode.length) return false;
  const bodyWithMarker = brCode.slice(0, crcMarkerIdx + 4);
  const providedCrc = brCode.slice(crcMarkerIdx + 4).toUpperCase();
  return crc16Ccitt(bodyWithMarker) === providedCrc;
}

export type PixKeyValidationType = 'cpf' | 'cnpj' | 'email' | 'phone' | 'evp' | 'unconfigured';

function isValidCpfDigits(digits: string): boolean {
  if (!/^\d{11}$/.test(digits) || /^(\d)\1{10}$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(digits[i]) * (10 - i);
  let check1 = (sum * 10) % 11;
  if (check1 === 10) check1 = 0;
  if (check1 !== Number(digits[9])) return false;

  sum = 0;
  for (let i = 0; i < 10; i++) sum += Number(digits[i]) * (11 - i);
  let check2 = (sum * 10) % 11;
  if (check2 === 10) check2 = 0;
  return check2 === Number(digits[10]);
}

function isValidCnpjDigits(digits: string): boolean {
  if (!/^\d{14}$/.test(digits) || /^(\d)\1{13}$/.test(digits)) return false;
  const weights1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const weights2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(digits[i]) * weights1[i];
  let rem = sum % 11;
  const d1 = rem < 2 ? 0 : 11 - rem;
  if (d1 !== Number(digits[12])) return false;

  sum = 0;
  for (let i = 0; i < 13; i++) sum += Number(digits[i]) * weights2[i];
  rem = sum % 11;
  const d2 = rem < 2 ? 0 : 11 - rem;
  return d2 === Number(digits[13]);
}

export function validatePixConfiguration(input: {
  pixEnabled?: boolean;
  pixKey?: string;
  pixKeyType?: PixKeyValidationType;
  pixBeneficiaryName?: string;
  pixCity?: string;
}): {
  valid: boolean;
  normalizedKey: string;
  reason?: string;
} {
  if (input.pixEnabled === false) {
    return { valid: false, normalizedKey: '', reason: 'O recebimento via Pix está desativado nas configurações.' };
  }

  const rawKey = (input.pixKey || '').trim();
  const keyType = input.pixKeyType || 'unconfigured';

  if (keyType === 'unconfigured' || !rawKey) {
    return {
      valid: false,
      normalizedKey: '',
      reason: 'A chave Pix oficial dos noivos ainda não foi configurada no painel administrativo.',
    };
  }

  let normalizedKey = rawKey;

  if (keyType === 'cpf') {
    const digits = rawKey.replace(/\D/g, '');
    if (!isValidCpfDigits(digits)) {
      return { valid: false, normalizedKey: '', reason: 'A chave Pix (CPF) configurada é inválida.' };
    }
    normalizedKey = digits;
  } else if (keyType === 'cnpj') {
    const digits = rawKey.replace(/\D/g, '');
    if (!isValidCnpjDigits(digits)) {
      return { valid: false, normalizedKey: '', reason: 'A chave Pix (CNPJ) configurada é inválida.' };
    }
    normalizedKey = digits;
  } else if (keyType === 'email') {
    const cleanEmail = rawKey.toLowerCase();
    if (cleanEmail.length > 77 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      return { valid: false, normalizedKey: '', reason: 'A chave Pix (e-mail) configurada é inválida.' };
    }
    normalizedKey = cleanEmail;
  } else if (keyType === 'phone') {
    const stripped = rawKey.replace(/[^\d+]/g, '');
    const digitsOnly = stripped.replace(/\D/g, '');
    if (stripped.startsWith('+')) {
      if (digitsOnly.length < 11 || digitsOnly.length > 15) {
        return { valid: false, normalizedKey: '', reason: 'A chave Pix (telefone) deve estar no formato +55DDDNÚMERO.' };
      }
      normalizedKey = `+${digitsOnly}`;
    } else if (digitsOnly.length === 10 || digitsOnly.length === 11) {
      normalizedKey = `+55${digitsOnly}`;
    } else if (digitsOnly.length >= 12 && digitsOnly.length <= 13 && digitsOnly.startsWith('55')) {
      normalizedKey = `+${digitsOnly}`;
    } else {
      return { valid: false, normalizedKey: '', reason: 'A chave Pix (telefone) configurada é inválida.' };
    }
  } else if (keyType === 'evp') {
    const cleanUuid = rawKey.toLowerCase();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(cleanUuid)) {
      return { valid: false, normalizedKey: '', reason: 'A chave Pix aleatória (EVP) configurada é inválida.' };
    }
    normalizedKey = cleanUuid;
  }

  const beneficiary = normalizeAscii(input.pixBeneficiaryName || '', 25);
  if (beneficiary.length < 2) {
    return {
      valid: false,
      normalizedKey: '',
      reason: 'O nome do beneficiário Pix ainda não foi configurado corretamente.',
    };
  }

  const city = normalizeAscii(input.pixCity || '', 15);
  if (city.length < 2) {
    return {
      valid: false,
      normalizedKey: '',
      reason: 'A cidade do beneficiário Pix ainda não foi configurada corretamente.',
    };
  }

  return {
    valid: true,
    normalizedKey,
  };
}

export interface PixPayloadInput {
  pixKey: string;
  pixKeyType?: PixKeyValidationType;
  beneficiaryName: string;
  city: string;
  amountCents?: number;
  txid?: string;
  description?: string;
}

/**
 * Generates an official EMVCo / Banco Central do Brasil Pix BR Code ("Pix Copia e Cola").
 * Returns null if pixKey is empty or unconfigured so fake Pix codes are never generated.
 */
export function buildPixBrCode(input: PixPayloadInput): string | null {
  const keyToUse =
    input.pixKeyType && input.pixKeyType !== 'unconfigured'
      ? (() => {
          const check = validatePixConfiguration({
            pixEnabled: true,
            pixKey: input.pixKey,
            pixKeyType: input.pixKeyType,
            pixBeneficiaryName: input.beneficiaryName,
            pixCity: input.city,
          });
          return check.valid ? check.normalizedKey : '';
        })()
      : input.pixKey.trim();

  if (!keyToUse) return null;

  const cleanDesc = input.description ? normalizeAscii(input.description, 40) : '';
  const merchantAccountSub =
    tlv('00', 'br.gov.bcb.pix') +
    tlv('01', keyToUse.slice(0, 77)) +
    (cleanDesc ? tlv('02', cleanDesc) : '');

  const name = normalizeAscii(input.beneficiaryName || '', 25).toUpperCase() || 'NOIVOS';
  const city = normalizeAscii(input.city || '', 15).toUpperCase() || 'BRASIL';
  const txid = normalizePixTxid(input.txid);

  let payload = '';
  payload += tlv('00', '01');
  payload += tlv('26', merchantAccountSub);
  payload += tlv('52', '0000');
  payload += tlv('53', '986');
  if (input.amountCents && input.amountCents >= 100) {
    payload += tlv('54', (input.amountCents / 100).toFixed(2));
  }
  payload += tlv('58', 'BR');
  payload += tlv('59', name);
  payload += tlv('60', city);
  payload += tlv('62', tlv('05', txid));
  payload += '6304';

  const checksum = crc16Ccitt(payload);
  return `${payload}${checksum}`;
}

export function formatPixKeyTypeLabel(type?: PixKeyValidationType): string {
  switch (type) {
    case 'cpf':
      return 'CPF';
    case 'cnpj':
      return 'CNPJ';
    case 'email':
      return 'E-mail';
    case 'phone':
      return 'Celular';
    case 'evp':
      return 'Chave aleatória (EVP)';
    default:
      return 'Chave Pix';
  }
}

export const PIX_IDENTIFIER_STORAGE_KEY = 'nps_pix_identifier_label_v1';
export const DEFAULT_PIX_IDENTIFIER_LABEL = 'Casamento Dalmo & Jadi';

export function getSavedPixIdentifierLabel(): string {
  if (typeof window === 'undefined') return DEFAULT_PIX_IDENTIFIER_LABEL;
  try {
    const raw = window.localStorage.getItem(PIX_IDENTIFIER_STORAGE_KEY);
    const cleaned = (raw || '').trim();
    return cleaned || DEFAULT_PIX_IDENTIFIER_LABEL;
  } catch {
    return DEFAULT_PIX_IDENTIFIER_LABEL;
  }
}

export function savePixIdentifierLabel(label: string): string {
  const cleaned = label.trim().slice(0, 60) || DEFAULT_PIX_IDENTIFIER_LABEL;
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(PIX_IDENTIFIER_STORAGE_KEY, cleaned);
    } catch {
      // ignore storage errors
    }
  }
  return cleaned;
}

export function downloadCsv(
  filename: string,
  headers: string[],
  rows: (string | number | boolean)[][]
): void {
  const escape = (val: string | number | boolean) => {
    const str = String(val ?? '');
    return `"${str.replace(/"/g, '""')}"`;
  };
  const csvContent =
    '\uFEFF' +
    [headers.map(escape).join(','), ...rows.map((r) => r.map(escape).join(','))].join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
