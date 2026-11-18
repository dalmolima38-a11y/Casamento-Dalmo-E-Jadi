import React, { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CheckCircle2, Clock, Heart, RefreshCw, XCircle } from 'lucide-react';
import { WatercolorCorners } from '../components/WatercolorCorners';
import { useWedding } from '../context/WeddingContext';
import { formatBRL } from '../lib/pix';

interface MercadoPagoOrderStatusPayload {
  ok?: boolean;
  orderId?: string;
  mpOrderId?: string;
  mpPaymentId?: string;
  mpStatus?: string;
  mpStatusDetail?: string;
  method?: 'card' | 'pix';
  isPaid?: boolean;
  isPending?: boolean;
  isFailed?: boolean;
  isExpired?: boolean;
  isRefunded?: boolean;
  totalAmountCents?: number;
  error?: string;
}

export const ThankYouPage: React.FC = () => {
  const { settings } = useWedding();
  const [searchParams] = useSearchParams();
  const pedido = searchParams.get('pedido');
  const provider = searchParams.get('provider');
  const status = searchParams.get('status') || 'awaiting_confirmation';
  const isMercadoPagoReturn = provider === 'mercadopago' && Boolean(pedido);

  const [checkingMp, setCheckingMp] = useState(isMercadoPagoReturn);
  const [mpState, setMpState] = useState<MercadoPagoOrderStatusPayload | null>(null);

  const checkMercadoPagoStatus = useCallback(async () => {
    if (!pedido) return;
    setCheckingMp(true);
    try {
      const res = await fetch(`/api/mercadopago/orders/${encodeURIComponent(pedido)}/status`);
      const data = (await res.json().catch(() => ({}))) as MercadoPagoOrderStatusPayload;
      setMpState(data);
    } catch {
      setMpState({
        ok: false,
        isPending: true,
        error: 'Não foi possível consultar o status agora. Tente atualizar em instantes.',
      });
    } finally {
      setCheckingMp(false);
    }
  }, [pedido]);

  useEffect(() => {
    if (isMercadoPagoReturn) {
      checkMercadoPagoStatus();
    }
  }, [isMercadoPagoReturn, checkMercadoPagoStatus]);

  // Never trust URL return flags (?retorno=success) alone; only confirm when verified by API/Firestore
  const isConfirmed = isMercadoPagoReturn
    ? Boolean(mpState?.ok && mpState.isPaid)
    : status === 'confirmed';
  const isFailed = isMercadoPagoReturn && Boolean(mpState?.ok && (mpState.isFailed || mpState.isExpired || mpState.isRefunded));

  return (
    <div className="relative overflow-hidden py-16 sm:py-24">
      <WatercolorCorners variant="section" />
      <div className="relative z-20 mx-auto max-w-2xl px-4 sm:px-6">
        <div className="ornamental-frame rounded-xl bg-marfim/95 p-8 sm:p-12 text-center shadow-sm backdrop-blur-[2px]">
          {checkingMp ? (
            <RefreshCw className="mx-auto h-12 w-12 animate-spin text-terracota-escuro" />
          ) : isConfirmed ? (
            <CheckCircle2 className="mx-auto h-12 w-12 text-oliva" />
          ) : isFailed ? (
            <XCircle className="mx-auto h-12 w-12 text-terracota-escuro" />
          ) : (
            <Clock className="mx-auto h-12 w-12 text-terracota-escuro" />
          )}

          <p className="mt-4 text-xs font-semibold tracking-[0.2em] text-oliva uppercase">
            {checkingMp
              ? 'Verificando pagamento junto ao Mercado Pago...'
              : isConfirmed
                ? 'Pagamento Confirmado'
                : isFailed
                  ? mpState?.isExpired
                    ? 'Pagamento Expirado'
                    : mpState?.isRefunded
                      ? 'Pagamento Reembolsado'
                      : 'Pagamento Não Concluído'
                  : 'Aguardando Confirmação'}
          </p>

          <h1 className="mt-2 font-display text-4xl sm:text-5xl font-semibold text-marrom">
            {checkingMp
              ? 'Conferindo sua transação...'
              : isConfirmed
                ? 'Pagamento confirmado! 🌻💛'
                : isFailed
                  ? 'Não foi possível concluir o pagamento'
                  : 'Aguardando pagamento'}
          </h1>

          {pedido && (
            <div className="mt-2 space-y-1 text-xs font-mono text-marrom-suave">
              <p>Referência do pedido: {pedido}</p>
              {mpState?.mpOrderId && <p>Ordem Mercado Pago: {mpState.mpOrderId}</p>}
              {mpState?.mpPaymentId && <p>ID do pagamento: {mpState.mpPaymentId}</p>}
              {mpState?.totalAmountCents ? (
                <p>Valor: {formatBRL(mpState.totalAmountCents)}</p>
              ) : null}
            </div>
          )}

          <div className="mx-auto my-5 h-px w-24 bg-dourado/40" aria-hidden="true" />

          {checkingMp ? (
            <p className="text-base leading-relaxed text-marrom-suave">
              Estamos consultando diretamente a API oficial do Mercado Pago para confirmar o status
              real da sua transação.
            </p>
          ) : isConfirmed ? (
            <p className="text-base leading-relaxed text-marrom-suave">
              {settings.coupleNames} agradecem de coração pelo seu carinho e por fazer parte desse
              momento tão especial!
            </p>
          ) : isFailed ? (
            <p className="text-base leading-relaxed text-marrom-suave">
              O pagamento no Mercado Pago consta como{' '}
              <strong>{mpState?.mpStatus || 'não aprovado'}</strong>. Nenhuma cobrança foi
              confirmada. Você pode tentar novamente com outro cartão ou realizar um Pix direto na
              página de presentes.
            </p>
          ) : isMercadoPagoReturn ? (
            <div className="space-y-4">
              <p className="text-base leading-relaxed text-marrom-suave">
                O retorno ao site não confirma automaticamente o pagamento. Estamos aguardando a
                validação oficial do Mercado Pago{' '}
                {mpState?.mpStatus ? `(status atual: ${mpState.mpStatus})` : ''}.
              </p>
              {mpState?.error && (
                <p className="text-xs text-terracota-escuro">{mpState.error}</p>
              )}
              <button
                type="button"
                onClick={checkMercadoPagoStatus}
                className="inline-flex items-center gap-2 rounded-md border border-dourado bg-creme px-4 py-2 text-xs font-semibold uppercase tracking-wider text-marrom hover:bg-pergaminho transition-colors"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Atualizar status no Mercado Pago
              </button>
            </div>
          ) : (
            <p className="text-base leading-relaxed text-marrom-suave">
              Seu pedido foi registrado com o status <strong>Aguardando confirmação</strong>. Para
              Pix direto, a confirmação é concluída assim que os noivos conferirem o recebimento no
              banco.
            </p>
          )}

          <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link
              to="/presentes"
              className="w-full sm:w-auto rounded-md bg-terracota-escuro px-6 py-3 text-xs font-semibold tracking-wider text-creme-claro uppercase hover:bg-terracota transition-colors"
            >
              Voltar aos presentes
            </Link>
            <Link
              to="/recados"
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-md border border-terracota-escuro px-6 py-3 text-xs font-semibold tracking-wider text-terracota-escuro uppercase hover:bg-pergaminho transition-colors"
            >
              <Heart className="h-4 w-4" />
              Deixar recado no mural
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
};
