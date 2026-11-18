import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckSquare,
  Loader2,
  ShieldAlert,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import { getAdminAuthHeaders } from '../../lib/firebase';
import { GiftItem } from '../../types/wedding';
import { ResilientImage } from '../ResilientImage';

interface LegacyGalleryFileItem {
  id: string;
  filename: string;
  location: 'src_assets' | 'public_gifts';
  previewUrl: string;
  sizeBytes: number;
  deletable: boolean;
  statusLabel: string;
  inUseReason: string | null;
}

interface LegacyScanSummary {
  totalScanned: number;
  deletableCount: number;
  inUseArtificialCount: number;
  protectedSectionCount: number;
}

interface LegacyGalleryCleanupModalProps {
  open: boolean;
  gifts: GiftItem[];
  onClose: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  return `${kb.toFixed(1)} KB`;
}

export const LegacyGalleryCleanupModal: React.FC<LegacyGalleryCleanupModalProps> = ({
  open,
  gifts,
  onClose,
}) => {
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [items, setItems] = useState<LegacyGalleryFileItem[]>([]);
  const [summary, setSummary] = useState<LegacyScanSummary | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [awaitingDeleteConfirm, setAwaitingDeleteConfirm] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null);

  const runScan = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    setAwaitingDeleteConfirm(false);
    try {
      const activeImageUrls = gifts.map((g) => g.imageUrl).filter(Boolean);
      const authHeaders = await getAdminAuthHeaders();
      const res = await fetch('/api/media/gifts/legacy-scan', {
        method: 'POST',
        headers: {
          ...authHeaders,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ activeImageUrls }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        items?: LegacyGalleryFileItem[];
        summary?: LegacyScanSummary;
        error?: string;
      };
      if (!res.ok) {
        throw new Error(data.error || 'Não foi possível analisar os arquivos antigos.');
      }
      const scanned = data.items || [];
      setItems(scanned);
      setSummary(data.summary || null);
      // Do NOT auto-delete; clear selection or allow admin explicit choice
      setSelectedIds(new Set());
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erro ao listar galeria antiga.');
    } finally {
      setLoading(false);
    }
  }, [gifts]);

  useEffect(() => {
    if (!open) return;
    setFeedbackMsg(null);
    void runScan();
  }, [open, runScan]);

  if (!open) return null;

  const deletableItems = items.filter((i) => i.deletable);
  const inUseItems = items.filter((i) => !i.deletable);

  const toggleItem = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAllDeletable = () => {
    if (selectedIds.size === deletableItems.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(deletableItems.map((i) => i.id)));
    }
  };

  const handleConfirmDelete = async () => {
    const chosen = deletableItems.filter((i) => selectedIds.has(i.id));
    if (chosen.length === 0) return;

    setDeleting(true);
    setErrorMsg(null);
    setFeedbackMsg(null);
    try {
      const activeImageUrls = gifts.map((g) => g.imageUrl).filter(Boolean);
      const authHeaders = await getAdminAuthHeaders();
      const res = await fetch('/api/media/gifts/legacy-delete', {
        method: 'POST',
        headers: {
          ...authHeaders,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          confirmed: true,
          items: chosen.map((c) => ({ filename: c.filename, location: c.location })),
          activeImageUrls,
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        deletedCount?: number;
        error?: string;
      };
      if (!res.ok) {
        throw new Error(data.error || 'Não foi possível excluir os arquivos selecionados.');
      }
      setFeedbackMsg(
        `${data.deletedCount || 0} arquivo(s) antigo(s) não utilizado(s) excluído(s) com segurança.`
      );
      setAwaitingDeleteConfirm(false);
      await runScan();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erro ao limpar arquivos.');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-marrom/65 p-3 sm:p-6 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-labelledby="legacy-cleanup-title"
    >
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-dourado/55 bg-creme-claro shadow-2xl">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-dourado/30 bg-creme px-5 py-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-dourado-escuro">
              Saneamento seguro de mídias antigas
            </p>
            <h2 id="legacy-cleanup-title" className="font-display text-2xl font-semibold text-marrom">
              LIMPAR GALERIA ANTIGA
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-1.5 rounded-md border border-dourado/45 bg-creme-claro px-3 py-1.5 text-xs font-semibold text-marrom hover:bg-pergaminho"
          >
            <X className="h-4 w-4" />
            Fechar
          </button>
        </header>

        <div className="border-b border-dourado/25 bg-creme/50 px-5 py-3 text-xs text-marrom-suave space-y-2">
          <p>
            Esta ferramenta exibe prévias dos arquivos antigos/temporários de presentes. Arquivos em uso por presentes ou outras seções do site ficam protegidos para evitar qualquer cartão quebrado.
          </p>
          {summary && (
            <div className="flex flex-wrap gap-4 text-[11px]">
              <span>
                Disponíveis para exclusão:{' '}
                <strong className="text-marrom">{summary.deletableCount}</strong>
              </span>
              <span>
                Em uso no catálogo (protegidos):{' '}
                <strong className="text-terracota-escuro">{summary.inUseArtificialCount}</strong>
              </span>
              <span>
                Arquivos de outras seções protegidos:{' '}
                <strong className="text-oliva">{summary.protectedSectionCount}</strong>
              </span>
            </div>
          )}
          {feedbackMsg && (
            <p className="flex items-center gap-1.5 rounded border border-oliva/40 bg-oliva/10 px-3 py-1.5 text-xs text-marrom">
              <Check className="h-4 w-4 text-oliva shrink-0" />
              {feedbackMsg}
            </p>
          )}
          {errorMsg && (
            <p
              role="alert"
              className="rounded border border-terracota/40 bg-terracota/10 px-3 py-1.5 text-xs text-terracota-escuro"
            >
              {errorMsg}
            </p>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-12 text-marrom-suave">
              <Loader2 className="h-7 w-7 animate-spin text-terracota-escuro mb-2" />
              <p className="text-sm">Analisando arquivos de imagem da Lista de Presentes...</p>
            </div>
          ) : (
            <>
              {/* Deletable unused files */}
              <section className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-marrom">
                    Arquivos não utilizados prontos para remoção ({deletableItems.length})
                  </h3>
                  {deletableItems.length > 0 && (
                    <button
                      type="button"
                      onClick={toggleSelectAllDeletable}
                      className="inline-flex items-center gap-1.5 rounded border border-dourado/50 bg-creme px-3 py-1 text-xs font-semibold text-marrom hover:bg-pergaminho"
                    >
                      {selectedIds.size === deletableItems.length ? (
                        <CheckSquare className="h-3.5 w-3.5 text-terracota-escuro" />
                      ) : (
                        <Square className="h-3.5 w-3.5" />
                      )}
                      {selectedIds.size === deletableItems.length
                        ? 'Desmarcar todos'
                        : 'Selecionar todos não utilizados'}
                    </button>
                  )}
                </div>

                {deletableItems.length === 0 ? (
                  <p className="rounded-md border border-dourado/30 bg-creme px-4 py-3 text-xs text-marrom-suave">
                    Nenhum arquivo antigo ou temporário não utilizado foi encontrado.
                  </p>
                ) : (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {deletableItems.map((item) => {
                      const checked = selectedIds.has(item.id);
                      return (
                        <label
                          key={item.id}
                          className={`flex cursor-pointer items-center gap-3 rounded-md border p-2.5 transition-colors ${
                            checked
                              ? 'border-terracota-escuro bg-terracota/10'
                              : 'border-dourado/35 bg-creme hover:bg-pergaminho/40'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleItem(item.id)}
                            className="h-4 w-4 accent-terracota-escuro shrink-0"
                          />
                          <div className="h-12 w-16 shrink-0 overflow-hidden rounded border border-dourado/30 bg-creme-claro">
                            <ResilientImage
                              src={item.previewUrl}
                              alt={item.filename}
                              className="h-full w-full object-cover"
                            />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-[11px] font-semibold text-marrom truncate" title={item.filename}>
                              {item.filename}
                            </p>
                            <p className="text-[10px] text-marrom-suave">
                              {formatBytes(item.sizeBytes)} ·{' '}
                              {item.location === 'src_assets' ? 'Galeria antiga' : 'Upload antigo'}
                            </p>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                )}
              </section>

              {/* In-use legacy/artificial images */}
              {inUseItems.length > 0 && (
                <section className="space-y-3 border-t border-dourado/25 pt-5">
                  <div className="flex items-start gap-2 text-xs text-terracota-escuro">
                    <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5" />
                    <div>
                      <h3 className="font-semibold uppercase tracking-wider">
                        Fotos antigas ainda em uso ({inUseItems.length}) — exclusão bloqueada
                      </h3>
                      <p className="text-[11px] text-marrom-suave mt-0.5">
                        Substitua primeiro a fotografia dos presentes marcados como “Substituir foto artificial” via BUSCAR FOTOS REAIS ou ENVIAR MINHA FOTO. Isso garante que nenhum cartão fique com imagem quebrada.
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                    {inUseItems.map((item) => (
                      <div
                        key={item.id}
                        className="flex items-center gap-3 rounded-md border border-dourado/35 bg-pergaminho/40 p-2.5 opacity-85"
                      >
                        <div className="h-12 w-16 shrink-0 overflow-hidden rounded border border-dourado/30 bg-creme-claro">
                          <ResilientImage
                            src={item.previewUrl}
                            alt={item.filename}
                            className="h-full w-full object-cover"
                          />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-[11px] font-semibold text-marrom truncate">
                            {item.filename}
                          </p>
                          <p className="text-[10px] text-terracota-escuro">
                            {item.inUseReason || item.statusLabel}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </>
          )}
        </div>

        {/* Footer confirmation */}
        <footer className="border-t border-dourado/30 bg-creme px-5 py-3.5">
          {awaitingDeleteConfirm ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-terracota/50 bg-terracota/10 px-4 py-2.5">
              <span className="flex items-center gap-2 text-xs font-semibold text-terracota-escuro">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                Confirmar exclusão permanente de {selectedIds.size} arquivo(s) não utilizado(s)?
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={deleting}
                  onClick={() => setAwaitingDeleteConfirm(false)}
                  className="rounded-md border border-dourado/45 bg-creme-claro px-3 py-1.5 text-xs font-semibold text-marrom"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={deleting}
                  onClick={handleConfirmDelete}
                  className="inline-flex items-center gap-1.5 rounded-md bg-terracota-escuro px-3.5 py-1.5 text-xs font-semibold uppercase text-creme-claro hover:bg-terracota disabled:opacity-60"
                >
                  {deleting ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5" />
                  )}
                  Confirmar exclusão
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-xs text-marrom-suave">
                {selectedIds.size} arquivo(s) selecionado(s) para exclusão
              </span>
              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-md border border-dourado/45 bg-creme-claro px-4 py-2 text-xs font-semibold text-marrom hover:bg-pergaminho"
                >
                  Fechar
                </button>
                <button
                  type="button"
                  disabled={selectedIds.size === 0 || deleting}
                  onClick={() => setAwaitingDeleteConfirm(true)}
                  className="inline-flex items-center gap-1.5 rounded-md bg-terracota-escuro px-4 py-2 text-xs font-semibold uppercase text-creme-claro hover:bg-terracota disabled:opacity-45 disabled:cursor-not-allowed"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Excluir selecionados ({selectedIds.size})
                </button>
              </div>
            </div>
          )}
        </footer>
      </div>
    </div>
  );
};
