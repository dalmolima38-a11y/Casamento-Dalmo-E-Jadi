import React, { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Check, CheckCircle2, Copy, Lock, Plus, Trash2 } from 'lucide-react';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { useWedding } from '../context/WeddingContext';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { generateRandomToken, sha256Hex } from '../lib/pix';

export const RsvpPage: React.FC = () => {
  const { settings, setPrivacyModalOpen } = useWedding();
  const [searchParams] = useSearchParams();

  const editRsvpId = searchParams.get('id');
  const editToken = searchParams.get('token');
  const isEditMode = Boolean(editRsvpId && editToken);

  const [responsibleName, setResponsibleName] = useState('');
  const [contact, setContact] = useState('');
  const [attending, setAttending] = useState<boolean>(true);
  const [attendeeNames, setAttendeeNames] = useState<string[]>(['']);
  const [notes, setNotes] = useState('');
  const [lgpdConsent, setLgpdConsent] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [submittedInfo, setSubmittedInfo] = useState<{
    rsvpId: string;
    correctionUrl?: string;
    isRevision: boolean;
  } | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);

  const maxAllowed = Math.min(10, Math.max(1, settings.rsvpMaxGuestsPerSubmission || 6));

  const deadlinePassed = useMemo(() => {
    if (!settings.rsvpDeadlineIso) return false;
    const ms = new Date(settings.rsvpDeadlineIso).getTime();
    return !Number.isNaN(ms) && Date.now() > ms;
  }, [settings.rsvpDeadlineIso]);

  const handleAddAttendee = () => {
    if (attendeeNames.length >= maxAllowed) return;
    setAttendeeNames((prev) => [...prev, '']);
  };

  const handleRemoveAttendee = (idx: number) => {
    setAttendeeNames((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev));
  };

  const handleUpdateAttendee = (idx: number, val: string) => {
    setAttendeeNames((prev) => prev.map((item, i) => (i === idx ? val : item)));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (deadlinePassed && !isEditMode) {
      setErrorMsg('O prazo de confirmação de presença configurado pelos noivos foi encerrado.');
      return;
    }

    const cleanedNames = attending
      ? attendeeNames.map((n) => n.trim()).filter((n) => n.length >= 2)
      : [];

    if (!isEditMode && responsibleName.trim().length < 2) {
      setErrorMsg('Informe o nome completo do responsável.');
      return;
    }
    if (!isEditMode && contact.trim().length < 3) {
      setErrorMsg('Informe um telefone (WhatsApp) ou e-mail válido.');
      return;
    }
    if (attending && cleanedNames.length === 0) {
      setErrorMsg('Informe o nome completo de pelo menos um participante.');
      return;
    }
    if (!isEditMode && !lgpdConsent) {
      setErrorMsg('Confirme a autorização de privacidade (LGPD) para enviar sua resposta.');
      return;
    }

    setSubmitting(true);
    try {
      if (isEditMode && editRsvpId && editToken) {
        const tokenHash = await sha256Hex(editToken);
        const revisionId = `rev_${generateRandomToken(8)}`;
        await setDoc(doc(db, 'rsvp_revisions', revisionId), {
          rsvpId: editRsvpId,
          tokenHash,
          attending,
          attendeesCount: attending ? cleanedNames.length : 0,
          attendeeNames: cleanedNames.slice(0, 10),
          ...(notes.trim() ? { notes: notes.trim().slice(0, 600) } : {}),
          reviewStatus: 'pending',
          createdAt: serverTimestamp(),
        });

        setSubmittedInfo({
          rsvpId: editRsvpId,
          isRevision: true,
        });
      } else {
        const rsvpId = `rsvp_${generateRandomToken(8)}`;
        const rawEditToken = generateRandomToken(16);
        const editTokenHash = await sha256Hex(rawEditToken);

        await setDoc(doc(db, 'rsvps', rsvpId), {
          responsibleName: responsibleName.trim().slice(0, 120),
          contact: contact.trim().slice(0, 140),
          attending,
          attendeesCount: attending ? cleanedNames.length : 0,
          attendeeNames: cleanedNames.slice(0, 10),
          ...(notes.trim() ? { notes: notes.trim().slice(0, 600) } : {}),
          status: 'pending_review',
          editTokenHash,
          lgpdConsent: true,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });

        const correctionUrl = `${window.location.origin}/rsvp?id=${encodeURIComponent(
          rsvpId
        )}&token=${encodeURIComponent(rawEditToken)}`;

        setSubmittedInfo({
          rsvpId,
          correctionUrl,
          isRevision: false,
        });
      }
    } catch (err) {
      setErrorMsg(
        isEditMode
          ? 'Link de correção inválido ou não autorizado. Apenas o titular do link seguro pode solicitar alterações.'
          : 'Não foi possível registrar sua confirmação. Verifique os campos e tente novamente.'
      );
      try {
        handleFirestoreError(err, OperationType.CREATE, isEditMode ? 'rsvp_revisions' : 'rsvps');
      } catch {
        // already logged
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleCopyCorrectionLink = async () => {
    if (!submittedInfo?.correctionUrl) return;
    await navigator.clipboard.writeText(submittedInfo.correctionUrl);
    setCopiedLink(true);
    window.setTimeout(() => setCopiedLink(false), 2500);
  };

  return (
    <div className="relative py-14 sm:py-20">
      <div className="relative z-20 mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
        <header className="text-center">
          <p className="font-display text-xs font-semibold tracking-[0.26em] text-oliva uppercase">
            Confirmação de Presença
          </p>
          <h1 className="mt-2 font-display text-4xl sm:text-5xl font-semibold text-marrom">
            {isEditMode ? 'Corrigir Confirmação' : 'Sua presença é muito especial'}
          </h1>
          {settings.rsvpDeadlineIso ? (
            <p className="mt-2 text-xs font-medium text-terracota-escuro">
              Prazo para confirmação:{' '}
              {new Date(settings.rsvpDeadlineIso).toLocaleDateString('pt-BR')}
            </p>
          ) : (
            <p className="mt-2 text-xs text-marrom-suave">
              Data-limite configurável pelos noivos no Painel Administrativo.
            </p>
          )}
        </header>

        {submittedInfo ? (
          <div className="mt-8 rounded-lg border border-dourado/45 bg-creme-claro p-7 sm:p-10 text-center shadow-sm">
            <CheckCircle2 className="mx-auto h-11 w-11 text-salvia" />
            <h2 className="mt-4 font-display text-3xl font-semibold text-marrom">
              {submittedInfo.isRevision
                ? 'Solicitação de correção enviada!'
                : 'Confirmação recebida com carinho!'}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-marrom-suave">
              {submittedInfo.isRevision
                ? 'Seus dados atualizados foram vinculados com segurança à sua confirmação original e serão revisados pelos noivos.'
                : 'Sua resposta foi salva e enviada para conferência administrativa de Dalmo & Jadi.'}
            </p>

            {submittedInfo.correctionUrl && (
              <div className="mt-6 rounded-md border border-dourado/35 bg-creme/70 p-5 text-left">
                <p className="flex items-center gap-2 text-xs font-semibold text-marrom uppercase tracking-wider">
                  <Lock className="h-4 w-4 text-salvia" />
                  Link seguro para correção individual
                </p>
                <p className="mt-1 text-xs text-marrom-suave">
                  Guarde este link caso precise ajustar nomes ou quantidade de acompanhantes. Apenas
                  quem possui este token pode enviar alterações para a sua confirmação.
                </p>
                <div className="mt-3 flex flex-col sm:flex-row gap-2">
                  <input
                    type="text"
                    readOnly
                    value={submittedInfo.correctionUrl}
                    aria-label="Link seguro de correção"
                    className="flex-1 rounded-md border border-dourado/35 bg-creme-claro px-3 py-2 font-mono text-xs text-marrom"
                  />
                  <button
                    type="button"
                    onClick={handleCopyCorrectionLink}
                    className="inline-flex items-center justify-center gap-1.5 rounded-md bg-terracota-escuro px-4 py-2 text-xs font-semibold text-creme-claro uppercase hover:bg-terracota transition-colors"
                  >
                    {copiedLink ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                    {copiedLink ? 'Copiado' : 'Copiar link'}
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <form
            onSubmit={handleSubmit}
            className="mt-8 space-y-6 rounded-lg border border-dourado/40 bg-creme-claro p-6 sm:p-10 shadow-sm"
          >
            {deadlinePassed && !isEditMode && (
              <div className="rounded-md border border-terracota/40 bg-terracota/10 p-4 text-sm text-terracota-escuro">
                O prazo para novas confirmações foi encerrado. Caso precise falar com os noivos,
                entre em contato diretamente.
              </div>
            )}

            {isEditMode && (
              <div className="rounded-md border border-salvia/40 bg-salvia/10 p-4 text-sm text-marrom">
                Editando confirmação <strong>{editRsvpId}</strong> por link seguro. Por privacidade,
                os dados anteriores não são exibidos publicamente; informe abaixo os dados
                atualizados para revisão dos noivos.
              </div>
            )}

            {!isEditMode && (
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                <div>
                  <label htmlFor="rsvpName" className="block text-sm font-medium text-marrom">
                    Nome do responsável *
                  </label>
                  <input
                    id="rsvpName"
                    type="text"
                    required
                    maxLength={120}
                    value={responsibleName}
                    onChange={(e) => setResponsibleName(e.target.value)}
                    placeholder="Nome e sobrenome"
                    className="mt-1.5 w-full rounded-md border border-dourado/45 bg-creme-claro px-3.5 py-2.5 text-sm text-marrom focus:border-terracota-escuro focus:outline-none"
                  />
                </div>

                <div>
                  <label htmlFor="rsvpContact" className="block text-sm font-medium text-marrom">
                    Telefone (WhatsApp) ou E-mail *
                  </label>
                  <input
                    id="rsvpContact"
                    type="text"
                    required
                    maxLength={140}
                    value={contact}
                    onChange={(e) => setContact(e.target.value)}
                    placeholder="(38) 99999-0000"
                    className="mt-1.5 w-full rounded-md border border-dourado/45 bg-creme-claro px-3.5 py-2.5 text-sm text-marrom focus:border-terracota-escuro focus:outline-none"
                  />
                </div>
              </div>
            )}

            {/* Attending Sim/Não */}
            <div>
              <span className="block text-sm font-medium text-marrom">Você poderá comparecer? *</span>
              <div className="mt-2 grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setAttending(true)}
                  className={`rounded-md border px-4 py-3 text-sm font-medium transition-colors ${
                    attending
                      ? 'border-terracota-escuro bg-terracota-escuro text-creme-claro'
                      : 'border-dourado/40 bg-creme/50 text-marrom hover:bg-pergaminho'
                  }`}
                >
                  Sim, estarei presente
                </button>
                <button
                  type="button"
                  onClick={() => setAttending(false)}
                  className={`rounded-md border px-4 py-3 text-sm font-medium transition-colors ${
                    !attending
                      ? 'border-terracota-escuro bg-terracota-escuro text-creme-claro'
                      : 'border-dourado/40 bg-creme/50 text-marrom hover:bg-pergaminho'
                  }`}
                >
                  Não poderei comparecer
                </button>
              </div>
            </div>

            {/* Bounded participants list */}
            {attending && (
              <div className="space-y-3 rounded-md border border-dourado/30 bg-creme/55 p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium text-marrom">
                      Nomes completos de cada participante ({attendeeNames.length} de {maxAllowed})
                    </p>
                    <p className="text-xs text-marrom-suave">
                      Limite de {maxAllowed} pessoas por envio; confirmações passam por revisão dos
                      noivos.
                    </p>
                  </div>
                  {attendeeNames.length < maxAllowed && (
                    <button
                      type="button"
                      onClick={handleAddAttendee}
                      className="inline-flex items-center gap-1.5 rounded-md border border-terracota-escuro px-3 py-1.5 text-xs font-semibold text-terracota-escuro hover:bg-terracota/10 transition-colors"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Adicionar pessoa
                    </button>
                  )}
                </div>

                <div className="space-y-2.5">
                  {attendeeNames.map((name, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <input
                        type="text"
                        required
                        maxLength={120}
                        value={name}
                        onChange={(e) => handleUpdateAttendee(idx, e.target.value)}
                        placeholder={`Nome completo do participante ${idx + 1}`}
                        aria-label={`Nome completo do participante ${idx + 1}`}
                        className="flex-1 rounded-md border border-dourado/40 bg-creme-claro px-3.5 py-2 text-sm text-marrom focus:border-terracota-escuro focus:outline-none"
                      />
                      {attendeeNames.length > 1 && (
                        <button
                          type="button"
                          onClick={() => handleRemoveAttendee(idx)}
                          aria-label={`Remover participante ${idx + 1}`}
                          className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-dourado/35 text-marrom-suave hover:text-terracota-escuro"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div>
              <label htmlFor="rsvpNotes" className="block text-sm font-medium text-marrom">
                Observações opcionais (restrições alimentares, crianças, recado)
              </label>
              <textarea
                id="rsvpNotes"
                rows={3}
                maxLength={600}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Informe algo importante para a recepção..."
                className="mt-1.5 w-full rounded-md border border-dourado/45 bg-creme-claro px-3.5 py-2.5 text-sm text-marrom focus:border-terracota-escuro focus:outline-none"
              />
            </div>

            {!isEditMode && (
              <label className="flex items-start gap-3 text-xs text-marrom-suave cursor-pointer">
                <input
                  type="checkbox"
                  checked={lgpdConsent}
                  onChange={(e) => setLgpdConsent(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-dourado accent-terracota-escuro"
                />
                <span>
                  Concordo que meus dados sejam mantidos de forma privada apenas para a lista de
                  convidados de Dalmo &amp; Jadi (LGPD).{' '}
                  <button
                    type="button"
                    onClick={() => setPrivacyModalOpen(true)}
                    className="font-semibold text-terracota-escuro underline"
                  >
                    Política de privacidade
                  </button>
                </span>
              </label>
            )}

            {errorMsg && (
              <p role="alert" className="rounded-md bg-terracota/10 px-4 py-3 text-sm text-terracota-escuro">
                {errorMsg}
              </p>
            )}

            <button
              type="submit"
              disabled={submitting || (deadlinePassed && !isEditMode)}
              className="w-full rounded-md bg-terracota-escuro px-6 py-3.5 text-xs font-semibold tracking-wider text-creme-claro uppercase hover:bg-terracota disabled:opacity-50 transition-colors"
            >
              {submitting
                ? 'Enviando...'
                : isEditMode
                  ? 'Enviar correção'
                  : 'Enviar confirmação de presença'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
};
