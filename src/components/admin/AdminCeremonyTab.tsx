import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowDown,
  ArrowLeftRight,
  ArrowUp,
  CheckCircle2,
  Eye,
  EyeOff,
  Heart,
  Image as ImageIcon,
  Loader2,
  MapPin,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { useWedding } from '../../context/WeddingContext';
import { DEFAULT_PADRINHOS_SLOTS, DEFAULT_SITE_SETTINGS } from '../../data/defaults';
import { db, getAdminAuthHeaders } from '../../lib/firebase';
import {
  formatBytesCompact,
  getCeremonyPhotoFallbackUrl,
  isSupportedImageFile,
  OptimizedImageResult,
  optimizeImageForUpload,
  uploadCeremonyPhotoViaServer,
} from '../../lib/imageOptimizer';
import { generateRandomToken } from '../../lib/pix';
import {
  normalizeVenueCityDisplay,
  resolveCeremonyPastor,
  resolvePadrinhosList,
  sanitizeSiteSettingsForFirestore,
} from '../../lib/settingsSanitizer';
import {
  CeremonyChurchInfo,
  CeremonyPublicData,
  PadrinhoEntry,
  PadrinhoSide,
  SiteSettings,
} from '../../types/wedding';

const DEFAULT_CHURCH_PHOTO = '/images/igreja-jardim-florestal.png';

function createUniquePadrinhoId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function normalizeSideEntries(list: PadrinhoEntry[], side: PadrinhoSide): PadrinhoEntry[] {
  const seen = new Set<string>();
  return list
    .map((item, idx) => {
      let id = (item.id || createUniquePadrinhoId(`padrinho-${side}`)).trim();
      while (seen.has(id)) {
        id = createUniquePadrinhoId(`padrinho-${side}`);
      }
      seen.add(id);
      return {
        id,
        side,
        name: typeof item.name === 'string' ? item.name : '',
        published: item.published !== false,
        order: idx + 1,
      };
    });
}

function splitPadrinhosBySide(entries?: PadrinhoEntry[]): {
  bridesmaids: PadrinhoEntry[];
  groomsmen: PadrinhoEntry[];
} {
  const resolved = resolvePadrinhosList(entries);
  const bridesmaids = normalizeSideEntries(
    resolved.filter((p) => p.side === 'noiva').sort((a, b) => a.order - b.order),
    'noiva'
  );
  const groomsmen = normalizeSideEntries(
    resolved.filter((p) => p.side === 'noivo').sort((a, b) => a.order - b.order),
    'noivo'
  );
  return { bridesmaids, groomsmen };
}

function isEphemeralPhotoUrl(url?: string): boolean {
  const trimmed = (url || '').trim();
  return trimmed.startsWith('/assets/aistudio/') || trimmed.startsWith('/images/ceremony/');
}

function buildChurchStateFromSettings(s: SiteSettings): CeremonyChurchInfo {
  const rawPhoto = (s.venuePhotoUrl || '').trim();
  return {
    name: (s.venueName || DEFAULT_SITE_SETTINGS.venueName).trim(),
    city: normalizeVenueCityDisplay(s.venueCity),
    cep: (s.venueCep ?? DEFAULT_SITE_SETTINGS.venueCep ?? '').trim(),
    streetAddress: (s.venueStreetAddress ?? DEFAULT_SITE_SETTINGS.venueStreetAddress).trim(),
    coordinates: (s.venueCoordinates ?? '').trim(),
    mapUrl: (s.venueMapUrl ?? '').trim(),
    photoUrl: rawPhoto && !isEphemeralPhotoUrl(rawPhoto) ? rawPhoto : DEFAULT_CHURCH_PHOTO,
    dateDisplay: (s.weddingDateDisplay || DEFAULT_SITE_SETTINGS.weddingDateDisplay).trim(),
    timeDisplay: (s.weddingTimeDisplay || DEFAULT_SITE_SETTINGS.weddingTimeDisplay).trim(),
    pastor: resolveCeremonyPastor(s.ceremonyPastor),
    planner: (s.ceremonyPlanner || DEFAULT_SITE_SETTINGS.ceremonyPlanner || '').trim(),
  };
}

interface PendingChurchPhoto {
  optimized: OptimizedImageResult;
  previewUrl: string;
}

export const AdminCeremonyTab: React.FC = () => {
  const {
    settings,
    user,
    isAdmin,
    ceremonySha: contextCeremonySha,
    ceremonySource: contextCeremonySource,
    applySavedCeremony,
  } = useWedding();

  const initialSides = useMemo(
    () =>
      splitPadrinhosBySide(
        settings.padrinhos !== undefined ? settings.padrinhos : DEFAULT_PADRINHOS_SLOTS
      ),
    // Only used for initial mount; subsequent syncing respects isDirty
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const [church, setChurch] = useState<CeremonyChurchInfo>(() =>
    buildChurchStateFromSettings(settings)
  );
  const [bridesmaids, setBridesmaids] = useState<PadrinhoEntry[]>(initialSides.bridesmaids);
  const [groomsmen, setGroomsmen] = useState<PadrinhoEntry[]>(initialSides.groomsmen);

  const [ceremonySha, setCeremonySha] = useState<string | null>(contextCeremonySha);
  const [ceremonySource, setCeremonySource] = useState<'github' | 'defaults'>(contextCeremonySource);
  const [isDirty, setIsDirty] = useState(false);

  const [pendingPhoto, setPendingPhoto] = useState<PendingChurchPhoto | null>(null);
  const [resetPhotoToDefault, setResetPhotoToDefault] = useState(false);
  const [optimizingPhoto, setOptimizingPhoto] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [previewFallbackActive, setPreviewFallbackActive] = useState(false);

  const [loadingRemote, setLoadingRemote] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [conflictDetected, setConflictDetected] = useState(false);
  const [githubReady, setGithubReady] = useState<boolean>(true);
  const [githubWarning, setGithubWarning] = useState<string | null>(null);

  const pendingUrlRef = useRef<string | null>(null);
  const isDirtyRef = useRef(isDirty);
  isDirtyRef.current = isDirty;

  useEffect(() => {
    return () => {
      if (pendingUrlRef.current) {
        URL.revokeObjectURL(pendingUrlRef.current);
        pendingUrlRef.current = null;
      }
    };
  }, []);

  const clearPendingPhoto = useCallback(() => {
    if (pendingUrlRef.current) {
      URL.revokeObjectURL(pendingUrlRef.current);
      pendingUrlRef.current = null;
    }
    setPendingPhoto(null);
    setUploadProgress(null);
  }, []);

  const hydrateFromCeremonyData = useCallback(
    (data: CeremonyPublicData, sha: string | null, source: 'github' | 'defaults') => {
      setChurch({
        ...data.church,
        photoUrl:
          data.church.photoUrl && !isEphemeralPhotoUrl(data.church.photoUrl)
            ? data.church.photoUrl
            : DEFAULT_CHURCH_PHOTO,
      });
      setBridesmaids(normalizeSideEntries(data.bridesmaids || [], 'noiva'));
      setGroomsmen(normalizeSideEntries(data.groomsmen || [], 'noivo'));
      setCeremonySha(sha);
      setCeremonySource(source);
      setResetPhotoToDefault(false);
      setPreviewFallbackActive(false);
      setConflictDetected(false);
      setIsDirty(false);
    },
    []
  );

  const loadLatestCeremonyFromGitHub = useCallback(
    async (forceReplace = false) => {
      if (!user || !isAdmin) return;
      setLoadingRemote(true);
      try {
        let headers = await getAdminAuthHeaders(false);
        let res = await fetch(`/api/admin/ceremony?t=${Date.now()}`, {
          cache: 'no-store',
          headers,
        });
        if (res.status === 401) {
          headers = await getAdminAuthHeaders(true);
          res = await fetch(`/api/admin/ceremony?t=${Date.now()}`, {
            cache: 'no-store',
            headers,
          });
        }
        const payload = (await res.json().catch(() => null)) as {
          ok?: boolean;
          source?: 'github' | 'defaults';
          sha?: string | null;
          data?: CeremonyPublicData;
          githubConfigured?: boolean;
          githubError?: string;
          error?: string;
        } | null;

        if (!res.ok || !payload?.ok || !payload.data) {
          if (payload?.error) {
            setGithubWarning(payload.error);
          }
          return;
        }

        setGithubReady(payload.githubConfigured !== false);
        setGithubWarning(payload.githubError || null);

        if (forceReplace || !isDirtyRef.current) {
          clearPendingPhoto();
          hydrateFromCeremonyData(
            payload.data,
            payload.sha ?? null,
            payload.source === 'github' ? 'github' : 'defaults'
          );
          if (payload.source === 'github' && payload.sha) {
            applySavedCeremony(payload.data, payload.sha);
          }
        }
      } catch {
        // Keep current state cleanly if offline
      } finally {
        setLoadingRemote(false);
      }
    },
    [user, isAdmin, clearPendingPhoto, hydrateFromCeremonyData, applySavedCeremony]
  );

  useEffect(() => {
    void loadLatestCeremonyFromGitHub(false);
  }, [loadLatestCeremonyFromGitHub]);

  // Keep synced with WeddingContext only when user has NOT edited anything locally
  useEffect(() => {
    if (isDirty) return;
    if (ceremonySource === 'defaults' && contextCeremonySource === 'github') {
      setChurch(buildChurchStateFromSettings(settings));
      const sides = splitPadrinhosBySide(settings.padrinhos);
      setBridesmaids(sides.bridesmaids);
      setGroomsmen(sides.groomsmen);
      setCeremonySha(contextCeremonySha);
      setCeremonySource(contextCeremonySource);
    }
  }, [isDirty, settings, contextCeremonySha, contextCeremonySource, ceremonySource]);

  const activePhotoDisplayUrl = useMemo(() => {
    if (pendingPhoto) return pendingPhoto.previewUrl;
    if (resetPhotoToDefault) return DEFAULT_CHURCH_PHOTO;
    const raw = (church.photoUrl || '').trim();
    if (!raw || isEphemeralPhotoUrl(raw)) return DEFAULT_CHURCH_PHOTO;
    if (previewFallbackActive) {
      return getCeremonyPhotoFallbackUrl(raw) || DEFAULT_CHURCH_PHOTO;
    }
    return raw;
  }, [pendingPhoto, resetPhotoToDefault, church.photoUrl, previewFallbackActive]);

  const handleSelectChurchPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setErrorMsg(null);
    setSavedMessage(null);
    setConflictDetected(false);

    if (!isSupportedImageFile(file)) {
      setErrorMsg('Formato não suportado. Selecione uma imagem JPG, JPEG, PNG ou WEBP.');
      return;
    }

    setOptimizingPhoto(true);
    try {
      const optimized = await optimizeImageForUpload(file, {
        maxDimension: 1600,
        targetMaxBytes: 1200 * 1024,
        quality: 0.86,
      });

      const objectUrl = URL.createObjectURL(optimized.blob);
      if (pendingUrlRef.current) {
        URL.revokeObjectURL(pendingUrlRef.current);
      }
      pendingUrlRef.current = objectUrl;

      setPendingPhoto({ optimized, previewUrl: objectUrl });
      setResetPhotoToDefault(false);
      setPreviewFallbackActive(false);
      setIsDirty(true);
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Não foi possível preparar a fotografia selecionada.'
      );
    } finally {
      setOptimizingPhoto(false);
    }
  };

  const updateChurchField = <K extends keyof CeremonyChurchInfo>(
    field: K,
    value: CeremonyChurchInfo[K]
  ) => {
    setChurch((prev) => ({ ...prev, [field]: value }));
    if (field === 'photoUrl') {
      setResetPhotoToDefault(false);
      setPreviewFallbackActive(false);
    }
    setSavedMessage(null);
    setErrorMsg(null);
    setIsDirty(true);
  };

  const handleAddPerson = (side: PadrinhoSide) => {
    const totalCount = bridesmaids.length + groomsmen.length;
    if (totalCount >= 60) return;

    const entry: PadrinhoEntry = {
      id: createUniquePadrinhoId(`padrinho-${side}`),
      side,
      name: '',
      published: true,
      order: (side === 'noiva' ? bridesmaids.length : groomsmen.length) + 1,
    };

    if (side === 'noiva') {
      setBridesmaids((prev) => normalizeSideEntries([...prev, entry], 'noiva'));
    } else {
      setGroomsmen((prev) => normalizeSideEntries([...prev, entry], 'noivo'));
    }
    setSavedMessage(null);
    setErrorMsg(null);
    setIsDirty(true);
  };

  const handleUpdatePerson = (
    side: PadrinhoSide,
    id: string,
    patch: Partial<Pick<PadrinhoEntry, 'name' | 'published'>>
  ) => {
    const updater = (prev: PadrinhoEntry[]) =>
      prev.map((item) => (item.id === id ? { ...item, ...patch } : item));
    if (side === 'noiva') {
      setBridesmaids(updater);
    } else {
      setGroomsmen(updater);
    }
    setSavedMessage(null);
    setErrorMsg(null);
    setIsDirty(true);
  };

  const handleMoveSide = (fromSide: PadrinhoSide, id: string) => {
    const sourceList = fromSide === 'noiva' ? bridesmaids : groomsmen;
    const targetItem = sourceList.find((item) => item.id === id);
    if (!targetItem) return;

    const toSide: PadrinhoSide = fromSide === 'noiva' ? 'noivo' : 'noiva';
    const nextSource = normalizeSideEntries(
      sourceList.filter((item) => item.id !== id),
      fromSide
    );
    const destList = fromSide === 'noiva' ? groomsmen : bridesmaids;
    const nextDest = normalizeSideEntries(
      [...destList, { ...targetItem, side: toSide }],
      toSide
    );

    if (fromSide === 'noiva') {
      setBridesmaids(nextSource);
      setGroomsmen(nextDest);
    } else {
      setGroomsmen(nextSource);
      setBridesmaids(nextDest);
    }
    setSavedMessage(null);
    setErrorMsg(null);
    setIsDirty(true);
  };

  const handleReorderPerson = (side: PadrinhoSide, id: string, direction: -1 | 1) => {
    const reorder = (prev: PadrinhoEntry[]) => {
      const idx = prev.findIndex((item) => item.id === id);
      const targetIdx = idx + direction;
      if (idx < 0 || targetIdx < 0 || targetIdx >= prev.length) return prev;
      const copy = [...prev];
      const [moved] = copy.splice(idx, 1);
      copy.splice(targetIdx, 0, moved);
      return normalizeSideEntries(copy, side);
    };

    if (side === 'noiva') {
      setBridesmaids(reorder);
    } else {
      setGroomsmen(reorder);
    }
    setSavedMessage(null);
    setErrorMsg(null);
    setIsDirty(true);
  };

  const handleDeletePerson = (side: PadrinhoSide, id: string) => {
    if (side === 'noiva') {
      setBridesmaids((prev) =>
        normalizeSideEntries(
          prev.filter((item) => item.id !== id),
          'noiva'
        )
      );
    } else {
      setGroomsmen((prev) =>
        normalizeSideEntries(
          prev.filter((item) => item.id !== id),
          'noivo'
        )
      );
    }
    setSavedMessage(null);
    setErrorMsg(null);
    setIsDirty(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSavedMessage(null);
    setConflictDetected(false);

    if (!user || !user.emailVerified || !isAdmin) {
      setErrorMsg('Sessão administrativa não autorizada. Faça login novamente com sua conta Google.');
      return;
    }

    if (!church.name.trim() || !church.city.trim()) {
      setErrorMsg('Preencha o nome da igreja e a cidade antes de salvar.');
      return;
    }

    const emptyBridesmaid = bridesmaids.some((item) => !item.name.trim());
    const emptyGroomsman = groomsmen.some((item) => !item.name.trim());
    if (emptyBridesmaid || emptyGroomsman) {
      setErrorMsg(
        'Preencha o nome de todas as madrinhas e padrinhos ou remova os itens em branco antes de salvar.'
      );
      return;
    }

    setSaving(true);
    try {
      let nextPhotoUrl = resetPhotoToDefault
        ? DEFAULT_CHURCH_PHOTO
        : (church.photoUrl || '').trim();

      if (pendingPhoto) {
        setUploadProgress(10);
        const uploaded = await uploadCeremonyPhotoViaServer({
          blob: pendingPhoto.optimized.blob,
          fileName: pendingPhoto.optimized.fileName,
          onProgress: (pct) => setUploadProgress(pct),
        });
        nextPhotoUrl = uploaded.url;
      }

      const payloadBridesmaids = normalizeSideEntries(
        bridesmaids.map((item) => ({ ...item, name: item.name.trim() })),
        'noiva'
      );
      const payloadGroomsmen = normalizeSideEntries(
        groomsmen.map((item) => ({ ...item, name: item.name.trim() })),
        'noivo'
      );

      const churchPayload: CeremonyChurchInfo = {
        name: church.name.trim(),
        city: normalizeVenueCityDisplay(church.city),
        cep: church.cep.trim(),
        streetAddress: church.streetAddress.trim(),
        coordinates: church.coordinates.trim(),
        mapUrl: church.mapUrl.trim(),
        photoUrl:
          nextPhotoUrl && !isEphemeralPhotoUrl(nextPhotoUrl)
            ? nextPhotoUrl
            : DEFAULT_CHURCH_PHOTO,
        dateDisplay: church.dateDisplay.trim(),
        timeDisplay: church.timeDisplay.trim(),
        pastor: church.pastor.trim(),
        planner: church.planner.trim(),
      };

      const sendSave = async (forceRefreshToken: boolean) => {
        const headers = {
          ...(await getAdminAuthHeaders(forceRefreshToken)),
          'Content-Type': 'application/json',
        };
        return fetch('/api/admin/ceremony', {
          method: 'PUT',
          headers,
          body: JSON.stringify({
            expectedSha: ceremonySha,
            resetPhotoToDefault,
            church: churchPayload,
            bridesmaids: payloadBridesmaids,
            groomsmen: payloadGroomsmen,
          }),
        });
      };

      let res = await sendSave(false);
      if (res.status === 401) {
        res = await sendSave(true);
      }

      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
        sha?: string;
        data?: CeremonyPublicData;
        error?: string;
      };

      if (res.status === 409) {
        setConflictDetected(true);
        throw new Error(
          body.error ||
            'Os dados da cerimônia no GitHub foram alterados por outra sessão. Recarregue antes de salvar.'
        );
      }

      if (!res.ok || !body.ok || !body.data || !body.sha) {
        throw new Error(body.error || `Falha ao salvar cerimônia no GitHub (HTTP ${res.status}).`);
      }

      // Confirmed saved in GitHub JSON
      clearPendingPhoto();
      hydrateFromCeremonyData(body.data, body.sha, 'github');
      applySavedCeremony(body.data, body.sha);

      // Best-effort secondary mirror to Firestore (never blocks confirmed GitHub save)
      try {
        const mergedSettings: SiteSettings = {
          ...settings,
          venueName: body.data.church.name,
          venueCity: body.data.church.city,
          venueCep: body.data.church.cep,
          venueStreetAddress: body.data.church.streetAddress,
          venueCoordinates: body.data.church.coordinates,
          venueMapUrl: body.data.church.mapUrl,
          venuePhotoUrl: body.data.church.photoUrl,
          weddingDateDisplay: body.data.church.dateDisplay,
          weddingTimeDisplay: body.data.church.timeDisplay,
          ceremonyPastor: body.data.church.pastor,
          ceremonyPlanner: body.data.church.planner,
          padrinhos: [...body.data.bridesmaids, ...body.data.groomsmen],
        };
        const sanitized = sanitizeSiteSettingsForFirestore(mergedSettings);
        await setDoc(doc(db, 'site_settings', 'main'), {
          ...sanitized,
          updatedAt: serverTimestamp(),
        });
        await setDoc(doc(db, 'admin_logs', `log_${generateRandomToken(6)}`), {
          actorUid: user.uid,
          actorEmail: user.email || '',
          action: 'Cerimônia salva no GitHub',
          details: 'Fotografia da igreja, informações da cerimônia e listas de madrinhas e padrinhos publicadas.',
          createdAt: serverTimestamp(),
        });
      } catch {
        // Firestore mirror is optional when GitHub JSON succeeded
      }

      setSavedMessage(body.message || 'Cerimônia salva com sucesso');
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Não foi possível salvar os dados da cerimônia.'
      );
    } finally {
      setSaving(false);
      setUploadProgress(null);
    }
  };

  const renderGroupColumn = (
    side: PadrinhoSide,
    items: PadrinhoEntry[],
    title: string,
    addLabel: string
  ) => (
    <div className="rounded-lg border border-dourado/35 bg-marfim/75 p-4 sm:p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-dourado/25 pb-3">
        <div>
          <h4 className="font-display text-xl font-semibold text-terracota-escuro">{title}</h4>
          <p className="text-xs text-marrom-suave">
            {items.filter((i) => i.published && i.name.trim()).length} publicado(s) ·{' '}
            {items.length} registro(s)
          </p>
        </div>
        <button
          type="button"
          disabled={bridesmaids.length + groomsmen.length >= 60}
          onClick={() => handleAddPerson(side)}
          data-testid={`add-${side}`}
          className="inline-flex items-center gap-1.5 rounded-md border border-terracota-escuro px-3 py-1.5 text-xs font-semibold text-terracota-escuro hover:bg-terracota/10 disabled:opacity-40 whitespace-nowrap"
        >
          <Plus className="h-3.5 w-3.5" />
          {addLabel}
        </button>
      </div>

      {items.length === 0 ? (
        <p className="text-xs text-marrom-suave italic py-4 text-center">
          Nenhum nome cadastrado neste grupo.
        </p>
      ) : (
        <ul className="space-y-3" data-testid={`list-${side}`}>
          {items.map((item, idx) => (
            <li
              key={item.id}
              className="rounded-md border border-dourado/30 bg-creme-claro p-3 space-y-2.5"
            >
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-dourado tabular-nums w-5 shrink-0">
                  {idx + 1}.
                </span>
                <input
                  type="text"
                  maxLength={120}
                  value={item.name}
                  aria-label={`${side === 'noiva' ? 'Madrinha' : 'Padrinho'} ${idx + 1}`}
                  onChange={(e) => handleUpdatePerson(side, item.id, { name: e.target.value })}
                  placeholder={side === 'noiva' ? 'Nome da madrinha' : 'Nome do padrinho'}
                  className="w-full rounded-md border border-dourado/40 bg-marfim px-3 py-1.5 text-sm text-marrom"
                />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 pl-7">
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() =>
                      handleUpdatePerson(side, item.id, { published: !item.published })
                    }
                    className={`inline-flex items-center gap-1 rounded px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                      item.published
                        ? 'bg-salvia/15 text-salvia border border-salvia/35'
                        : 'bg-pergaminho text-marrom-suave border border-dourado/35'
                    }`}
                  >
                    {item.published ? (
                      <>
                        <Eye className="h-3 w-3" />
                        Publicado
                      </>
                    ) : (
                      <>
                        <EyeOff className="h-3 w-3" />
                        Oculto
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => handleMoveSide(side, item.id)}
                    className="inline-flex items-center gap-1 rounded border border-dourado/35 px-2 py-1 text-[11px] text-marrom-suave hover:bg-pergaminho"
                  >
                    <ArrowLeftRight className="h-3 w-3" />
                    {side === 'noiva' ? 'Mover para Padrinhos' : 'Mover para Madrinhas'}
                  </button>
                </div>

                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    disabled={idx === 0}
                    onClick={() => handleReorderPerson(side, item.id, -1)}
                    aria-label="Mover para cima"
                    className="rounded border border-dourado/35 p-1 text-marrom-suave hover:bg-pergaminho disabled:opacity-35"
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    disabled={idx === items.length - 1}
                    onClick={() => handleReorderPerson(side, item.id, 1)}
                    aria-label="Mover para baixo"
                    className="rounded border border-dourado/35 p-1 text-marrom-suave hover:bg-pergaminho disabled:opacity-35"
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeletePerson(side, item.id)}
                    aria-label="Remover pessoa"
                    className="rounded border border-terracota/35 p-1 text-terracota-escuro hover:bg-terracota/10"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  return (
    <form onSubmit={handleSave} className="space-y-8">
      {/* Top Save Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-dourado/40 bg-creme-claro p-5 sm:p-6">
        <div>
          <h2 className="font-display text-2xl font-semibold text-marrom">
            Página da Cerimônia
          </h2>
          <p className="text-xs text-marrom-suave">
            As alterações salvas aqui são publicadas diretamente via GitHub em{' '}
            <code className="font-mono text-[11px]">public/data/cerimonia.json</code> e aparecem
            imediatamente no site público.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {loadingRemote && (
            <span className="inline-flex items-center gap-1.5 text-xs text-marrom-suave">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Sincronizando...
            </span>
          )}
          {savedMessage && (
            <span
              role="status"
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-salvia"
            >
              <CheckCircle2 className="h-4 w-4" />
              {savedMessage}
            </span>
          )}
          <button
            type="submit"
            disabled={saving || optimizingPhoto}
            className="inline-flex items-center gap-2 rounded-md bg-terracota-escuro px-5 py-2.5 text-xs font-semibold tracking-wider text-creme-claro uppercase hover:bg-terracota disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {saving
              ? uploadProgress !== null
                ? `Publicando foto (${uploadProgress}%)...`
                : 'Salvando no GitHub...'
              : 'Salvar Cerimônia'}
          </button>
        </div>
      </div>

      {!githubReady && githubWarning && (
        <div className="rounded-md border border-dourado/50 bg-dourado/10 p-3.5 text-xs text-marrom">
          {githubWarning}
        </div>
      )}

      {errorMsg && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-terracota/40 bg-terracota/10 p-3.5 text-xs text-terracota-escuro"
        >
          <span className="inline-flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {errorMsg}
          </span>
          {conflictDetected && (
            <button
              type="button"
              onClick={() => void loadLatestCeremonyFromGitHub(true)}
              className="inline-flex items-center gap-1.5 rounded border border-terracota-escuro bg-creme-claro px-3 py-1.5 text-[11px] font-semibold text-terracota-escuro hover:bg-marfim"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Recarregar versão do GitHub
            </button>
          )}
        </div>
      )}

      {/* 1. Church Photo & Core Ceremony Info */}
      <section className="rounded-lg border border-dourado/35 bg-creme-claro p-6 sm:p-8 space-y-6">
        <div className="flex items-center gap-2 border-b border-dourado/25 pb-3">
          <MapPin className="h-5 w-5 text-terracota-escuro" />
          <h3 className="font-display text-2xl font-semibold text-marrom">
            Cerimônia, Igreja &amp; Localização
          </h3>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 lg:items-start">
          {/* Church Photo */}
          <div className="lg:col-span-5 space-y-3">
            <label className="block text-xs font-semibold tracking-wider text-marrom uppercase">
              Fotografia Real da Igreja
            </label>
            <div className="relative overflow-hidden rounded-lg border border-dourado/45 bg-marfim p-2">
              <img
                src={activePhotoDisplayUrl}
                alt="Pré-visualização da fachada da igreja"
                onError={() => {
                  if (!pendingPhoto && !previewFallbackActive) {
                    setPreviewFallbackActive(true);
                  }
                }}
                className="h-52 w-full rounded object-cover object-center"
              />
              {pendingPhoto && (
                <span className="mt-2 inline-flex items-center gap-1.5 rounded bg-dourado/15 px-2.5 py-1 text-[11px] font-medium text-marrom">
                  <ImageIcon className="h-3.5 w-3.5 text-terracota-escuro" />
                  Pré-visualização WebP ({pendingPhoto.optimized.width}x
                  {pendingPhoto.optimized.height} •{' '}
                  {formatBytesCompact(pendingPhoto.optimized.optimizedBytes)}) — clique em Salvar
                  Cerimônia para publicar
                </span>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md bg-terracota-escuro px-3.5 py-2 text-xs font-semibold text-creme-claro hover:bg-terracota">
                {optimizingPhoto ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Upload className="h-3.5 w-3.5" />
                )}
                {optimizingPhoto ? 'Otimizando WebP...' : 'Selecionar foto (WebP)'}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={handleSelectChurchPhoto}
                  className="hidden"
                />
              </label>

              {pendingPhoto && (
                <button
                  type="button"
                  onClick={() => {
                    clearPendingPhoto();
                    setSavedMessage(null);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-md border border-terracota/40 px-3 py-2 text-xs font-medium text-terracota-escuro hover:bg-terracota/10"
                >
                  <X className="h-3.5 w-3.5" />
                  Descartar pré-visualização
                </button>
              )}

              {(church.photoUrl !== DEFAULT_CHURCH_PHOTO || pendingPhoto) && (
                <button
                  type="button"
                  onClick={() => {
                    clearPendingPhoto();
                    setResetPhotoToDefault(true);
                    setChurch((prev) => ({ ...prev, photoUrl: DEFAULT_CHURCH_PHOTO }));
                    setPreviewFallbackActive(false);
                    setSavedMessage(null);
                    setIsDirty(true);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-md border border-dourado/50 px-3 py-2 text-xs font-medium text-marrom hover:bg-pergaminho"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  Usar foto original
                </button>
              )}
            </div>

            <div>
              <label className="block text-xs font-medium text-marrom-suave">
                Ou informe o endereço/URL pública da foto
              </label>
              <input
                type="text"
                maxLength={600}
                value={church.photoUrl}
                onChange={(e) => {
                  clearPendingPhoto();
                  updateChurchField('photoUrl', e.target.value);
                }}
                placeholder="/images/igreja-jardim-florestal.png"
                className="mt-1 w-full rounded-md border border-dourado/40 bg-marfim px-3 py-2 text-xs"
              />
            </div>
          </div>

          {/* Fields */}
          <div className="lg:col-span-7 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-medium text-marrom">Data</label>
              <input
                type="text"
                maxLength={100}
                value={church.dateDisplay}
                onChange={(e) => updateChurchField('dateDisplay', e.target.value)}
                placeholder="Domingo, 10 de janeiro de 2027"
                className="mt-1 w-full rounded-md border border-dourado/40 bg-marfim px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-marrom">Horário</label>
              <input
                type="text"
                maxLength={40}
                value={church.timeDisplay}
                onChange={(e) => updateChurchField('timeDisplay', e.target.value)}
                placeholder="15h"
                className="mt-1 w-full rounded-md border border-dourado/40 bg-marfim px-3 py-2 text-sm"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-marrom">Nome da igreja</label>
              <input
                type="text"
                required
                maxLength={200}
                value={church.name}
                onChange={(e) => updateChurchField('name', e.target.value)}
                className="mt-1 w-full rounded-md border border-dourado/40 bg-marfim px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-marrom">Cidade</label>
              <input
                type="text"
                required
                maxLength={120}
                value={church.city}
                onChange={(e) => updateChurchField('city', e.target.value)}
                placeholder="Rio Pardo de Minas — MG"
                className="mt-1 w-full rounded-md border border-dourado/40 bg-marfim px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-marrom">CEP</label>
              <input
                type="text"
                maxLength={20}
                value={church.cep}
                onChange={(e) => updateChurchField('cep', e.target.value)}
                placeholder="39530-000"
                className="mt-1 w-full rounded-md border border-dourado/40 bg-marfim px-3 py-2 text-sm"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-marrom">
                Endereço / Bairro (para detalhes e mapa)
              </label>
              <input
                type="text"
                maxLength={240}
                value={church.streetAddress}
                onChange={(e) => updateChurchField('streetAddress', e.target.value)}
                placeholder="Jardim Florestal, Rio Pardo de Minas – MG"
                className="mt-1 w-full rounded-md border border-dourado/40 bg-marfim px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-marrom">Pastor</label>
              <input
                type="text"
                maxLength={120}
                value={church.pastor}
                onChange={(e) => updateChurchField('pastor', e.target.value)}
                placeholder="Pr. Fabiano Paulo de Andrade"
                className="mt-1 w-full rounded-md border border-dourado/40 bg-marfim px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-marrom">Cerimonialista</label>
              <input
                type="text"
                maxLength={120}
                value={church.planner}
                onChange={(e) => updateChurchField('planner', e.target.value)}
                placeholder="Ludimila De Giovanni"
                className="mt-1 w-full rounded-md border border-dourado/40 bg-marfim px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-marrom">
                Coordenadas do mapa (lat, lng)
              </label>
              <input
                type="text"
                maxLength={80}
                value={church.coordinates}
                onChange={(e) => updateChurchField('coordinates', e.target.value)}
                placeholder="Ex.: -15.6108, -42.5403"
                className="mt-1 w-full rounded-md border border-dourado/40 bg-marfim px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-marrom">
                Link personalizado do Google Maps
              </label>
              <input
                type="url"
                maxLength={500}
                value={church.mapUrl}
                onChange={(e) => updateChurchField('mapUrl', e.target.value)}
                placeholder="https://maps.google.com/..."
                className="mt-1 w-full rounded-md border border-dourado/40 bg-marfim px-3 py-2 text-sm"
              />
            </div>
          </div>
        </div>
      </section>

      {/* 2. Padrinhos e Madrinhas Manager */}
      <section className="rounded-lg border border-dourado/35 bg-creme-claro p-6 sm:p-8 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-dourado/25 pb-3">
          <div className="flex items-center gap-2">
            <Heart className="h-5 w-5 text-terracota-escuro" />
            <div>
              <h3 className="font-display text-2xl font-semibold text-marrom">
                Nossas Madrinhas e Padrinhos
              </h3>
              <p className="text-xs text-marrom-suave">
                Listas independentes para noiva e noivo. Edite nomes, reordene, adicione ou remova
                pessoas e salve para atualizar o site público.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              const sides = splitPadrinhosBySide(DEFAULT_PADRINHOS_SLOTS);
              setBridesmaids(sides.bridesmaids);
              setGroomsmen(sides.groomsmen);
              setSavedMessage(null);
              setErrorMsg(null);
              setIsDirty(true);
            }}
            className="inline-flex items-center gap-1.5 rounded-md border border-dourado/45 px-3 py-1.5 text-xs font-medium text-marrom hover:bg-pergaminho"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Restaurar lista inicial (6 + 6)
          </button>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {renderGroupColumn('noiva', bridesmaids, 'Madrinhas', 'Adicionar Madrinha')}
          {renderGroupColumn('noivo', groomsmen, 'Padrinhos', 'Adicionar Padrinho')}
        </div>
      </section>

      {/* Bottom Save Button */}
      <div className="flex flex-wrap items-center justify-end gap-4">
        {savedMessage && (
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-salvia">
            <CheckCircle2 className="h-4 w-4" />
            {savedMessage}
          </span>
        )}
        <button
          type="submit"
          disabled={saving || optimizingPhoto}
          className="inline-flex items-center gap-2 rounded-md bg-terracota-escuro px-6 py-3 text-xs font-semibold tracking-wider text-creme-claro uppercase hover:bg-terracota disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {saving ? 'Salvando no GitHub...' : 'Salvar configurações da Cerimônia'}
        </button>
      </div>
    </form>
  );
};
