import React, { useEffect, useState } from 'react';
import { Check, CheckCircle2, Copy, CreditCard, Save, Shield, UserPlus } from 'lucide-react';
import {
  doc,
  getDocFromServer,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { useWedding } from '../../context/WeddingContext';
import { db, handleFirestoreError, OperationType } from '../../lib/firebase';
import {
  DEFAULT_PIX_IDENTIFIER_LABEL,
  generateRandomToken,
  getSavedPixIdentifierLabel,
  savePixIdentifierLabel,
  validatePixConfiguration,
} from '../../lib/pix';
import {
  pickCoreSiteSettingsForLegacyRules,
  sanitizeGeneralSettingsPatch,
  sanitizePixSettingsPatch,
  sanitizeSiteSettingsForFirestore,
} from '../../lib/settingsSanitizer';
import { PixKeyType, PixProviderMode, SiteSettings } from '../../types/wedding';

interface MpReadinessState {
  configured: boolean;
  publicKeyConfigured?: boolean;
  publicKeyError?: string;
  publicKeyModeMismatch?: boolean;
  cardBrickReady?: boolean;
  testMode: boolean;
  liveMode: boolean;
  effectiveWebhookUrl?: string;
  currentOriginWebhookUrl?: string;
  isPreviewOrigin?: boolean;
  webhookSecretConfigured: boolean;
  webhookSecretRequired?: boolean;
  serviceAccountConfigured: boolean;
  adcAvailable?: boolean;
  firebaseAuthMode?: 'service_account_json' | 'adc' | 'none';
  firestoreReady?: boolean;
  runtimeServiceAccountEmail?: string;
  firebaseProjectId?: string;
}

export const AdminSettingsTab: React.FC = () => {
  const { settings, user, isAdmin } = useWedding();
  const [form, setForm] = useState<SiteSettings>(settings);
  const [pixIdentifierLabel, setPixIdentifierLabel] = useState<string>(() =>
    getSavedPixIdentifierLabel()
  );
  const [pixValidationError, setPixValidationError] = useState<string | null>(null);
  const [pixSaveError, setPixSaveError] = useState<string | null>(null);
  const [savingPix, setSavingPix] = useState(false);
  const [savedPixOk, setSavedPixOk] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedOk, setSavedOk] = useState(false);
  const [mpReadiness, setMpReadiness] = useState<MpReadinessState | null>(null);
  const [copiedWebhook, setCopiedWebhook] = useState(false);

  const [coAdminUid, setCoAdminUid] = useState('');
  const [coAdminEmail, setCoAdminEmail] = useState('');
  const [coAdminMsg, setCoAdminMsg] = useState<string | null>(null);

  useEffect(() => {
    setForm(settings);
  }, [settings]);

  useEffect(() => {
    let active = true;
    fetch('/api/mercadopago/status')
      .then((r) => r.json())
      .then((data) => {
        if (active && typeof data?.configured === 'boolean') {
          setMpReadiness(data as MpReadinessState);
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const writeAuditLog = async (action: string, details: string) => {
    if (!user) return;
    try {
      await setDoc(doc(db, 'admin_logs', `log_${generateRandomToken(6)}`), {
        actorUid: user.uid,
        actorEmail: user.email || '',
        action,
        details,
        createdAt: serverTimestamp(),
      });
    } catch (logErr) {
      try {
        handleFirestoreError(logErr, OperationType.CREATE, 'admin_logs');
      } catch {
        // Non-blocking audit log error after site_settings/main succeeded
      }
    }
  };

  const handleSavePixSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setPixValidationError(null);
    setPixSaveError(null);
    setSavedPixOk(false);

    if (!isAdmin) {
      setPixSaveError('Apenas administradores autenticados podem alterar os dados bancários do Pix.');
      return;
    }

    const trimmedBeneficiary = form.pixBeneficiaryName.trim();
    const trimmedCity = form.pixCity.trim();
    const trimmedInstitution = (form.pixInstitution ?? '').trim();
    const hasPixKeyAttempt =
      form.pixEnabled || form.pixKeyType !== 'unconfigured' || form.pixKey.trim().length > 0;

    let nextPixState: SiteSettings = {
      ...form,
      pixBeneficiaryName: trimmedBeneficiary,
      pixInstitution: trimmedInstitution,
      pixCity: trimmedCity,
    };

    if (hasPixKeyAttempt) {
      if (form.pixKeyType === 'unconfigured') {
        setPixValidationError('Selecione o tipo da chave Pix correspondente antes de salvar.');
        return;
      }
      if (trimmedBeneficiary.length < 2) {
        setPixValidationError('Informe o nome completo do titular da conta Pix.');
        return;
      }
      if (trimmedCity.length < 2) {
        setPixValidationError('Informe a cidade do recebedor Pix.');
        return;
      }
      const pixCheck = validatePixConfiguration({
        pixEnabled: true,
        pixKey: form.pixKey,
        pixKeyType: form.pixKeyType,
        pixBeneficiaryName: trimmedBeneficiary,
        pixCity: trimmedCity,
      });
      if (!pixCheck.valid) {
        setPixValidationError(pixCheck.reason || 'Revise os dados de recebimento via Pix.');
        return;
      }
      nextPixState = {
        ...nextPixState,
        pixKey: pixCheck.normalizedKey,
        pixProviderMode:
          nextPixState.pixProviderMode === 'demo_unconfigured'
            ? 'manual_pix'
            : nextPixState.pixProviderMode,
      };
    }

    setSavingPix(true);
    try {
      const savedLabel = savePixIdentifierLabel(
        pixIdentifierLabel || DEFAULT_PIX_IDENTIFIER_LABEL
      );
      setPixIdentifierLabel(savedLabel);

      const settingsRef = doc(db, 'site_settings', 'main');
      const pixPatch = sanitizePixSettingsPatch(nextPixState, {
        includeEmptyInstitution: Boolean((settings.pixInstitution ?? '').trim()),
      });

      try {
        await updateDoc(settingsRef, {
          ...pixPatch,
          updatedAt: serverTimestamp(),
        });
      } catch (updateErr) {
        const errCode =
          updateErr && typeof updateErr === 'object' && 'code' in updateErr
            ? String((updateErr as { code?: unknown }).code || '')
            : '';
        if (errCode === 'not-found') {
          const fullSanitized = sanitizeSiteSettingsForFirestore({
            ...settings,
            ...nextPixState,
          });
          await setDoc(settingsRef, {
            ...fullSanitized,
            updatedAt: serverTimestamp(),
          });
        } else {
          throw updateErr;
        }
      }

      const verifiedSnap = await getDocFromServer(settingsRef);
      if (!verifiedSnap.exists()) {
        throw new Error('READBACK_MISSING');
      }
      const persisted = verifiedSnap.data() as Partial<SiteSettings>;
      const matches =
        Boolean(persisted.pixEnabled) === pixPatch.pixEnabled &&
        (persisted.pixKey ?? '') === pixPatch.pixKey &&
        (persisted.pixKeyType ?? 'unconfigured') === pixPatch.pixKeyType &&
        (persisted.pixBeneficiaryName ?? '') === pixPatch.pixBeneficiaryName &&
        (persisted.pixInstitution ?? '') === (pixPatch.pixInstitution ?? '') &&
        (persisted.pixCity ?? '') === pixPatch.pixCity &&
        (persisted.pixProviderMode ?? 'demo_unconfigured') === pixPatch.pixProviderMode &&
        Number(persisted.giftReservationExpiryMinutes) === pixPatch.giftReservationExpiryMinutes;

      if (!matches) {
        throw new Error('READBACK_MISMATCH');
      }

      setForm((prev) => ({
        ...prev,
        pixEnabled: Boolean(persisted.pixEnabled),
        pixKey: persisted.pixKey ?? '',
        pixKeyType: persisted.pixKeyType ?? 'unconfigured',
        pixBeneficiaryName: persisted.pixBeneficiaryName ?? '',
        pixInstitution: persisted.pixInstitution ?? '',
        pixCity: persisted.pixCity ?? '',
        pixProviderMode: persisted.pixProviderMode ?? 'demo_unconfigured',
        giftReservationExpiryMinutes:
          Number(persisted.giftReservationExpiryMinutes) || pixPatch.giftReservationExpiryMinutes,
      }));
      setSavedPixOk(true);
    } catch (err) {
      const errCode =
        err && typeof err === 'object' && 'code' in err
          ? String((err as { code?: unknown }).code || '')
          : '';
      const errMsg = err instanceof Error ? err.message : '';
      if (errCode === 'permission-denied') {
        setPixSaveError(
          'Permissão negada ao gravar os dados Pix em site_settings/main. Publique o arquivo firestore.rules atualizado no Console do Firebase (Firestore Database → Regras) para liberar o novo campo Instituição financeira e tente novamente.'
        );
        handleFirestoreError(err, OperationType.WRITE, 'site_settings/main');
      } else if (errMsg === 'READBACK_MISMATCH' || errMsg === 'READBACK_MISSING') {
        setPixSaveError(
          'Os dados Pix não corresponderam ao esperado na leitura de confirmação no Firestore. Recarregue a página e tente novamente.'
        );
      } else {
        setPixSaveError('Não foi possível salvar os dados Pix no Firestore. Tente novamente.');
        handleFirestoreError(err, OperationType.WRITE, 'site_settings/main');
      }
    } finally {
      setSavingPix(false);
    }

    await writeAuditLog(
      'Dados Pix atualizados',
      'Configurações bancárias de recebimento via Pix salvas e confirmadas no Firestore.'
    );
  };

  const handleSaveGeneralSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaveError(null);
    setSavedOk(false);

    if (!isAdmin) {
      setSaveError('Apenas administradores autenticados podem alterar as configurações.');
      return;
    }

    setSaving(true);
    try {
      const settingsRef = doc(db, 'site_settings', 'main');
      const generalPatch = sanitizeGeneralSettingsPatch(form);

      try {
        await updateDoc(settingsRef, {
          ...generalPatch,
          updatedAt: serverTimestamp(),
        });
      } catch (primaryErr) {
        const errCode =
          primaryErr && typeof primaryErr === 'object' && 'code' in primaryErr
            ? String((primaryErr as { code?: unknown }).code || '')
            : '';
        if (errCode === 'not-found') {
          const fullSanitized = sanitizeSiteSettingsForFirestore({
            ...settings,
            ...form,
          });
          try {
            await setDoc(settingsRef, {
              ...fullSanitized,
              updatedAt: serverTimestamp(),
            });
          } catch (createErr) {
            const createCode =
              createErr && typeof createErr === 'object' && 'code' in createErr
                ? String((createErr as { code?: unknown }).code || '')
                : '';
            if (createCode === 'permission-denied' && !fullSanitized.pixInstitution) {
              await setDoc(settingsRef, {
                ...pickCoreSiteSettingsForLegacyRules(fullSanitized),
                updatedAt: serverTimestamp(),
              });
            } else {
              throw createErr;
            }
          }
        } else {
          throw primaryErr;
        }
      }

      const verifiedSnap = await getDocFromServer(settingsRef);
      if (!verifiedSnap.exists()) {
        throw new Error('READBACK_MISSING');
      }
      const persisted = verifiedSnap.data() as Partial<SiteSettings>;
      setForm((prev) => ({
        ...prev,
        venueStreetAddress: persisted.venueStreetAddress ?? prev.venueStreetAddress,
        venueCoordinates: persisted.venueCoordinates ?? prev.venueCoordinates,
        venueMapUrl: persisted.venueMapUrl ?? prev.venueMapUrl,
        venuePhotoUrl: persisted.venuePhotoUrl ?? prev.venuePhotoUrl,
        rsvpDeadlineIso: persisted.rsvpDeadlineIso ?? prev.rsvpDeadlineIso,
        rsvpMaxGuestsPerSubmission:
          Number(persisted.rsvpMaxGuestsPerSubmission) || prev.rsvpMaxGuestsPerSubmission,
        lgpdContactEmail: persisted.lgpdContactEmail ?? prev.lgpdContactEmail,
        goalTitle: persisted.goalTitle ?? prev.goalTitle,
        goalAmountCents:
          typeof persisted.goalAmountCents === 'number'
            ? persisted.goalAmountCents
            : prev.goalAmountCents,
        heroQuote: persisted.heroQuote ?? prev.heroQuote,
        giftIntroMessage: persisted.giftIntroMessage ?? prev.giftIntroMessage,
      }));
      setSavedOk(true);
    } catch (err) {
      const errCode =
        err && typeof err === 'object' && 'code' in err
          ? String((err as { code?: unknown }).code || '')
          : '';
      if (errCode === 'permission-denied') {
        setSaveError(
          'Permissão negada ao gravar em site_settings/main. Publique o arquivo firestore.rules atualizado no Console do Firebase (Firestore Database → Regras) e tente novamente.'
        );
      } else {
        setSaveError('Não foi possível salvar as configurações gerais no Firestore. Tente novamente.');
      }
      handleFirestoreError(err, OperationType.WRITE, 'site_settings/main');
    } finally {
      setSaving(false);
    }

    await writeAuditLog(
      'Configurações gerais atualizadas',
      'Localização, prazos de RSVP, meta e textos institucionais salvos no Firestore.'
    );
  };

  const handleAddAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    setCoAdminMsg(null);
    if (!coAdminUid.trim() || !coAdminEmail.trim()) return;
    try {
      await setDoc(doc(db, 'admins', coAdminUid.trim()), {
        uid: coAdminUid.trim(),
        email: coAdminEmail.trim(),
        role: 'couple',
        createdAt: serverTimestamp(),
      });
      setCoAdminMsg('Administrador adicionado com sucesso.');
      setCoAdminUid('');
      setCoAdminEmail('');
    } catch (err) {
      setCoAdminMsg('Verifique se o UID contém apenas letras, números, _ ou -.');
      try {
        handleFirestoreError(err, OperationType.CREATE, 'admins');
      } catch {
        // logged
      }
    }
  };

  return (
    <div className="space-y-8">
      {/* Pix Direct Receiving Config (independent bank settings form) */}
      <form
        onSubmit={handleSavePixSettings}
        className="space-y-5 rounded-lg border border-dourado/35 bg-creme-claro p-6 sm:p-8"
      >
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-dourado/25 pb-4">
          <div>
            <h2 className="font-display text-2xl font-semibold text-marrom">
              Configurações Bancárias do Pix
            </h2>
            <p className="text-xs text-marrom-suave">
              Pix direto e independente para a página exclusiva dos convidados (sem passar pelo
              Mercado Pago).
            </p>
          </div>
          {savedPixOk && (
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-salvia">
              <CheckCircle2 className="h-4 w-4" />
              Dados Pix salvos e confirmados!
            </span>
          )}
        </div>

        <div className="space-y-4 rounded-md border border-dourado/30 bg-creme/55 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="font-display text-xl font-semibold text-marrom">
                Recebimento via Pix
              </h3>
              <p className="text-xs text-marrom-suave">
                A edição abaixo atualiza apenas os dados Pix sem sobrescrever outras configurações do
                site.
              </p>
            </div>
            <label className="inline-flex items-center gap-2 text-xs font-medium text-marrom cursor-pointer">
              <input
                type="checkbox"
                checked={form.pixEnabled}
                onChange={(e) => {
                  setPixValidationError(null);
                  setPixSaveError(null);
                  setSavedPixOk(false);
                  setForm({ ...form, pixEnabled: e.target.checked });
                }}
                className="h-4 w-4 rounded border-dourado accent-terracota-escuro"
              />
              Recebimento via Pix ativo
            </label>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-medium text-marrom">Beneficiário (nome completo)</label>
              <input
                type="text"
                maxLength={80}
                value={form.pixBeneficiaryName}
                onChange={(e) => {
                  setPixValidationError(null);
                  setForm({ ...form, pixBeneficiaryName: e.target.value });
                }}
                placeholder="Nome completo do titular da conta Pix"
                className="mt-1 w-full rounded-md border border-dourado/40 bg-creme-claro px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-marrom">
                Instituição financeira
              </label>
              <input
                type="text"
                maxLength={80}
                value={form.pixInstitution || ''}
                onChange={(e) => {
                  setPixValidationError(null);
                  setForm({ ...form, pixInstitution: e.target.value });
                }}
                placeholder="Ex.: Banco do Brasil, Nubank, Caixa..."
                className="mt-1 w-full rounded-md border border-dourado/40 bg-creme-claro px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-marrom">Tipo de chave</label>
              <select
                value={form.pixKeyType}
                onChange={(e) => {
                  setPixValidationError(null);
                  setForm({ ...form, pixKeyType: e.target.value as PixKeyType });
                }}
                className="mt-1 w-full rounded-md border border-dourado/40 bg-creme-claro px-3 py-2 text-sm"
              >
                <option value="unconfigured">Não configurada</option>
                <option value="cpf">CPF</option>
                <option value="cnpj">CNPJ</option>
                <option value="email">E-mail</option>
                <option value="phone">Celular (+55...)</option>
                <option value="evp">Chave aleatória (EVP)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-marrom">Chave Pix</label>
              <input
                type="text"
                maxLength={140}
                value={form.pixKey}
                onChange={(e) => {
                  setPixValidationError(null);
                  setForm({ ...form, pixKey: e.target.value });
                }}
                placeholder="Informe a chave Pix oficial do casal"
                className="mt-1 w-full rounded-md border border-dourado/40 bg-creme-claro px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-marrom">Cidade</label>
              <input
                type="text"
                maxLength={40}
                value={form.pixCity}
                onChange={(e) => {
                  setPixValidationError(null);
                  setForm({ ...form, pixCity: e.target.value });
                }}
                placeholder="Ex.: Rio Pardo de Minas"
                className="mt-1 w-full rounded-md border border-dourado/40 bg-creme-claro px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-marrom">
                Nome de identificação do recebimento
              </label>
              <input
                type="text"
                maxLength={60}
                value={pixIdentifierLabel}
                onChange={(e) => setPixIdentifierLabel(e.target.value)}
                placeholder={DEFAULT_PIX_IDENTIFIER_LABEL}
                className="mt-1 w-full rounded-md border border-dourado/40 bg-creme-claro px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-marrom">Modo de operação</label>
              <select
                value={form.pixProviderMode}
                onChange={(e) =>
                  setForm({ ...form, pixProviderMode: e.target.value as PixProviderMode })
                }
                className="mt-1 w-full rounded-md border border-dourado/40 bg-creme-claro px-3 py-2 text-sm"
              >
                <option value="demo_unconfigured">Modo demonstração (sem chave)</option>
                <option value="manual_pix">Pix direto · Copia e Cola / QR (conferência manual)</option>
                <option value="webhook_provider">Provedor Pix com webhook no servidor</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-marrom">
                Expiração da reserva (minutos)
              </label>
              <input
                type="number"
                min={5}
                max={10080}
                value={form.giftReservationExpiryMinutes}
                onChange={(e) =>
                  setForm({ ...form, giftReservationExpiryMinutes: Number(e.target.value) })
                }
                className="mt-1 w-full rounded-md border border-dourado/40 bg-creme-claro px-3 py-2 text-sm tabular-nums"
              />
            </div>
          </div>

          {pixValidationError && (
            <p role="alert" className="rounded-md bg-terracota/10 px-3.5 py-2.5 text-xs font-semibold text-terracota-escuro">
              {pixValidationError}
            </p>
          )}

          {pixSaveError && (
            <p
              role="alert"
              className="rounded-md border border-terracota/40 bg-terracota/10 px-4 py-3 text-xs leading-relaxed text-terracota-escuro"
            >
              {pixSaveError}
            </p>
          )}

          <p className="text-xs text-marrom-suave">
            O código BR Code (QR Code e Pix Copia e Cola) é montado no padrão oficial do Banco
            Central exclusivamente a partir da chave real cadastrada acima. A confirmação de
            recebimento do Pix direto ocorre manualmente na aba Presentes &amp; Pedidos.
          </p>
        </div>

        <button
          type="submit"
          disabled={savingPix}
          className="inline-flex items-center gap-2 rounded-md bg-terracota-escuro px-6 py-3 text-xs font-semibold tracking-wider text-creme-claro uppercase hover:bg-terracota disabled:opacity-50"
        >
          <Save className="h-4 w-4" />
          {savingPix ? 'Salvando dados Pix...' : 'Salvar dados bancários Pix'}
        </button>
      </form>

      {/* General, Venue & RSVP Settings */}
      <form
        onSubmit={handleSaveGeneralSettings}
        className="space-y-6 rounded-lg border border-dourado/35 bg-creme-claro p-6 sm:p-8"
      >
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-dourado/25 pb-4">
          <div>
            <h2 className="font-display text-2xl font-semibold text-marrom">
              Configurações Gerais, Cerimônia &amp; RSVP
            </h2>
            <p className="text-xs text-marrom-suave">
              Personalize textos, prazo do RSVP, meta e endereço sem afetar as configurações do Pix.
            </p>
          </div>
          {savedOk && (
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-salvia">
              <CheckCircle2 className="h-4 w-4" />
              Salvo no Firestore!
            </span>
          )}
        </div>

        {/* Venue & RSVP Settings */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-xs font-medium text-marrom">
              Endereço completo da rua (opcional)
            </label>
            <input
              type="text"
              maxLength={240}
              value={form.venueStreetAddress}
              onChange={(e) => setForm({ ...form, venueStreetAddress: e.target.value })}
              placeholder="Rua, número e bairro"
              className="mt-1 w-full rounded-md border border-dourado/40 bg-creme-claro px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-marrom">
              Coordenadas (latitude, longitude)
            </label>
            <input
              type="text"
              maxLength={80}
              value={form.venueCoordinates}
              onChange={(e) => setForm({ ...form, venueCoordinates: e.target.value })}
              placeholder="Ex.: -15.6108, -42.5403"
              className="mt-1 w-full rounded-md border border-dourado/40 bg-creme-claro px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-marrom">Link direto Google Maps</label>
            <input
              type="url"
              maxLength={500}
              value={form.venueMapUrl}
              onChange={(e) => setForm({ ...form, venueMapUrl: e.target.value })}
              placeholder="https://maps.google.com/..."
              className="mt-1 w-full rounded-md border border-dourado/40 bg-creme-claro px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-marrom">
              URL da foto real da fachada da igreja
            </label>
            <input
              type="text"
              maxLength={600}
              value={form.venuePhotoUrl || ''}
              onChange={(e) => setForm({ ...form, venuePhotoUrl: e.target.value })}
              placeholder="/church-facade.png ou https://..."
              className="mt-1 w-full rounded-md border border-dourado/40 bg-creme-claro px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-marrom">Data-limite do RSVP</label>
            <input
              type="date"
              value={form.rsvpDeadlineIso ? form.rsvpDeadlineIso.slice(0, 10) : ''}
              onChange={(e) =>
                setForm({
                  ...form,
                  rsvpDeadlineIso: e.target.value ? `${e.target.value}T23:59:59-03:00` : '',
                })
              }
              className="mt-1 w-full rounded-md border border-dourado/40 bg-creme-claro px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-marrom">
              Máximo de participantes por envio RSVP
            </label>
            <input
              type="number"
              min={1}
              max={10}
              value={form.rsvpMaxGuestsPerSubmission}
              onChange={(e) =>
                setForm({ ...form, rsvpMaxGuestsPerSubmission: Number(e.target.value) })
              }
              className="mt-1 w-full rounded-md border border-dourado/40 bg-creme-claro px-3 py-2 text-sm tabular-nums"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-marrom">E-mail de contato LGPD</label>
            <input
              type="email"
              maxLength={160}
              value={form.lgpdContactEmail}
              onChange={(e) => setForm({ ...form, lgpdContactEmail: e.target.value })}
              className="mt-1 w-full rounded-md border border-dourado/40 bg-creme-claro px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-marrom">Título da meta</label>
            <input
              type="text"
              maxLength={140}
              value={form.goalTitle}
              onChange={(e) => setForm({ ...form, goalTitle: e.target.value })}
              className="mt-1 w-full rounded-md border border-dourado/40 bg-creme-claro px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-marrom">Meta financeira (R$)</label>
            <input
              type="number"
              min={0}
              value={Math.round(form.goalAmountCents / 100)}
              onChange={(e) =>
                setForm({ ...form, goalAmountCents: Math.max(0, Number(e.target.value)) * 100 })
              }
              className="mt-1 w-full rounded-md border border-dourado/40 bg-creme-claro px-3 py-2 text-sm tabular-nums"
            />
          </div>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-marrom">Frase principal (Hero)</label>
            <textarea
              rows={2}
              maxLength={400}
              value={form.heroQuote}
              onChange={(e) => setForm({ ...form, heroQuote: e.target.value })}
              className="mt-1 w-full rounded-md border border-dourado/40 bg-creme-claro px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-marrom">
              Texto de introdução da Lista de Presentes
            </label>
            <textarea
              rows={2}
              maxLength={500}
              value={form.giftIntroMessage}
              onChange={(e) => setForm({ ...form, giftIntroMessage: e.target.value })}
              className="mt-1 w-full rounded-md border border-dourado/40 bg-creme-claro px-3 py-2 text-sm"
            />
          </div>
        </div>

        {saveError && (
          <p
            role="alert"
            className="rounded-md border border-terracota/40 bg-terracota/10 px-4 py-3 text-xs leading-relaxed text-terracota-escuro"
          >
            {saveError}
          </p>
        )}

        <button
          type="submit"
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-md bg-terracota-escuro px-6 py-3 text-xs font-semibold tracking-wider text-creme-claro uppercase hover:bg-terracota disabled:opacity-50"
        >
          <Save className="h-4 w-4" />
          {saving ? 'Salvando...' : 'Salvar configurações gerais'}
        </button>
      </form>

      {/* Mercado Pago Card Brick & Optional Checkout Pro Integration Status */}
      <section className="rounded-lg border border-dourado/35 bg-creme-claro p-6 space-y-4">
        <div className="flex items-center gap-2">
          <CreditCard className="h-5 w-5 text-terracota-escuro" />
          <h3 className="font-display text-2xl font-semibold text-marrom">
            Integração de Cartão · Mercado Pago (Brick Integrado &amp; Checkout Pro Opcional)
          </h3>
        </div>
        <p className="text-xs text-marrom-suave">
          O pagamento com cartão acontece diretamente no site pelo componente oficial{' '}
          <strong>Card Payment Brick</strong> do Mercado Pago (sem armazenar dados sensíveis no
          servidor), com opção secundária de Checkout Pro para quem preferir usar a conta Mercado
          Pago. O Pix direto permanece totalmente independente.
        </p>

        {mpReadiness && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 text-xs">
            <div className="rounded-md border border-dourado/35 bg-creme p-3.5">
              <p className="font-semibold text-marrom">Access Token (MERCADOPAGO_ACCESS_TOKEN)</p>
              <p
                className={`mt-1 font-semibold ${
                  mpReadiness.configured ? 'text-salvia' : 'text-terracota-escuro'
                }`}
              >
                {mpReadiness.configured
                  ? mpReadiness.testMode
                    ? 'Configurado · Testes'
                    : 'Configurado · Produção'
                  : 'Não configurado'}
              </p>
            </div>
            <div className="rounded-md border border-dourado/35 bg-creme p-3.5">
              <p className="font-semibold text-marrom">Public Key Brick (MERCADOPAGO_PUBLIC_KEY)</p>
              <p
                className={`mt-1 font-semibold ${
                  mpReadiness.publicKeyConfigured ? 'text-salvia' : 'text-terracota-escuro'
                }`}
              >
                {mpReadiness.publicKeyConfigured
                  ? mpReadiness.cardBrickReady
                    ? 'Ativa · Cartão no site pronto'
                    : 'Chave pública configurada'
                  : mpReadiness.publicKeyError
                    ? 'Chave pública inválida ou bloqueada'
                    : 'Ausente · configure a Public Key de produção'}
              </p>
              {mpReadiness.publicKeyError && (
                <p className="mt-1 text-[11px] leading-snug text-terracota-escuro">
                  {mpReadiness.publicKeyError}
                </p>
              )}
            </div>
            <div className="rounded-md border border-dourado/35 bg-creme p-3.5">
              <p className="font-semibold text-marrom">
                Assinatura Webhook (MERCADOPAGO_WEBHOOK_SECRET)
              </p>
              <p
                className={`mt-1 font-semibold ${
                  mpReadiness.webhookSecretConfigured
                    ? 'text-salvia'
                    : mpReadiness.webhookSecretRequired || mpReadiness.liveMode
                      ? 'text-terracota-escuro'
                      : 'text-marrom-suave'
                }`}
              >
                {mpReadiness.webhookSecretConfigured
                  ? 'Configurada (HMAC-SHA256)'
                  : mpReadiness.webhookSecretRequired || mpReadiness.liveMode
                    ? 'Obrigatória em produção · ausente'
                    : 'Pendente · recomendada para testes'}
              </p>
            </div>
            <div className="rounded-md border border-dourado/35 bg-creme p-3.5">
              <p className="font-semibold text-marrom">
                Sincronização Firestore
              </p>
              <p
                className={`mt-1 font-semibold ${
                  mpReadiness.serviceAccountConfigured ? 'text-salvia' : 'text-terracota-escuro'
                }`}
              >
                {mpReadiness.serviceAccountConfigured
                  ? mpReadiness.firebaseAuthMode === 'adc'
                    ? 'Ativa via ADC'
                    : 'Ativa no servidor'
                  : 'Sincronização manual pelo botão "Sincronizar pagamentos"'}
              </p>
            </div>
          </div>
        )}

        {(() => {
          const browserOrigin =
            typeof window !== 'undefined' ? window.location.origin : '';
          const fallbackProdOrigin = /^https?:\/\/ais-dev-([a-z0-9.-]+\.run\.app)$/i.test(
            browserOrigin
          )
            ? browserOrigin.replace(/^https?:\/\/ais-dev-/i, 'https://ais-pre-')
            : browserOrigin;
          const webhookUrlToDisplay =
            mpReadiness?.effectiveWebhookUrl ||
            (fallbackProdOrigin
              ? `${fallbackProdOrigin}/api/webhooks/mercadopago`
              : '/api/webhooks/mercadopago');
          const accessedFromDevPreview =
            Boolean(mpReadiness?.isPreviewOrigin) ||
            /^https?:\/\/ais-dev-/i.test(browserOrigin);

          return (
            <div className="rounded-md border border-dourado/35 bg-creme/70 p-3.5 text-xs text-marrom-suave space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-marrom">
                    URL pública de produção do Webhook no Mercado Pago:
                  </p>
                  <code className="block mt-1 break-all text-terracota-escuro">
                    {webhookUrlToDisplay}
                  </code>
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    await navigator.clipboard.writeText(webhookUrlToDisplay);
                    setCopiedWebhook(true);
                    window.setTimeout(() => setCopiedWebhook(false), 2000);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-md border border-dourado/55 bg-creme-claro px-3 py-1.5 text-xs font-semibold text-marrom hover:bg-pergaminho"
                >
                  {copiedWebhook ? (
                    <Check className="h-3.5 w-3.5 text-salvia" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                  {copiedWebhook ? 'Copiado!' : 'Copiar URL'}
                </button>
              </div>
              {accessedFromDevPreview && (
                <p className="text-[11px] leading-relaxed text-marrom-suave">
                  Você está visualizando o painel pelo endereço de desenvolvimento (<code>ais-dev-...</code>).
                  A URL exibida acima (<code>ais-pre-...</code>) corresponde ao endereço público de produção e{' '}
                  <strong>não altera automaticamente</strong> a configuração já cadastrada no painel do Mercado Pago.
                </p>
              )}
            </div>
          );
        })()}
      </section>

      {/* Co-admin Management */}
      <section className="rounded-lg border border-dourado/35 bg-creme-claro p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Shield className="h-5 w-5 text-salvia" />
          <h3 className="font-display text-2xl font-semibold text-marrom">
            Administradores Autorizados
          </h3>
        </div>
        <p className="text-xs text-marrom-suave">
          Seu UID atual: <code className="bg-creme px-1.5 py-0.5 rounded">{user?.uid}</code> · Para
          liberar o acesso de Jadi ou outro administrador, informe o UID e e-mail Google abaixo.
        </p>

        <form onSubmit={handleAddAdmin} className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <input
            type="text"
            required
            value={coAdminUid}
            onChange={(e) => setCoAdminUid(e.target.value)}
            placeholder="UID do usuário no Firebase Auth"
            className="rounded-md border border-dourado/40 bg-creme-claro px-3 py-2 text-sm"
          />
          <input
            type="email"
            required
            value={coAdminEmail}
            onChange={(e) => setCoAdminEmail(e.target.value)}
            placeholder="E-mail Google do administrador"
            className="rounded-md border border-dourado/40 bg-creme-claro px-3 py-2 text-sm"
          />
          <button
            type="submit"
            className="inline-flex items-center justify-center gap-2 rounded-md border border-terracota-escuro px-4 py-2 text-xs font-semibold text-terracota-escuro uppercase hover:bg-terracota/10"
          >
            <UserPlus className="h-4 w-4" />
            Adicionar admin
          </button>
        </form>
        {coAdminMsg && <p className="text-xs text-salvia font-medium">{coAdminMsg}</p>}
      </section>
    </div>
  );
};
