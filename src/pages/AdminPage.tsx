import React, { useEffect, useMemo, useState } from 'react';
import {
  Database,
  Download,
  Lock,
  LogIn,
  LogOut,
  RefreshCw,
  ShieldAlert,
} from 'lucide-react';
import { formatFirebaseAuthError, useWedding } from '../context/WeddingContext';
import { downloadCsv, formatBRL } from '../lib/pix';
import { AdminGiftsOrdersTab } from '../components/admin/AdminGiftsOrdersTab';
import { AdminRsvpTab } from '../components/admin/AdminRsvpTab';
import { AdminContentModerationTab } from '../components/admin/AdminContentModerationTab';
import { AdminSettingsTab } from '../components/admin/AdminSettingsTab';
import { AdminCeremonyTab } from '../components/admin/AdminCeremonyTab';

type AdminTab = 'overview' | 'rsvp' | 'gifts' | 'ceremony' | 'moderation' | 'settings';

export const AdminPage: React.FC = () => {
  const {
    user,
    authReady,
    isAdmin,
    adminCheckStatus,
    adminCheckError,
    authRedirectError,
    clearAuthRedirectError,
    loginWithGoogle,
    loginWithGoogleRedirect,
    retryAdminVerification,
    logout,
    settings,
    usingDemoSettings,
    seedDemoData,
    seeding,
    rsvps,
    rsvpRevisions,
    giftOrders,
    gifts,
    guestbookMessages,
    photos,
    timelineEvents,
    faqs,
    adminLogs,
  } = useWedding();

  const [tab, setTab] = useState<AdminTab>('overview');
  const [authError, setAuthError] = useState<string | null>(null);
  const [suggestRedirect, setSuggestRedirect] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);

  useEffect(() => {
    if (!authRedirectError) return;
    const formatted = formatFirebaseAuthError(authRedirectError);
    setAuthError(formatted.message);
    setSuggestRedirect(formatted.suggestRedirect);
  }, [authRedirectError]);

  const stats = useMemo(() => {
    const confirmedPeople = rsvps
      .filter((r) => r.attending && r.status !== 'declined')
      .reduce((acc, r) => acc + r.attendeesCount, 0);
    const pendingRsvps = rsvps.filter((r) => r.status === 'pending_review').length;
    const declinedRsvps = rsvps.filter((r) => !r.attending || r.status === 'declined').length;

    const reservedOrders = giftOrders.filter(
      (o) => !o.adminArchived && (o.status === 'reserved' || o.status === 'awaiting_confirmation')
    );
    const visibleOrdersCount = giftOrders.filter((o) => !o.adminArchived).length;
    const confirmedOrders = giftOrders.filter((o) => o.status === 'confirmed');
    const confirmedTotalCents = confirmedOrders.reduce((acc, o) => acc + o.amountCents, 0);

    const pendingMessages = guestbookMessages.filter((m) => m.status === 'pending').length;
    const pendingPhotos = photos.filter((p) => p.status === 'pending').length;

    return {
      confirmedPeople,
      pendingRsvps,
      declinedRsvps,
      reservedOrdersCount: reservedOrders.length,
      visibleOrdersCount,
      confirmedOrdersCount: confirmedOrders.length,
      confirmedTotalCents,
      pendingMessages,
      pendingPhotos,
      pendingRevisions: rsvpRevisions.filter((r) => r.reviewStatus === 'pending').length,
    };
  }, [rsvps, rsvpRevisions, giftOrders, guestbookMessages, photos]);

  // Call signInWithPopup directly from the click handler before any awaits to preserve browser user gesture
  const handleLogin = () => {
    if (authLoading) return;
    setAuthError(null);
    setSuggestRedirect(false);
    clearAuthRedirectError();
    setAuthLoading(true);
    loginWithGoogle()
      .catch((err) => {
        const formatted = formatFirebaseAuthError(err);
        setAuthError(formatted.message);
        setSuggestRedirect(formatted.suggestRedirect);
      })
      .finally(() => {
        setAuthLoading(false);
      });
  };

  const handleRedirectLogin = () => {
    if (authLoading) return;
    setAuthError(null);
    clearAuthRedirectError();
    setAuthLoading(true);
    loginWithGoogleRedirect().catch((err) => {
      const formatted = formatFirebaseAuthError(err);
      setAuthError(formatted.message);
      setAuthLoading(false);
    });
  };

  const handleExportBackupJson = () => {
    const backup = {
      exportedAt: new Date().toISOString(),
      mode: 'production',
      settings,
      gifts,
      giftOrders,
      rsvps,
      guestbookMessages,
      photos,
      timelineEvents,
      faqs,
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `backup-nosso-para-sempre-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportOrdersCsv = () => {
    downloadCsv(
      'presentes-pedidos-dalmo-e-jadi.csv',
      [
        'Pedido',
        'Convidado',
        'Contato',
        'Presentes selecionados',
        'Valor (R$)',
        'Forma de pagamento',
        'Status da transação',
        'ID Ordem MP',
        'ID Pagamento MP',
        'Observação',
      ],
      giftOrders.map((o) => [
        o.id,
        o.giverName,
        o.giverContact,
        o.giftTitle,
        (o.amountCents / 100).toFixed(2),
        o.paymentMethod,
        o.adminArchived
          ? `${o.status} (arquivado)`
          : o.mpTransactionStatus
            ? `${o.status} / MP:${o.mpTransactionStatus}`
            : o.status,
        o.mpOrderId || '',
        o.mpPaymentId || '',
        o.receiptNote || '',
      ])
    );
  };

  if (!authReady) {
    return (
      <div className="paper-texture py-24 text-center text-sm text-marrom-suave">
        Carregando painel administrativo...
      </div>
    );
  }

  // Simplified single-action Google login screen
  if (!user) {
    return (
      <div className="paper-texture py-16 sm:py-24">
        <div className="mx-auto max-w-md px-4">
          <div className="ornamental-frame rounded-xl bg-creme-claro p-8 sm:p-10 text-center shadow-sm">
            <Lock className="mx-auto h-10 w-10 text-terracota-escuro" />
            <h1 className="mt-4 font-display text-3xl font-semibold text-marrom">
              Painel Administrativo
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-marrom-suave">
              Acesso restrito aos noivos e administradores autorizados.
            </p>

            {authError && (
              <div
                role="alert"
                className="mt-5 rounded-md border border-terracota/35 bg-terracota/10 p-3.5 text-left text-xs leading-relaxed text-terracota-escuro"
              >
                {authError}
              </div>
            )}

            <div className="mt-6 space-y-3">
              <button
                type="button"
                onClick={handleLogin}
                disabled={authLoading}
                className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-terracota-escuro px-5 py-3.5 text-xs font-semibold tracking-wider text-creme-claro uppercase hover:bg-terracota transition-colors disabled:opacity-60"
              >
                <LogIn className="h-4 w-4" />
                {authLoading ? 'Conectando ao Google...' : 'Entrar com o Google'}
              </button>

              {suggestRedirect && (
                <button
                  type="button"
                  onClick={handleRedirectLogin}
                  disabled={authLoading}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-dourado bg-creme px-5 py-3 text-xs font-semibold tracking-wider text-marrom uppercase hover:bg-pergaminho transition-colors disabled:opacity-60"
                >
                  <LogIn className="h-4 w-4" />
                  Entrar por redirecionamento Google
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Wait for backend token + allowlist verification before rendering panel or denying access
  if (adminCheckStatus === 'checking' && !isAdmin) {
    return (
      <div className="paper-texture py-24">
        <div className="mx-auto max-w-md px-4 text-center">
          <div className="ornamental-frame rounded-xl bg-creme-claro p-8 shadow-sm">
            <RefreshCw className="mx-auto h-9 w-9 animate-spin text-terracota-escuro" />
            <p className="mt-4 font-display text-2xl font-semibold text-marrom">
              Verificando permissões...
            </p>
            <p className="mt-1.5 text-xs text-marrom-suave">
              Validando sua conta Google ({user.email}) junto ao servidor.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Temporary backend validation error
  if (adminCheckStatus === 'error' && !isAdmin) {
    return (
      <div className="paper-texture py-20">
        <div className="mx-auto max-w-lg px-4">
          <div className="ornamental-frame rounded-xl bg-creme-claro p-8 text-center shadow-sm">
            <ShieldAlert className="mx-auto h-10 w-10 text-terracota-escuro" />
            <h1 className="mt-4 font-display text-3xl font-semibold text-marrom">
              Falha na verificação
            </h1>
            <p className="mt-2 text-sm text-marrom-suave">
              {adminCheckError || 'Não foi possível validar sua sessão administrativa no servidor.'}
            </p>
            <div className="mt-6 flex flex-col sm:flex-row justify-center gap-3">
              <button
                type="button"
                onClick={() => void retryAdminVerification()}
                className="inline-flex items-center justify-center gap-2 rounded-md bg-terracota-escuro px-5 py-2.5 text-xs font-semibold text-creme-claro uppercase hover:bg-terracota"
              >
                <RefreshCw className="h-4 w-4" />
                Tentar novamente
              </button>
              <button
                type="button"
                onClick={() => void logout()}
                className="inline-flex items-center justify-center gap-2 rounded-md border border-terracota-escuro px-5 py-2.5 text-xs font-semibold text-terracota-escuro uppercase hover:bg-pergaminho"
              >
                <LogOut className="h-4 w-4" />
                Sair desta conta
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Strictly block any signed-in Google account without admin authorization
  if (!isAdmin) {
    return (
      <div className="paper-texture py-20">
        <div className="mx-auto max-w-lg px-4">
          <div className="ornamental-frame rounded-xl border border-terracota/40 bg-creme-claro p-8 text-center shadow-sm">
            <ShieldAlert className="mx-auto h-10 w-10 text-terracota-escuro" />
            <h1 className="mt-4 font-display text-3xl font-semibold text-marrom">
              Acesso não autorizado
            </h1>
            <p className="mt-3 text-sm font-medium text-terracota-escuro">
              {adminCheckError ||
                'Esta conta Google não possui permissão para acessar o painel administrativo.'}
            </p>
            <p className="mt-2 text-xs text-marrom-suave">
              Conta conectada: <strong>{user.email}</strong>
            </p>
            <p className="mt-1 text-[11px] font-mono text-marrom-suave/80">UID: {user.uid}</p>
            <div className="mt-6 flex flex-col sm:flex-row justify-center gap-3">
              <button
                type="button"
                onClick={handleLogin}
                disabled={authLoading}
                className="inline-flex items-center justify-center gap-2 rounded-md bg-terracota-escuro px-5 py-2.5 text-xs font-semibold text-creme-claro uppercase hover:bg-terracota disabled:opacity-60"
              >
                <LogIn className="h-4 w-4" />
                Trocar conta Google
              </button>
              <button
                type="button"
                onClick={() => void logout()}
                className="inline-flex items-center justify-center gap-2 rounded-md border border-terracota-escuro px-5 py-2.5 text-xs font-semibold text-terracota-escuro uppercase hover:bg-pergaminho"
              >
                <LogOut className="h-4 w-4" />
                Sair desta conta
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const goalPct =
    settings.goalAmountCents > 0
      ? Math.min(100, Math.round((stats.confirmedTotalCents / settings.goalAmountCents) * 100))
      : 0;

  return (
    <div className="paper-texture py-10 sm:py-14">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 space-y-8">
        {/* Header */}
        <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-dourado/30 pb-6">
          <div>
            <p className="text-xs font-semibold tracking-widest text-salvia uppercase">
              Painel dos Noivos · {user.email}
            </p>
            <h1 className="mt-1 font-display text-3xl sm:text-4xl font-semibold text-marrom">
              Gestão do Casamento
            </h1>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {usingDemoSettings && (
              <button
                type="button"
                disabled={seeding}
                onClick={seedDemoData}
                className="inline-flex items-center gap-2 rounded-md bg-salvia px-4 py-2 text-xs font-semibold text-white uppercase hover:opacity-90 disabled:opacity-50"
              >
                <Database className="h-4 w-4" />
                {seeding ? 'Sincronizando...' : 'Inicializar dados no Firestore'}
              </button>
            )}
            <button
              type="button"
              onClick={() => void logout()}
              className="inline-flex items-center gap-2 rounded-md border border-dourado/45 bg-creme-claro px-4 py-2 text-xs font-semibold text-marrom uppercase hover:bg-pergaminho"
            >
              <LogOut className="h-4 w-4" />
              Sair
            </button>
          </div>
        </header>

        {/* Navigation Tabs */}
        <nav className="flex flex-wrap gap-2" aria-label="Abas administrativas">
          {(
            [
              ['overview', 'Visão Geral & Relatórios'],
              [
                'rsvp',
                `Convidados (${rsvps.length}${
                  stats.pendingRevisions > 0 ? ` · ${stats.pendingRevisions} rev.` : ''
                })`,
              ],
              ['gifts', `Presentes & Pedidos (${stats.visibleOrdersCount})`],
              ['ceremony', 'Cerimônia'],
              [
                'moderation',
                `Mural & Galeria (${stats.pendingMessages + stats.pendingPhotos} pend.)`,
              ],
              ['settings', 'Configurações & Admins'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`rounded-md px-4 py-2.5 text-xs font-semibold uppercase tracking-wider transition-colors ${
                tab === key
                  ? 'bg-terracota-escuro text-creme-claro'
                  : 'border border-dourado/40 bg-creme-claro text-marrom hover:bg-pergaminho'
              }`}
            >
              {label}
            </button>
          ))}
        </nav>

        {/* Tab Content */}
        {tab === 'overview' && (
          <div className="space-y-8">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-lg border border-dourado/35 bg-creme-claro p-5">
                <p className="text-xs text-marrom-suave uppercase">Pessoas Confirmadas</p>
                <p className="mt-2 font-display text-4xl font-semibold text-salvia tabular-nums">
                  {stats.confirmedPeople}
                </p>
                <p className="mt-1 text-xs text-marrom-suave">
                  {stats.pendingRsvps} pendentes · {stats.declinedRsvps} recusas
                </p>
              </div>

              <div className="rounded-lg border border-dourado/35 bg-creme-claro p-5">
                <p className="text-xs text-marrom-suave uppercase">Presentes Reservados</p>
                <p className="mt-2 font-display text-4xl font-semibold text-terracota-escuro tabular-nums">
                  {stats.reservedOrdersCount}
                </p>
                <p className="mt-1 text-xs text-marrom-suave">Aguardando confirmação</p>
              </div>

              <div className="rounded-lg border border-dourado/35 bg-creme-claro p-5">
                <p className="text-xs text-marrom-suave uppercase">Pagamentos Confirmados</p>
                <p className="mt-2 font-display text-3xl font-semibold text-marrom tabular-nums">
                  {formatBRL(stats.confirmedTotalCents)}
                </p>
                <p className="mt-1 text-xs text-marrom-suave">
                  {stats.confirmedOrdersCount} presente(s) confirmado(s)
                </p>
              </div>

              <div className="rounded-lg border border-dourado/35 bg-creme-claro p-5">
                <p className="text-xs text-marrom-suave uppercase">Moderação Pendente</p>
                <p className="mt-2 font-display text-4xl font-semibold text-marrom tabular-nums">
                  {stats.pendingMessages + stats.pendingPhotos}
                </p>
                <p className="mt-1 text-xs text-marrom-suave">
                  {stats.pendingMessages} recados · {stats.pendingPhotos} fotos
                </p>
              </div>
            </div>

            <section className="rounded-lg border border-dourado/35 bg-creme-claro p-6">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-xs font-semibold uppercase text-salvia">Meta dos Noivos</p>
                  <h2 className="font-display text-2xl font-semibold text-marrom">
                    {settings.goalTitle}
                  </h2>
                </div>
                <p className="text-sm font-semibold text-terracota-escuro tabular-nums">
                  {formatBRL(stats.confirmedTotalCents)} de {formatBRL(settings.goalAmountCents)} (
                  {goalPct}%)
                </p>
              </div>
              <div className="mt-4 h-3 w-full overflow-hidden rounded-full bg-pergaminho">
                <div
                  className="h-full bg-terracota-escuro transition-all duration-300"
                  style={{ width: `${goalPct}%` }}
                />
              </div>
            </section>

            <section className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-dourado/35 bg-creme-claro p-6">
              <div>
                <h2 className="font-display text-2xl font-semibold text-marrom">
                  Relatórios &amp; Backups
                </h2>
                <p className="text-xs text-marrom-suave">
                  Exporte planilhas CSV de presentes e faça backup completo em JSON.
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={handleExportOrdersCsv}
                  className="inline-flex items-center gap-2 rounded-md border border-terracota-escuro px-4 py-2 text-xs font-semibold text-terracota-escuro uppercase hover:bg-terracota/10"
                >
                  <Download className="h-4 w-4" />
                  CSV Presentes &amp; Pedidos
                </button>
                <button
                  type="button"
                  onClick={handleExportBackupJson}
                  className="inline-flex items-center gap-2 rounded-md bg-terracota-escuro px-4 py-2 text-xs font-semibold text-creme-claro uppercase hover:bg-terracota"
                >
                  <Download className="h-4 w-4" />
                  Backup Completo (JSON)
                </button>
              </div>
            </section>

            <section className="rounded-lg border border-dourado/35 bg-creme-claro p-6">
              <h2 className="font-display text-2xl font-semibold text-marrom">
                Registro de Atividades Administrativas
              </h2>
              {adminLogs.length === 0 ? (
                <p className="mt-3 text-sm text-marrom-suave">
                  Nenhuma ação administrativa registrada ainda.
                </p>
              ) : (
                <ul className="mt-4 divide-y divide-dourado/20 text-xs">
                  {adminLogs.slice(0, 15).map((log) => (
                    <li key={log.id} className="flex flex-wrap justify-between gap-2 py-2.5">
                      <span>
                        <strong className="text-marrom">{log.action}</strong> —{' '}
                        <span className="text-marrom-suave">{log.details}</span>
                      </span>
                      <span className="text-marrom-suave">{log.actorEmail}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}

        {tab === 'rsvp' && <AdminRsvpTab />}
        {tab === 'gifts' && <AdminGiftsOrdersTab />}
        {tab === 'ceremony' && <AdminCeremonyTab />}
        {tab === 'moderation' && <AdminContentModerationTab />}
        {tab === 'settings' && <AdminSettingsTab />}
      </div>
    </div>
  );
};
