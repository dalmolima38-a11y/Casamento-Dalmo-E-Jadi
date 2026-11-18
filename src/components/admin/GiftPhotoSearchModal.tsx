import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Check,
  ExternalLink,
  Loader2,
  Maximize2,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  Store,
  Upload,
  X,
} from 'lucide-react';
import { getAdminAuthHeaders } from '../../lib/firebase';
import { formatBRL } from '../../lib/pix';
import { ResilientImage } from '../ResilientImage';

export interface GiftPhotoCandidate {
  id: string;
  provider: string;
  commercialName: string;
  brand: string;
  model: string;
  storeName: string;
  referencePriceCents: number | null;
  currency: 'BRL';
  productUrl: string;
  imageUrl: string;
  thumbnailUrl: string;
  licenseNotice: string;
  allowLocalSave: boolean;
  sourceType: 'official_manufacturer' | 'authorized_store' | 'serpapi_shopping';
  width: number;
  height: number;
}

export interface AppliedGiftPhotoPayload {
  imageUrl: string;
  photoSource: string;
  needsPhotoReview: boolean;
}

interface GiftPhotoSearchModalProps {
  open: boolean;
  giftTitle: string;
  currentImageUrl: string;
  currentPhotoSource?: string;
  previousImageUrl: string;
  previousPhotoSource?: string;
  onApplyPhoto: (payload: AppliedGiftPhotoPayload) => Promise<void> | void;
  onRestorePrevious: () => Promise<void> | void;
  onClose: () => void;
}

export const GiftPhotoSearchModal: React.FC<GiftPhotoSearchModalProps> = ({
  open,
  giftTitle,
  currentImageUrl,
  currentPhotoSource,
  previousImageUrl,
  previousPhotoSource,
  onApplyPhoto,
  onRestorePrevious,
  onClose,
}) => {
  const [searchInput, setSearchInput] = useState(giftTitle);
  const [brandFilter, setBrandFilter] = useState('');
  const [modelFilter, setModelFilter] = useState('');
  const [extraFilter, setExtraFilter] = useState('');
  const [hasSearched, setHasSearched] = useState(false);
  const [results, setResults] = useState<GiftPhotoCandidate[]>([]);
  const [providersUsed, setProvidersUsed] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [uploadingManual, setUploadingManual] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [appliedCandidateId, setAppliedCandidateId] = useState<string | null>(null);
  const [confirmingCandidate, setConfirmingCandidate] = useState<GiftPhotoCandidate | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const cancelPendingSearch = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
  }, []);

  const runSearch = useCallback(
    async (fresh = false) => {
      const cleanQ = searchInput.trim();
      if (!cleanQ) {
        setErrorMsg('Informe o nome do presente ou tipo de produto para pesquisar.');
        return;
      }

      cancelPendingSearch();
      const controller = new AbortController();
      abortRef.current = controller;

      setLoading(true);
      setErrorMsg(null);
      setStatusMsg(null);
      setConfirmingCandidate(null);

      try {
        const params = new URLSearchParams({ q: cleanQ });
        if (brandFilter.trim()) params.set('brand', brandFilter.trim());
        if (modelFilter.trim()) params.set('model', modelFilter.trim());
        if (extraFilter.trim()) params.set('extra', extraFilter.trim());
        if (fresh) params.set('fresh', '1');

        const authHeaders = await getAdminAuthHeaders();
        const response = await fetch(`/api/gifts/photo-search?${params.toString()}`, {
          headers: authHeaders,
          signal: controller.signal,
        });
        const data = (await response.json()) as {
          ok?: boolean;
          error?: string;
          providersUsed?: string[];
          results?: GiftPhotoCandidate[];
        };

        if (!response.ok) {
          throw new Error(data.error || 'Não foi possível consultar os catálogos comerciais.');
        }

        setResults((data.results || []).slice(0, 4));
        setProvidersUsed(data.providersUsed || []);
        setHasSearched(true);
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
        setErrorMsg(err instanceof Error ? err.message : 'Erro ao consultar produtos reais.');
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null;
          setLoading(false);
        }
      }
    },
    [searchInput, brandFilter, modelFilter, extraFilter, cancelPendingSearch]
  );

  useEffect(() => {
    if (!open) {
      cancelPendingSearch();
      return;
    }
    setSearchInput(giftTitle.trim());
    setBrandFilter('');
    setModelFilter('');
    setExtraFilter('');
    setResults([]);
    setProvidersUsed([]);
    setHasSearched(false);
    setAppliedCandidateId(null);
    setConfirmingCandidate(null);
    setStatusMsg(null);
    setErrorMsg(null);
  }, [open, giftTitle, cancelPendingSearch]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (confirmingCandidate) {
          setConfirmingCandidate(null);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, confirmingCandidate, onClose]);

  if (!open) return null;

  const canRestorePrevious =
    Boolean(previousImageUrl) &&
    (currentImageUrl.trim() !== previousImageUrl.trim() ||
      (currentPhotoSource || '') !== (previousPhotoSource || ''));

  const handleConfirmApplyCandidate = async () => {
    if (!confirmingCandidate) return;
    const candidate = confirmingCandidate;

    setApplying(true);
    setErrorMsg(null);
    setStatusMsg(null);

    try {
      let finalImageUrl = candidate.imageUrl;
      const sourceLabel = [
        candidate.storeName,
        candidate.brand,
        candidate.model ? `Mod. ${candidate.model}` : '',
      ]
        .filter(Boolean)
        .join(' · ')
        .slice(0, 160);

      if (candidate.allowLocalSave) {
        const authHeaders = await getAdminAuthHeaders();
        const res = await fetch('/api/media/gifts/import', {
          method: 'POST',
          headers: {
            ...authHeaders,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            url: candidate.imageUrl,
            title: giftTitle || searchInput,
            allowLocalSave: true,
          }),
        });
        const data = (await res.json()) as { ok?: boolean; url?: string; error?: string };
        if (!res.ok || !data.url) {
          throw new Error(data.error || 'Falha ao salvar a fotografia otimizada no projeto.');
        }
        finalImageUrl = data.url;
      }

      await onApplyPhoto({
        imageUrl: finalImageUrl.slice(0, 600),
        photoSource: sourceLabel,
        needsPhotoReview: false,
      });

      setAppliedCandidateId(candidate.id);
      setConfirmingCandidate(null);
      setStatusMsg(
        candidate.allowLocalSave
          ? 'Fotografia otimizada salva no projeto e aplicada somente a este presente.'
          : `URL comercial autorizada de ${candidate.storeName} aplicada somente a este presente.`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Não foi possível aplicar a fotografia.');
    } finally {
      setApplying(false);
    }
  };

  const handleManualFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    if (!['image/jpeg', 'image/jpg', 'image/png', 'image/webp'].includes(file.type)) {
      setErrorMsg('Envie um arquivo de imagem válido (JPG, PNG ou WEBP).');
      return;
    }
    if (file.size > 12 * 1024 * 1024) {
      setErrorMsg('A imagem selecionada excede o limite de 12 MB.');
      return;
    }

    setUploadingManual(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const authHeaders = await getAdminAuthHeaders();
      const response = await fetch('/api/media/gifts', {
        method: 'POST',
        headers: {
          ...authHeaders,
          'Content-Type': file.type,
        },
        body: file,
      });
      const data = (await response.json()) as { ok?: boolean; url?: string; error?: string };
      if (!response.ok || !data.url) {
        throw new Error(data.error || 'Não foi possível enviar a imagem manual.');
      }

      await onApplyPhoto({
        imageUrl: data.url,
        photoSource: 'Upload manual verificado (WebP/AVIF 4:3)',
        needsPhotoReview: false,
      });
      setAppliedCandidateId(null);
      setConfirmingCandidate(null);
      setStatusMsg('Upload manual otimizado em 800×600 (WebP/AVIF) e aplicado a este presente.');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erro ao enviar arquivo manual.');
    } finally {
      setUploadingManual(false);
    }
  };

  const handleRestoreClick = async () => {
    if (!canRestorePrevious) return;
    setRestoring(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      await onRestorePrevious();
      setAppliedCandidateId(null);
      setConfirmingCandidate(null);
      setStatusMsg('Foto anterior restaurada com sucesso.');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Não foi possível restaurar a foto anterior.');
    } finally {
      setRestoring(false);
    }
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void runSearch(false);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-marrom/65 p-3 sm:p-6 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-labelledby="gift-photo-search-title"
    >
      <div className="relative flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-lg border border-dourado/55 bg-creme-claro shadow-2xl">
        {/* Header */}
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-dourado/30 bg-creme px-5 py-4">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-dourado-escuro">
              Curadoria comercial verificada · Máximo 4 resultados
            </p>
            <h2
              id="gift-photo-search-title"
              className="font-display text-2xl font-semibold text-marrom truncate"
            >
              Buscar fotos reais — {giftTitle || 'Novo presente'}
            </h2>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar busca de fotos reais"
            className="inline-flex items-center gap-1.5 rounded-md border border-dourado/45 bg-creme-claro px-3 py-1.5 text-xs font-semibold text-marrom hover:bg-pergaminho"
          >
            <X className="h-4 w-4" />
            Fechar
          </button>
        </header>

        {/* Form & Refinement Controls */}
        <div className="border-b border-dourado/25 bg-creme/50 px-5 py-4 space-y-3">
          <form onSubmit={handleFormSubmit} className="space-y-2.5">
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
              <div className="lg:col-span-2">
                <label className="block text-[11px] font-medium text-marrom-suave mb-1">
                  Nome do presente / produto *
                </label>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-marrom-suave" />
                  <input
                    type="text"
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
                    placeholder="Ex.: Churrasqueira Elétrica, Jogo de Panelas, Air Fryer..."
                    aria-label="Nome do presente ou produto"
                    className="w-full rounded-md border border-dourado/45 bg-creme-claro py-2 pl-9 pr-3 text-sm text-marrom placeholder:text-marrom-suave/60 focus:border-terracota-escuro focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-marrom-suave mb-1">
                  Marca (opcional)
                </label>
                <input
                  type="text"
                  value={brandFilter}
                  onChange={(e) => setBrandFilter(e.target.value)}
                  placeholder="Ex.: Mondial, Brinox, Karsten"
                  aria-label="Filtrar por marca"
                  className="w-full rounded-md border border-dourado/45 bg-creme-claro px-3 py-2 text-sm text-marrom placeholder:text-marrom-suave/60 focus:border-terracota-escuro focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-marrom-suave mb-1">
                  Modelo ou palavras extras (opcional)
                </label>
                <input
                  type="text"
                  value={modelFilter ? `${modelFilter} ${extraFilter}`.trim() : extraFilter}
                  onChange={(e) => {
                    setModelFilter('');
                    setExtraFilter(e.target.value);
                  }}
                  placeholder="Ex.: Inox, Ceramic Life, 200 fios"
                  aria-label="Modelo ou palavras-chave extras"
                  className="w-full rounded-md border border-dourado/45 bg-creme-claro px-3 py-2 text-sm text-marrom placeholder:text-marrom-suave/60 focus:border-terracota-escuro focus:outline-none"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 pt-0.5">
              <button
                type="submit"
                disabled={loading}
                className="inline-flex items-center gap-1.5 rounded-md bg-terracota-escuro px-4 py-2 text-xs font-semibold uppercase tracking-wide text-creme-claro hover:bg-terracota disabled:opacity-60"
              >
                {loading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Search className="h-3.5 w-3.5" />
                )}
                BUSCAR FOTOS REAIS
              </button>

              {hasSearched && (
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => void runSearch(true)}
                  className="inline-flex items-center gap-1.5 rounded-md border border-dourado/55 bg-creme-claro px-3.5 py-2 text-xs font-semibold uppercase text-marrom hover:bg-pergaminho disabled:opacity-60"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  BUSCAR NOVAMENTE
                </button>
              )}

              <button
                type="button"
                disabled={uploadingManual}
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 rounded-md border border-dourado/55 bg-creme-claro px-3.5 py-2 text-xs font-semibold uppercase text-marrom hover:bg-pergaminho disabled:opacity-60"
              >
                {uploadingManual ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Upload className="h-3.5 w-3.5" />
                )}
                ENVIAR MINHA FOTO
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={handleManualFileChange}
                className="hidden"
              />

              <button
                type="button"
                disabled={!canRestorePrevious || restoring}
                onClick={handleRestoreClick}
                className="inline-flex items-center gap-1.5 rounded-md border border-dourado/55 bg-creme-claro px-3.5 py-2 text-xs font-semibold uppercase text-marrom hover:bg-pergaminho disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                RESTAURAR FOTO ANTERIOR
              </button>
            </div>
          </form>

          {/* Current card summary */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-dourado/30 bg-creme-claro px-3.5 py-2.5">
            <div className="flex items-center gap-3 min-w-0">
              <div className="h-12 w-16 shrink-0 overflow-hidden rounded border border-dourado/35 bg-pergaminho">
                <ResilientImage
                  src={currentImageUrl}
                  alt={giftTitle || 'Imagem atual'}
                  className="h-full w-full object-cover"
                />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-marrom">Imagem atual no cartão</p>
                <p className="text-[11px] text-marrom-suave truncate">
                  {currentPhotoSource || 'Imagem atual do presente'}
                </p>
              </div>
            </div>

            {providersUsed.length > 0 && (
              <p className="text-[11px] text-marrom-suave">
                Lojas verificadas:{' '}
                <strong className="font-medium text-marrom">{providersUsed.join(' · ')}</strong>
              </p>
            )}
          </div>

          {statusMsg && (
            <p className="flex items-center justify-between gap-2 rounded-md border border-oliva/45 bg-oliva/10 px-3.5 py-2 text-xs font-medium text-marrom">
              <span className="inline-flex items-center gap-2">
                <Check className="h-4 w-4 shrink-0 text-oliva" />
                {statusMsg}
              </span>
              <button
                type="button"
                onClick={onClose}
                className="shrink-0 rounded border border-oliva/50 bg-creme-claro px-2.5 py-1 text-[11px] font-semibold text-marrom hover:bg-pergaminho"
              >
                Concluir
              </button>
            </p>
          )}

          {errorMsg && (
            <p
              role="alert"
              className="flex items-center gap-2 rounded-md border border-terracota/40 bg-terracota/10 px-3.5 py-2 text-xs text-terracota-escuro"
            >
              <AlertCircle className="h-4 w-4 shrink-0" />
              {errorMsg}
            </p>
          )}
        </div>

        {/* Commercial Product Cards Area (max 4 results) */}
        <div className="flex-1 overflow-y-auto p-5">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-14 text-center text-marrom-suave">
              <Loader2 className="h-8 w-8 animate-spin text-terracota-escuro mb-3" />
              <p className="font-display text-xl text-marrom">
                Consultando catálogos oficiais de fabricantes e lojas...
              </p>
              <p className="mt-1 max-w-md text-xs">
                Buscando até 4 produtos comerciais verificados com marca, referência e vínculo oficial.
              </p>
            </div>
          ) : !hasSearched ? (
            <div className="flex flex-col items-center justify-center py-14 text-center text-marrom-suave">
              <Store className="h-9 w-9 text-dourado mb-2.5" />
              <p className="font-display text-xl text-marrom">
                Pronto para pesquisar produtos comerciais reais
              </p>
              <p className="mt-1.5 max-w-lg text-xs leading-relaxed">
                Ajuste o nome, marca ou palavras-chave acima se desejar e clique em{' '}
                <strong className="text-marrom">BUSCAR FOTOS REAIS</strong> para consultar até 4 produtos verificados em lojas e fabricantes oficiais — ou envie sua própria fotografia via{' '}
                <strong className="text-marrom">ENVIAR MINHA FOTO</strong>.
              </p>
            </div>
          ) : results.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-14 text-center text-marrom-suave">
              <AlertCircle className="h-9 w-9 text-terracota-escuro mb-2.5" />
              <p className="font-display text-xl text-marrom max-w-lg">
                Nenhum produto verificado encontrado. Refine sua pesquisa ou envie uma fotografia manualmente.
              </p>
              <div className="mt-4 flex flex-wrap justify-center gap-2.5">
                <button
                  type="button"
                  onClick={() => void runSearch(true)}
                  className="inline-flex items-center gap-1.5 rounded-md border border-dourado/55 bg-creme px-3.5 py-2 text-xs font-semibold uppercase text-marrom hover:bg-pergaminho"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  BUSCAR NOVAMENTE
                </button>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center gap-1.5 rounded-md bg-terracota-escuro px-3.5 py-2 text-xs font-semibold uppercase text-creme-claro hover:bg-terracota"
                >
                  <Upload className="h-3.5 w-3.5" />
                  ENVIAR MINHA FOTO
                </button>
              </div>
            </div>
          ) : (
            <div className="flex snap-x snap-mandatory gap-4 overflow-x-auto pb-2 sm:grid sm:grid-cols-2 lg:grid-cols-4 sm:overflow-visible">
              {results.slice(0, 4).map((item) => {
                const isApplied = appliedCandidateId === item.id;
                return (
                  <article
                    key={item.id}
                    className={`min-w-[270px] sm:min-w-0 snap-start flex flex-col justify-between overflow-hidden rounded-lg border bg-creme transition-shadow hover:shadow-md ${
                      isApplied
                        ? 'border-oliva ring-2 ring-oliva/60'
                        : 'border-dourado/40'
                    }`}
                  >
                    <div>
                      <div className="group relative aspect-[4/3] w-full overflow-hidden border-b border-dourado/25 bg-white p-2">
                        <ResilientImage
                          src={item.thumbnailUrl}
                          alt={item.commercialName}
                          className="h-full w-full object-contain transition-transform duration-300 group-hover:scale-[1.03]"
                        />
                        <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded bg-creme-claro/95 px-2 py-0.5 text-[10px] font-semibold text-marrom border border-dourado/40">
                          <ShieldCheck className="h-3 w-3 text-oliva" />
                          {item.brand}
                        </span>
                        <button
                          type="button"
                          onClick={() => setConfirmingCandidate(item)}
                          aria-label={`Visualizar ${item.commercialName}`}
                          className="absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded bg-marrom/80 text-creme-claro hover:bg-marrom"
                          title="Pré-visualizar e confirmar"
                        >
                          <Maximize2 className="h-3.5 w-3.5" />
                        </button>
                      </div>

                      <div className="p-3.5 space-y-1.5">
                        <h3
                          className="text-xs font-semibold leading-snug text-marrom line-clamp-2 min-h-[2.25rem]"
                          title={item.commercialName}
                        >
                          {item.commercialName}
                        </h3>

                        <div className="space-y-0.5 text-[11px] text-marrom-suave">
                          <p className="truncate">
                            <strong className="text-marrom font-medium">Marca:</strong> {item.brand}
                            {item.model ? ` · Mod.: ${item.model}` : ''}
                          </p>
                          <p className="truncate">
                            <strong className="text-marrom font-medium">Loja:</strong> {item.storeName}
                          </p>
                          {item.referencePriceCents !== null && (
                            <p className="text-xs font-semibold text-terracota-escuro tabular-nums">
                              Ref.: {formatBRL(item.referencePriceCents)}
                            </p>
                          )}
                        </div>

                        <p className="text-[10px] leading-snug text-marrom-suave/90 border-t border-dourado/20 pt-1.5">
                          {item.licenseNotice}
                        </p>
                      </div>
                    </div>

                    <div className="px-3.5 pb-3.5 pt-1 space-y-2">
                      <a
                        href={item.productUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex w-full items-center justify-center gap-1.5 rounded-md border border-dourado/55 bg-creme-claro px-3 py-1.5 text-[11px] font-semibold uppercase text-marrom hover:bg-pergaminho"
                      >
                        VER PRODUTO ORIGINAL
                        <ExternalLink className="h-3 w-3" />
                      </a>

                      <button
                        type="button"
                        onClick={() => setConfirmingCandidate(item)}
                        className={`flex w-full items-center justify-center gap-1.5 rounded-md px-3 py-2 text-xs font-semibold uppercase transition-colors ${
                          isApplied
                            ? 'bg-oliva text-white'
                            : 'bg-terracota-escuro text-creme-claro hover:bg-terracota'
                        }`}
                      >
                        <Check className="h-3.5 w-3.5" />
                        {isApplied ? 'Foto aplicada' : 'SELECIONAR FOTO'}
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>

        {/* Mandatory Explicit Confirmation Step */}
        {confirmingCandidate && (
          <div
            className="absolute inset-0 z-20 flex items-center justify-center bg-marrom/85 p-4 sm:p-8"
            role="dialog"
            aria-modal="true"
            aria-label="Confirmar aplicação da fotografia comercial"
          >
            <div className="flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-dourado/55 bg-creme-claro shadow-2xl">
              <div className="flex items-center justify-between border-b border-dourado/25 bg-creme px-5 py-3.5">
                <div className="min-w-0 pr-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-terracota-escuro">
                    Confirmação antes da substituição
                  </p>
                  <h4 className="font-display text-lg font-semibold text-marrom truncate">
                    Confirmar correspondência com: {giftTitle || 'Presente'}
                  </h4>
                </div>
                <button
                  type="button"
                  onClick={() => setConfirmingCandidate(null)}
                  className="inline-flex items-center gap-1 rounded-md border border-dourado/45 bg-creme-claro px-2.5 py-1.5 text-xs font-semibold text-marrom hover:bg-pergaminho"
                >
                  <X className="h-4 w-4" />
                  Voltar
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-5 grid grid-cols-1 gap-5 md:grid-cols-2 items-center">
                <div className="aspect-[4/3] w-full overflow-hidden rounded-md border border-dourado/35 bg-white p-3 flex items-center justify-center">
                  <ResilientImage
                    src={confirmingCandidate.imageUrl}
                    alt={confirmingCandidate.commercialName}
                    className="max-h-full max-w-full object-contain"
                  />
                </div>

                <div className="space-y-3 text-xs">
                  <div>
                    <p className="text-[11px] uppercase tracking-wider text-marrom-suave">
                      Produto comercial selecionado
                    </p>
                    <p className="mt-0.5 font-display text-lg font-semibold text-marrom leading-snug">
                      {confirmingCandidate.commercialName}
                    </p>
                  </div>

                  <div className="rounded-md border border-dourado/30 bg-creme px-3.5 py-2.5 space-y-1 text-marrom-suave">
                    <p>
                      <strong className="text-marrom">Marca:</strong> {confirmingCandidate.brand}
                    </p>
                    {confirmingCandidate.model && (
                      <p>
                        <strong className="text-marrom">Modelo:</strong> {confirmingCandidate.model}
                      </p>
                    )}
                    <p>
                      <strong className="text-marrom">Origem comercial:</strong>{' '}
                      {confirmingCandidate.storeName}
                    </p>
                    {confirmingCandidate.referencePriceCents !== null && (
                      <p>
                        <strong className="text-marrom">Preço de referência na loja:</strong>{' '}
                        <span className="font-semibold text-terracota-escuro">
                          {formatBRL(confirmingCandidate.referencePriceCents)}
                        </span>
                      </p>
                    )}
                  </div>

                  <div className="rounded-md border border-oliva/40 bg-oliva/10 px-3.5 py-2.5 text-marrom leading-relaxed">
                    <p className="font-semibold flex items-center gap-1.5">
                      <ShieldCheck className="h-4 w-4 text-oliva shrink-0" />
                      Permissão de uso e armazenamento
                    </p>
                    <p className="mt-1 text-[11px] text-marrom-suave">
                      {confirmingCandidate.licenseNotice} A alteração será aplicada exclusivamente ao item{' '}
                      <strong className="text-marrom">{giftTitle || 'selecionado'}</strong>, sem alterar nome, descrição ou valor cadastrado.
                    </p>
                  </div>

                  <a
                    href={confirmingCandidate.productUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 font-semibold text-terracota-escuro hover:underline"
                  >
                    VER PRODUTO ORIGINAL ({confirmingCandidate.storeName})
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-end gap-2.5 border-t border-dourado/25 bg-creme px-5 py-3.5">
                <button
                  type="button"
                  disabled={applying}
                  onClick={() => setConfirmingCandidate(null)}
                  className="rounded-md border border-dourado/45 bg-creme-claro px-4 py-2 text-xs font-semibold text-marrom hover:bg-pergaminho"
                >
                  Escolher outro produto
                </button>
                <button
                  type="button"
                  disabled={applying}
                  onClick={handleConfirmApplyCandidate}
                  className="inline-flex items-center gap-1.5 rounded-md bg-terracota-escuro px-4 py-2 text-xs font-semibold uppercase text-creme-claro hover:bg-terracota disabled:opacity-60"
                >
                  {applying ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Check className="h-3.5 w-3.5" />
                  )}
                  Confirmar e aplicar foto ao presente
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
