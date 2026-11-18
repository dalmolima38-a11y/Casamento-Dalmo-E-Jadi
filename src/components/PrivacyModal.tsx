import React from 'react';
import { ShieldCheck, X } from 'lucide-react';
import { useWedding } from '../context/WeddingContext';

export const PrivacyModal: React.FC = () => {
  const { privacyModalOpen, setPrivacyModalOpen, settings } = useWedding();

  if (!privacyModalOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-marrom/50 p-4 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-labelledby="lgpd-title"
    >
      <div className="max-h-[85vh] w-full max-w-xl overflow-y-auto rounded-lg border border-dourado/45 bg-creme-claro p-6 sm:p-8 shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-dourado/25 pb-4">
          <div className="flex items-center gap-2.5">
            <ShieldCheck className="h-5 w-5 text-salvia shrink-0" />
            <h2 id="lgpd-title" className="font-display text-2xl font-semibold text-marrom">
              Privacidade &amp; Proteção de Dados (LGPD)
            </h2>
          </div>
          <button
            type="button"
            onClick={() => setPrivacyModalOpen(false)}
            aria-label="Fechar política de privacidade"
            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-dourado/30 text-marrom hover:bg-pergaminho transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-5 space-y-4 text-sm leading-relaxed text-marrom-suave">
          <p>
            Em conformidade com a Lei Geral de Proteção de Dados (Lei nº 13.709/2018), os dados
            pessoais informados neste site — como nome, contato, lista de acompanhantes, recados,
            comprovantes Pix e fotografias — são utilizados exclusivamente para a organização e
            celebração do casamento de <strong>{settings.coupleNames}</strong>.
          </p>
          <p>
            <strong className="text-marrom">Isolamento de dados privados:</strong> respostas de
            confirmação de presença (RSVP), reservas de presentes e comprovantes são visíveis
            exclusivamente aos noivos autenticados no Painel Administrativo. Visitantes públicos não
            têm acesso a dados pessoais de outros convidados.
          </p>
          <p>
            <strong className="text-marrom">Moderação e consentimento:</strong> recados no mural e
            fotografias enviadas ao álbum colaborativo somente são exibidos publicamente após o
            seu consentimento expresso e aprovação prévia dos noivos.
          </p>
          <p>
            <strong className="text-marrom">Seus direitos:</strong> você pode solicitar a correção
            de sua confirmação de presença pelo link seguro recebido após o envio ou pedir a
            exclusão dos dados diretamente aos noivos
            {settings.lgpdContactEmail ? ` pelo e-mail ${settings.lgpdContactEmail}` : ''}.
          </p>
        </div>

        <div className="mt-6 flex justify-end border-t border-dourado/25 pt-4">
          <button
            type="button"
            onClick={() => setPrivacyModalOpen(false)}
            className="rounded-md bg-terracota-escuro px-5 py-2.5 text-xs font-semibold tracking-wider text-creme-claro uppercase hover:bg-terracota transition-colors"
          >
            Entendido
          </button>
        </div>
      </div>
    </div>
  );
};
