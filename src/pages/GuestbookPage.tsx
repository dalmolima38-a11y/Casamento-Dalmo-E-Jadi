import React, { useState } from 'react';
import { CheckCircle2, MessageSquareHeart } from 'lucide-react';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { useWedding } from '../context/WeddingContext';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { generateRandomToken } from '../lib/pix';
import { WatercolorCorners } from '../components/WatercolorCorners';

export const GuestbookPage: React.FC = () => {
  const { guestbookMessages, setPrivacyModalOpen, isDemoMode, demoAdminActive, demoActions } =
    useWedding();
  const approvedMessages = guestbookMessages.filter((m) => m.status === 'approved');

  const [authorName, setAuthorName] = useState('');
  const [relationship, setRelationship] = useState('');
  const [message, setMessage] = useState('');
  const [consentToPublish, setConsentToPublish] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (authorName.trim().length < 2 || message.trim().length < 2) {
      setErrorMsg('Preencha seu nome e sua mensagem para os noivos.');
      return;
    }
    if (!consentToPublish) {
      setErrorMsg('Marque o consentimento para publicação após moderação.');
      return;
    }

    setSubmitting(true);
    try {
      const msgId = `msg_${generateRandomToken(8)}`;
      const msgPayload = {
        authorName: authorName.trim().slice(0, 100),
        ...(relationship.trim() ? { relationship: relationship.trim().slice(0, 80) } : {}),
        message: message.trim().slice(0, 800),
        status: 'pending' as const,
        consentToPublish: true,
      };

      let savedLive = false;
      if (!isDemoMode && !demoAdminActive) {
        try {
          const now = serverTimestamp();
          await setDoc(doc(db, 'guestbook_messages', msgId), {
            ...msgPayload,
            createdAt: now,
            updatedAt: now,
          });
          savedLive = true;
        } catch (err) {
          console.warn('Fallback recado para modo demonstração:', err);
        }
      }

      if (!savedLive) {
        demoActions.createGuestbookMessage({ id: msgId, ...msgPayload });
      }

      setSubmitted(true);
      setAuthorName('');
      setRelationship('');
      setMessage('');
      setConsentToPublish(false);
    } catch (err) {
      setErrorMsg('Não foi possível enviar seu recado agora. Tente novamente em instantes.');
      try {
        handleFirestoreError(err, OperationType.CREATE, 'guestbook_messages');
      } catch {
        // logged
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="relative overflow-hidden py-10 sm:py-14">
      <WatercolorCorners variant="section" />
      <div className="relative z-20 mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
        <header className="text-center max-w-2xl mx-auto">
          <p className="text-xs font-semibold tracking-[0.22em] text-oliva uppercase">
            MURAL
          </p>
          <h1 className="mt-2.5 font-display text-4xl sm:text-5xl font-semibold text-marrom">
            Recadinhos do Coração
          </h1>
          <p className="mt-2.5 text-sm sm:text-base italic text-marrom-suave">
            Deixe uma palavra carinhosa para Dalmo &amp; Jadi.
          </p>
        </header>

        <div className="mt-8 grid grid-cols-1 gap-10 lg:grid-cols-12">
          <div className="lg:col-span-5">
            <form
              onSubmit={handleSubmit}
              className="rounded-lg border border-dourado/40 bg-creme-claro p-6 sm:p-7 shadow-sm space-y-4"
            >
              <h2 className="font-display text-2xl font-semibold text-marrom">
                Escrever recado
              </h2>

              {submitted && (
                <div className="rounded-md border border-salvia/40 bg-salvia/10 p-4 text-sm text-marrom">
                  <p className="font-semibold flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-salvia" />
                    Recado enviado para moderação!
                  </p>
                  <p className="mt-1 text-xs text-marrom-suave">
                    Assim que Dalmo &amp; Jadi aprovarem no painel administrativo, sua mensagem
                    aparecerá no mural.
                  </p>
                </div>
              )}

              <div>
                <label htmlFor="guestAuthor" className="block text-sm font-medium text-marrom">
                  Seu nome *
                </label>
                <input
                  id="guestAuthor"
                  type="text"
                  required
                  maxLength={100}
                  value={authorName}
                  onChange={(e) => setAuthorName(e.target.value)}
                  placeholder="Ex.: Ana Paula"
                  className="mt-1 w-full rounded-md border border-dourado/45 bg-creme-claro px-3.5 py-2.5 text-sm text-marrom focus:border-terracota-escuro focus:outline-none"
                />
              </div>

              <div>
                <label htmlFor="guestRel" className="block text-sm font-medium text-marrom">
                  Parentesco ou amizade (opcional)
                </label>
                <input
                  id="guestRel"
                  type="text"
                  maxLength={80}
                  value={relationship}
                  onChange={(e) => setRelationship(e.target.value)}
                  placeholder="Ex.: Amigos da igreja"
                  className="mt-1 w-full rounded-md border border-dourado/45 bg-creme-claro px-3.5 py-2.5 text-sm text-marrom focus:border-terracota-escuro focus:outline-none"
                />
              </div>

              <div>
                <label htmlFor="guestMsg" className="block text-sm font-medium text-marrom">
                  Mensagem *
                </label>
                <textarea
                  id="guestMsg"
                  required
                  rows={4}
                  maxLength={800}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Escreva seus votos para o casal..."
                  className="mt-1 w-full rounded-md border border-dourado/45 bg-creme-claro px-3.5 py-2.5 text-sm text-marrom focus:border-terracota-escuro focus:outline-none"
                />
              </div>

              <label className="flex items-start gap-2.5 text-xs text-marrom-suave cursor-pointer">
                <input
                  type="checkbox"
                  checked={consentToPublish}
                  onChange={(e) => setConsentToPublish(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-dourado accent-terracota-escuro"
                />
                <span>
                  Autorizo a publicação do meu nome e mensagem neste mural após a validação dos
                  noivos.{' '}
                  <button
                    type="button"
                    onClick={() => setPrivacyModalOpen(true)}
                    className="font-semibold text-terracota-escuro underline"
                  >
                    Ver política
                  </button>
                </span>
              </label>

              {errorMsg && (
                <p role="alert" className="rounded-md bg-terracota/10 px-3 py-2 text-xs text-terracota-escuro">
                  {errorMsg}
                </p>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="w-full rounded-md bg-terracota-escuro px-5 py-3 text-xs font-semibold tracking-wider text-creme-claro uppercase hover:bg-terracota disabled:opacity-50 transition-colors"
              >
                {submitting ? 'Enviando...' : 'Enviar mensagem'}
              </button>
            </form>
          </div>

          <div className="lg:col-span-7 space-y-5">
            {approvedMessages.length === 0 ? (
              <div className="rounded-lg border border-dourado/35 bg-creme-claro p-10 text-center">
                <MessageSquareHeart className="mx-auto h-9 w-9 text-dourado mb-3" />
                <h2 className="font-display text-2xl font-semibold text-marrom">
                  O mural aguarda as primeiras mensagens
                </h2>
                <p className="mt-2 text-sm text-marrom-suave">
                  Seja o primeiro a deixar uma bênção para Dalmo &amp; Jadi. Todas as mensagens
                  ficam visíveis logo após a aprovação dos noivos.
                </p>
              </div>
            ) : (
              approvedMessages.map((item) => (
                <article
                  key={item.id}
                  className="rounded-lg border border-dourado/35 bg-creme-claro p-6 shadow-sm"
                >
                  <p className="font-display text-xl italic leading-relaxed text-marrom">
                    “{item.message}”
                  </p>
                  <div className="mt-4 flex items-center gap-2 border-t border-dourado/20 pt-3 text-xs text-marrom-suave">
                    <span className="font-semibold text-terracota-escuro">{item.authorName}</span>
                    {item.relationship && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>{item.relationship}</span>
                      </>
                    )}
                  </div>
                </article>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
