import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Camera,
  Check,
  Database,
  Edit3,
  Eye,
  EyeOff,
  Lock,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Trash2,
  Upload,
  X,
  XCircle,
} from 'lucide-react';
import {
  deleteDoc,
  doc,
  runTransaction,
  serverTimestamp,
  setDoc,
  writeBatch,
} from 'firebase/firestore';
import { isBundledGiftImageUrl, useWedding } from '../../context/WeddingContext';
import {
  db,
  formatFirestorePersistenceError,
  getAdminAuthHeaders,
  OperationType,
} from '../../lib/firebase';
import { formatBRL, generateRandomToken } from '../../lib/pix';
import { GiftCategory, GiftItem, GiftOrder, GiftType } from '../../types/wedding';
import { GIFT_IMAGES } from '../../data/giftImages';
import { OFFICIAL_GIFTS } from '../../data/defaults';
import { ResilientImage } from '../ResilientImage';
import {
  AppliedGiftPhotoPayload,
  GiftPhotoSearchModal,
} from './GiftPhotoSearchModal';
import { LegacyGalleryCleanupModal } from './LegacyGalleryCleanupModal';

const ARTIFICIAL_LEGACY_IMAGE_RE = /gift_[a-z0-9_]+_1794802/i;

function isGiftPhotoArtificialOrPending(g: GiftItem): boolean {
  return Boolean(g.needsPhotoReview || ARTIFICIAL_LEGACY_IMAGE_RE.test(g.imageUrl || ''));
}

function formatOrderTimestamp(ord: GiftOrder): string {
  const raw = ord.createdAt as
    | { seconds?: number; toDate?: () => Date }
    | string
    | undefined;
  let date: Date | null = null;
  if (raw && typeof raw === 'object') {
    if (typeof raw.toDate === 'function') {
      date = raw.toDate();
    } else if (typeof raw.seconds === 'number') {
      date = new Date(raw.seconds * 1000);
    }
  } else if (typeof raw === 'string') {
    const parsed = Date.parse(raw);
    if (!Number.isNaN(parsed)) date = new Date(parsed);
  }
  if (!date && ord.confirmedAtIso) {
    const parsed = Date.parse(ord.confirmedAtIso);
    if (!Number.isNaN(parsed)) date = new Date(parsed);
  }
  if (!date && ord.expiresAtIso) {
    const parsed = Date.parse(ord.expiresAtIso);
    if (!Number.isNaN(parsed)) date = new Date(parsed);
  }
  if (!date || Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const CATEGORIES: GiftCategory[] = [
  'Cozinha & Mesa',
  'Cama, Mesa & Banho',
  'Eletrodomésticos',
  'Decoração & Conforto',
  'Momentos a dois',
  'Lua de mel',
  'Contribuições especiais',
];

export const AdminGiftsOrdersTab: React.FC = () => {
  const {
    gifts,
    giftOrders,
    adminLogs,
    user,
    demoAdminActive,
    isAdmin,
    demoActions,
    syncOfficialCatalog,
    deleteAdminGiftOrder,
    seeding,
  } = useWedding();
  const [orderToDelete, setOrderToDelete] = useState<GiftOrder | null>(null);
  const [deletingOrder, setDeletingOrder] = useState(false);
  const [confirmingOrderId, setConfirmingOrderId] = useState<string | null>(null);
  const [syncingMpOrderId, setSyncingMpOrderId] = useState<string | null>(null);
  const [syncingAllPayments, setSyncingAllPayments] = useState(false);
  const [orderDeleteError, setOrderDeleteError] = useState<string | null>(null);
  const [orderActionFeedback, setOrderActionFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);
  const [editingGift, setEditingGift] = useState<GiftItem | null>(null);
  const [showNewForm, setShowNewForm] = useState(false);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<GiftCategory>('Cozinha & Mesa');
  const [priceReais, setPriceReais] = useState('150,00');
  const [giftType, setGiftType] = useState<GiftType>('full');
  const [desiredUnits, setDesiredUnits] = useState(1);
  const [quotasPerUnit, setQuotasPerUnit] = useState(1);
  const [imageUrl, setImageUrl] = useState<string>(GIFT_IMAGES.gift01CookwareSet);
  const [photoSource, setPhotoSource] = useState<string>('');
  const [sortOrderInput, setSortOrderInput] = useState<number>(1);
  const [needsPhotoReview, setNeedsPhotoReview] = useState(false);
  const [initialPhotoBackup, setInitialPhotoBackup] = useState<{
    imageUrl: string;
    photoSource?: string;
    needsPhotoReview: boolean;
  } | null>(null);
  const [showPhotoSearchModal, setShowPhotoSearchModal] = useState(false);
  const [showLegacyCleanupModal, setShowLegacyCleanupModal] = useState(false);
  const [uploadingManualInline, setUploadingManualInline] = useState(false);
  const [photoFeedback, setPhotoFeedback] = useState<string | null>(null);
  const manualUploadInputRef = useRef<HTMLInputElement | null>(null);
  const giftModalPanelRef = useRef<HTMLDivElement | null>(null);
  const [featured, setFeatured] = useState(false);
  const [active, setActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [catalogFeedback, setCatalogFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);
  const [syncFeedback, setSyncFeedback] = useState<string | null>(null);
  const [filterAdminCategory, setFilterAdminCategory] = useState<'Todos' | GiftCategory>('Todos');
  const [filterOnlyNeedsReview, setFilterOnlyNeedsReview] = useState(false);

  const useDemoStore = demoAdminActive || !isAdmin;
  const isAuthenticatedAdmin = Boolean(user && user.emailVerified && isAdmin && !demoAdminActive);

  const visibleGiftOrders = useMemo(
    () => giftOrders.filter((ord) => !ord.adminArchived),
    [giftOrders]
  );

  const pendingMpOrdersCount = useMemo(
    () =>
      visibleGiftOrders.filter(
        (ord) =>
          (ord.status === 'reserved' || ord.status === 'awaiting_confirmation') &&
          (Boolean(ord.mpOrderId) ||
            Boolean(ord.mpPaymentId) ||
            ord.paymentMethod === 'mercadopago_card' ||
            ord.paymentMethod === 'pix_webhook')
      ).length,
    [visibleGiftOrders]
  );

  const manualConfirmLogByOrderId = useMemo(() => {
    const map = new Map<string, { actor: string }>();
    for (const log of adminLogs) {
      const actionLower = (log.action || '').toLowerCase();
      if (!actionLower.includes('confirmado')) continue;
      const match = /Pedido\s+([A-Za-z0-9_-]+)/i.exec(log.details || '');
      if (!match) continue;
      const ordId = match[1];
      if (!map.has(ordId)) {
        map.set(ordId, {
          actor: log.actorEmail || log.actorUid || 'Administrador autenticado',
        });
      }
    }
    return map;
  }, [adminLogs]);

  useEffect(() => {
    if (!orderToDelete) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !deletingOrder) {
        setOrderToDelete(null);
        setOrderDeleteError(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [orderToDelete, deletingOrder]);

  useEffect(() => {
    if (!showNewForm) return;
    if (giftModalPanelRef.current) {
      giftModalPanelRef.current.scrollTop = 0;
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving && !showPhotoSearchModal) {
        setShowNewForm(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [showNewForm, editingGift?.id, saving, showPhotoSearchModal]);

  const missingOfficialCount = useMemo(() => {
    const existingIds = new Set(gifts.map((g) => g.id));
    return OFFICIAL_GIFTS.filter((o) => !existingIds.has(o.id)).length;
  }, [gifts]);

  const outdatedOfficialPhotosCount = useMemo(() => {
    const officialById = new Map(OFFICIAL_GIFTS.map((o) => [o.id, o]));
    let count = 0;
    for (const g of gifts) {
      const official = officialById.get(g.id);
      if (
        official &&
        isBundledGiftImageUrl(g.imageUrl) &&
        (g.imageUrl !== official.imageUrl ||
          g.needsPhotoReview !== official.needsPhotoReview ||
          g.photoSource !== official.photoSource)
      ) {
        count += 1;
      }
    }
    return count;
  }, [gifts]);

  const syncActionCount = missingOfficialCount + outdatedOfficialPhotosCount;

  const needsReviewCount = useMemo(
    () => gifts.filter((g) => isGiftPhotoArtificialOrPending(g)).length,
    [gifts]
  );

  const displayedGifts = useMemo(() => {
    return gifts.filter((g) => {
      if (filterOnlyNeedsReview && !isGiftPhotoArtificialOrPending(g)) return false;
      if (filterAdminCategory !== 'Todos' && g.category !== filterAdminCategory) return false;
      return true;
    });
  }, [gifts, filterAdminCategory, filterOnlyNeedsReview]);

  const logAction = async (action: string, details: string) => {
    if (useDemoStore || !user) return;
    try {
      await setDoc(doc(db, 'admin_logs', `log_${generateRandomToken(6)}`), {
        actorUid: user.uid,
        actorEmail: user.email || '',
        action,
        details: (details || action).slice(0, 500),
        createdAt: serverTimestamp(),
      });
    } catch (logErr) {
      console.warn('Não foi possível gravar registro de auditoria:', logErr);
    }
  };

  const openCreateForm = () => {
    setFormError(null);
    setPhotoFeedback(null);
    setCatalogFeedback(null);
    setEditingGift(null);
    setTitle('');
    setDescription('');
    setCategory('Cozinha & Mesa');
    setPriceReais('150,00');
    setGiftType('full');
    setDesiredUnits(1);
    setQuotasPerUnit(1);
    setSortOrderInput(gifts.reduce((max, item) => Math.max(max, item.sortOrder ?? 0), 0) + 1);
    setImageUrl(GIFT_IMAGES.gift01CookwareSet);
    setPhotoSource('');
    setNeedsPhotoReview(false);
    setInitialPhotoBackup(null);
    setFeatured(false);
    setActive(true);
    setShowNewForm(true);
  };

  const openEditForm = (g: GiftItem) => {
    setFormError(null);
    setPhotoFeedback(null);
    setCatalogFeedback(null);
    setEditingGift(g);
    setTitle(g.title || '');
    setDescription(g.description || '');
    setCategory(g.category || 'Cozinha & Mesa');
    setPriceReais((Math.max(100, Number(g.priceCents) || 100) / 100).toFixed(2).replace('.', ','));
    setGiftType(g.giftType || 'full');
    const units = g.desiredUnits && g.desiredUnits > 1 ? g.desiredUnits : 1;
    const perUnit =
      g.quotasPerUnit && g.quotasPerUnit >= 1
        ? g.quotasPerUnit
        : Math.max(1, Math.round((Number(g.totalQuotas) || 1) / units));
    setDesiredUnits(units);
    setQuotasPerUnit(perUnit);
    const fullIndex = gifts.findIndex((item) => item.id === g.id);
    setSortOrderInput(
      typeof g.sortOrder === 'number' && Number.isFinite(g.sortOrder)
        ? Math.max(0, Math.min(10000, Math.round(g.sortOrder)))
        : Math.max(1, fullIndex + 1)
    );
    const currentUrl = g.imageUrl ?? '';
    setImageUrl(currentUrl);
    setPhotoSource(g.photoSource ?? '');
    setNeedsPhotoReview(Boolean(g.needsPhotoReview));
    setInitialPhotoBackup({
      imageUrl: currentUrl,
      photoSource: g.photoSource,
      needsPhotoReview: Boolean(g.needsPhotoReview),
    });
    setFeatured(Boolean(g.featured));
    setActive(g.active !== false);
    setShowNewForm(true);
  };

  const applyPhotoPayload = async (payload: AppliedGiftPhotoPayload) => {
    const cleanUrl = payload.imageUrl.trim().slice(0, 600);
    const cleanSource = payload.photoSource.trim().slice(0, 160);
    setFormError(null);

    if (editingGift) {
      const updatedGift: GiftItem = {
        ...editingGift,
        imageUrl: cleanUrl,
        photoSource: cleanSource,
        needsPhotoReview: payload.needsPhotoReview,
      };
      if (useDemoStore) {
        demoActions.saveGift(updatedGift);
      } else {
        try {
          await setDoc(
            doc(db, 'gifts', editingGift.id),
            {
              imageUrl: cleanUrl,
              photoSource: cleanSource,
              needsPhotoReview: payload.needsPhotoReview,
              updatedAt: serverTimestamp(),
            },
            { merge: true }
          );
          await logAction(
            'Fotografia do presente atualizada',
            `${editingGift.title} (${cleanSource})`
          );
        } catch (err) {
          const msg = formatFirestorePersistenceError(
            err,
            OperationType.UPDATE,
            `gifts/${editingGift.id}`
          );
          setPhotoFeedback(null);
          setFormError(msg);
          throw new Error(msg);
        }
      }
      setEditingGift(updatedGift);
    }

    setImageUrl(cleanUrl);
    setPhotoSource(cleanSource);
    setNeedsPhotoReview(payload.needsPhotoReview);
    setPhotoFeedback('Fotografia atualizada no cartão do presente.');
  };

  const handleRestorePreviousPhoto = async () => {
    if (!initialPhotoBackup) return;
    const restoredUrl = initialPhotoBackup.imageUrl;
    const restoredSource = initialPhotoBackup.photoSource || '';
    const restoredReview = initialPhotoBackup.needsPhotoReview;
    setFormError(null);

    if (editingGift) {
      const updatedGift: GiftItem = {
        ...editingGift,
        imageUrl: restoredUrl,
        ...(restoredSource ? { photoSource: restoredSource } : { photoSource: undefined }),
        needsPhotoReview: restoredReview,
      };
      if (useDemoStore) {
        demoActions.saveGift(updatedGift);
      } else {
        try {
          await setDoc(
            doc(db, 'gifts', editingGift.id),
            {
              imageUrl: restoredUrl,
              photoSource: restoredSource,
              needsPhotoReview: restoredReview,
              updatedAt: serverTimestamp(),
            },
            { merge: true }
          );
          await logAction('Fotografia anterior restaurada', editingGift.title);
        } catch (err) {
          const msg = formatFirestorePersistenceError(
            err,
            OperationType.UPDATE,
            `gifts/${editingGift.id}`
          );
          setPhotoFeedback(null);
          setFormError(msg);
          throw new Error(msg);
        }
      }
      setEditingGift(updatedGift);
    }

    setImageUrl(restoredUrl);
    setPhotoSource(restoredSource);
    setNeedsPhotoReview(restoredReview);
    setPhotoFeedback('Imagem anterior restaurada com sucesso.');
  };

  const handleInlineManualUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    if (!['image/jpeg', 'image/jpg', 'image/png', 'image/webp'].includes(file.type)) {
      setFormError('Envie uma imagem válida no formato JPG, PNG ou WEBP.');
      return;
    }
    if (file.size > 12 * 1024 * 1024) {
      setFormError('A imagem selecionada excede o limite de 12 MB.');
      return;
    }

    setUploadingManualInline(true);
    setFormError(null);
    try {
      const authHeaders = await getAdminAuthHeaders();
      const res = await fetch('/api/media/gifts', {
        method: 'POST',
        headers: {
          ...authHeaders,
          'Content-Type': file.type,
        },
        body: file,
      });
      const data = (await res.json()) as { ok?: boolean; url?: string; error?: string };
      if (!res.ok || !data.url) {
        throw new Error(data.error || 'Não foi possível salvar o upload manual.');
      }
      await applyPhotoPayload({
        imageUrl: data.url,
        photoSource: 'Upload manual no painel administrativo',
        needsPhotoReview: false,
      });
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Erro ao enviar imagem manual.');
    } finally {
      setUploadingManualInline(false);
    }
  };

  const parsedPriceCents = useMemo(() => {
    const cleaned = priceReais.replace(/[^\d.,]/g, '');
    const normalized = cleaned.includes(',')
      ? cleaned.replace(/\./g, '').replace(',', '.')
      : cleaned;
    const num = Number.parseFloat(normalized);
    if (Number.isNaN(num) || num < 1) return 100;
    return Math.min(100000000, Math.round(num * 100));
  }, [priceReais]);

  const isFlexibleForm = category === 'Lua de mel' || giftType === 'symbolic';
  const safeUnits = Math.max(1, Math.min(100, Math.round(Number(desiredUnits) || 1)));
  const safePerUnit = Math.max(1, Math.min(100, Math.round(Number(quotasPerUnit) || 1)));
  const computedTotalQuotas = isFlexibleForm
    ? Math.max(1, Math.min(1000, Math.round(Number(quotasPerUnit) || 1)))
    : Math.max(1, Math.min(1000, safeUnits * safePerUnit));

  const handleSaveGift = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setCatalogFeedback(null);

    const cleanTitle = title.trim().slice(0, 140);
    const cleanDescription = description.trim().slice(0, 500);
    if (!cleanTitle) {
      setFormError('Informe o nome do presente.');
      return;
    }
    if (!cleanDescription) {
      setFormError('Informe uma descrição breve para o presente.');
      return;
    }

    if (editingGift) {
      const lockedQuotas = (editingGift.paidQuotas || 0) + (editingGift.reservedQuotas || 0);
      if (computedTotalQuotas < lockedQuotas) {
        setFormError(
          isFlexibleForm
            ? `Não é possível reduzir a disponibilidade para ${computedTotalQuotas}: já existem ${lockedQuotas} contribuições registradas (${editingGift.paidQuotas} confirmada(s) e ${editingGift.reservedQuotas} reservada(s)).`
            : `Não é possível reduzir para ${computedTotalQuotas} cota(s): já existem ${editingGift.paidQuotas} cota(s) paga(s) e ${editingGift.reservedQuotas} reservada(s) (${lockedQuotas} no total).`
        );
        return;
      }
    }

    setSaving(true);
    const id = editingGift ? editingGift.id : `gift_${generateRandomToken(6)}`;
    try {
      const nextSortOrder = Math.max(
        0,
        Math.min(
          10000,
          Number.isFinite(sortOrderInput)
            ? Math.round(sortOrderInput)
            : (editingGift?.sortOrder ??
                gifts.reduce((max, item) => Math.max(max, item.sortOrder ?? 0), 0) + 1)
        )
      );

      const resolvedGiftType: GiftType =
        computedTotalQuotas > 1 && giftType === 'full' ? 'quota' : giftType;

      const trimmedImageUrl = imageUrl.trim().slice(0, 600);
      const imageChanged = editingGift
        ? trimmedImageUrl !== (editingGift.imageUrl || '').trim()
        : true;
      const matchingOfficial = OFFICIAL_GIFTS.find((o) => o.imageUrl === trimmedImageUrl);
      const resolvedNeedsPhotoReview = matchingOfficial
        ? Boolean(matchingOfficial.needsPhotoReview)
        : imageChanged
          ? needsPhotoReview
          : Boolean(editingGift?.needsPhotoReview);
      const trimmedPhotoSource = photoSource.trim().slice(0, 160);
      const resolvedPhotoSource = (
        trimmedPhotoSource ||
        matchingOfficial?.photoSource ||
        (imageChanged && trimmedImageUrl ? 'Foto personalizada (Admin)' : editingGift?.photoSource) ||
        ''
      ).slice(0, 160);

      const includeUnitBreakdown =
        !isFlexibleForm &&
        (safeUnits > 1 ||
          typeof editingGift?.desiredUnits === 'number' ||
          typeof editingGift?.quotasPerUnit === 'number');

      const giftPayload: GiftItem = {
        id,
        title: cleanTitle,
        description: cleanDescription,
        category,
        priceCents: parsedPriceCents,
        imageUrl: trimmedImageUrl,
        giftType: resolvedGiftType,
        totalQuotas: computedTotalQuotas,
        ...(includeUnitBreakdown
          ? { desiredUnits: safeUnits, quotasPerUnit: safePerUnit }
          : {}),
        reservedQuotas: editingGift ? Math.max(0, Math.round(Number(editingGift.reservedQuotas ?? 0))) : 0,
        paidQuotas: editingGift ? Math.max(0, Math.round(Number(editingGift.paidQuotas ?? 0))) : 0,
        sortOrder: nextSortOrder,
        active,
        featured,
        isDemoExample: false,
        needsPhotoReview: resolvedNeedsPhotoReview,
        photoSource: resolvedPhotoSource,
      };

      if (useDemoStore) {
        demoActions.saveGift(giftPayload);
      } else {
        const now = serverTimestamp();
        const { id: _id, ...rest } = giftPayload;
        await setDoc(
          doc(db, 'gifts', id),
          {
            ...rest,
            isDemoExample: false,
            createdAt: editingGift?.createdAt || now,
            updatedAt: now,
          },
          { merge: true }
        );
        await logAction(editingGift ? 'Presente editado' : 'Presente criado', cleanTitle);
      }
      setShowNewForm(false);
      setEditingGift(null);
      setCatalogFeedback({
        type: 'success',
        message: editingGift
          ? `Alterações salvas para "${cleanTitle}".`
          : `Presente "${cleanTitle}" cadastrado com sucesso.`,
      });
    } catch (err) {
      setFormError(formatFirestorePersistenceError(err, OperationType.WRITE, `gifts/${id}`));
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (g: GiftItem) => {
    setCatalogFeedback(null);
    const updated: GiftItem = { ...g, active: !g.active };
    if (useDemoStore) {
      demoActions.saveGift(updated);
      return;
    }
    try {
      await setDoc(
        doc(db, 'gifts', g.id),
        { active: !g.active, updatedAt: serverTimestamp() },
        { merge: true }
      );
      await logAction(
        !g.active ? 'Presente exibido' : 'Presente ocultado',
        g.title
      );
    } catch (err) {
      setCatalogFeedback({
        type: 'error',
        message: formatFirestorePersistenceError(err, OperationType.UPDATE, `gifts/${g.id}`),
      });
    }
  };

  const handleMoveGift = async (indexInFullList: number, direction: -1 | 1) => {
    setCatalogFeedback(null);
    const targetIdx = indexInFullList + direction;
    if (targetIdx < 0 || targetIdx >= gifts.length) return;

    const ordered = [...gifts];
    const [moved] = ordered.splice(indexInFullList, 1);
    ordered.splice(targetIdx, 0, moved);
    const orderedIds = ordered.map((item) => item.id);

    if (useDemoStore) {
      demoActions.reorderGifts(orderedIds);
      return;
    }

    try {
      const batch = writeBatch(db);
      const now = serverTimestamp();
      ordered.forEach((item, idx) => {
        batch.update(doc(db, 'gifts', item.id), {
          sortOrder: idx + 1,
          updatedAt: now,
        });
      });
      await batch.commit();
      await logAction('Ordem de presentes atualizada', moved.title);
    } catch (err) {
      setCatalogFeedback({
        type: 'error',
        message: formatFirestorePersistenceError(err, OperationType.UPDATE, 'gifts'),
      });
    }
  };

  const handleDeleteGift = async (g: GiftItem) => {
    if (g.paidQuotas > 0 || g.reservedQuotas > 0) return;
    setCatalogFeedback(null);
    if (useDemoStore) {
      demoActions.deleteGift(g.id);
      return;
    }
    try {
      await deleteDoc(doc(db, 'gifts', g.id));
      await logAction('Presente removido', g.title);
    } catch (err) {
      setCatalogFeedback({
        type: 'error',
        message: formatFirestorePersistenceError(err, OperationType.DELETE, `gifts/${g.id}`),
      });
    }
  };

  const handleSyncCatalog = async () => {
    setSyncFeedback(null);
    setCatalogFeedback(null);
    try {
      const res = await syncOfficialCatalog();
      setSyncFeedback(
        `Sincronização concluída: ${res.added} adicionado(s), ${res.updatedPhotos} foto(s) atualizada(s) e ${res.removedPlaceholders} rascunho(s) antigo(s) removido(s).`
      );
    } catch (err) {
      setCatalogFeedback({
        type: 'error',
        message: formatFirestorePersistenceError(err, OperationType.WRITE, 'gifts'),
      });
    }
  };

  const resolveOrderQuotaTargets = (ord: GiftOrder): { giftId: string; quotas: number }[] => {
    if (ord.isCustomAmount) return [];
    if (ord.itemsSnapshot && ord.itemsSnapshot.length > 0) {
      return ord.itemsSnapshot
        .filter((item) => item.giftId && item.giftId !== 'custom_contribution' && !item.giftId.startsWith('demo-'))
        .map((item) => ({ giftId: item.giftId, quotas: Math.max(1, item.quotas) }));
    }
    if (ord.giftId && !ord.giftId.startsWith('demo-')) {
      return [{ giftId: ord.giftId, quotas: Math.max(1, ord.quotas || 1) }];
    }
    return [];
  };

  const handleConfirmOrder = async (ord: GiftOrder) => {
    // Nunca confirmar presentes como pagos em modo demonstração ou em duplicidade
    if (useDemoStore || confirmingOrderId || ord.status === 'confirmed') return;
    setConfirmingOrderId(ord.id);
    setOrderActionFeedback(null);
    try {
      const targets = resolveOrderQuotaTargets(ord);
      const orderRef = doc(db, 'gift_orders', ord.id);
      const confirmedAtIso = new Date().toISOString();

      await runTransaction(db, async (tx) => {
        const orderSnap = await tx.get(orderRef);
        if (!orderSnap.exists()) {
          throw new Error('ORDER_NOT_FOUND');
        }
        const liveOrder = orderSnap.data() as Partial<GiftOrder>;
        if (liveOrder.status === 'confirmed') {
          throw new Error('ORDER_ALREADY_CONFIRMED');
        }
        if (liveOrder.status === 'cancelled' || liveOrder.status === 'expired') {
          throw new Error('ORDER_ALREADY_CLOSED');
        }

        // Firestore transactions require all reads before any writes
        const giftUpdates: Array<{
          ref: ReturnType<typeof doc>;
          nextPaid: number;
          nextReserved: number;
          reservedChanged: boolean;
        }> = [];

        for (const target of targets) {
          const gRef = doc(db, 'gifts', target.giftId);
          const gSnap = await tx.get(gRef);
          if (!gSnap.exists()) continue;
          const liveGift = gSnap.data() as Partial<GiftItem>;
          const totalQuotas = Math.max(1, Number(liveGift.totalQuotas) || 1);
          const currentReserved = Math.max(0, Number(liveGift.reservedQuotas) || 0);
          const currentPaid = Math.max(0, Number(liveGift.paidQuotas) || 0);
          const reservedToRelease = Math.min(currentReserved, target.quotas);
          const nextReserved = currentReserved - reservedToRelease;
          const nextPaid = currentPaid + target.quotas;

          if (nextReserved + nextPaid > totalQuotas) {
            throw new Error(
              `QUOTA_EXCEEDED:${liveGift.title || target.giftId}`
            );
          }

          giftUpdates.push({
            ref: gRef,
            nextPaid,
            nextReserved,
            reservedChanged: reservedToRelease > 0,
          });
        }

        const now = serverTimestamp();
        tx.update(orderRef, {
          status: 'confirmed',
          confirmedAtIso,
          updatedAt: now,
        });

        for (const item of giftUpdates) {
          tx.update(item.ref, {
            paidQuotas: item.nextPaid,
            ...(item.reservedChanged ? { reservedQuotas: item.nextReserved } : {}),
            updatedAt: now,
          });
        }
      });

      await logAction(
        ord.paymentMethod === 'mercadopago_card'
          ? 'Pagamento Cartão confirmado manualmente'
          : 'Pix direto confirmado manualmente',
        `Pedido ${ord.id} (${formatBRL(ord.amountCents)})${user?.email ? ` · Admin: ${user.email}` : ''}`
      );
      setOrderActionFeedback({
        type: 'success',
        message: `Pedido ${ord.id} confirmado manualmente (${user?.email || 'administrador autenticado'}). Cotas atualizadas no Firestore.`,
      });
    } catch (err) {
      const codeMsg = err instanceof Error ? err.message : '';
      if (codeMsg === 'ORDER_ALREADY_CONFIRMED') {
        setOrderActionFeedback({
          type: 'error',
          message: `O pedido ${ord.id} já havia sido confirmado anteriormente. Nenhuma cota foi duplicada.`,
        });
      } else if (codeMsg === 'ORDER_ALREADY_CLOSED') {
        setOrderActionFeedback({
          type: 'error',
          message: `O pedido ${ord.id} já está cancelado/expirado e não pode ser confirmado.`,
        });
      } else if (codeMsg === 'ORDER_NOT_FOUND') {
        setOrderActionFeedback({
          type: 'error',
          message: `Pedido ${ord.id} não encontrado no Firestore.`,
        });
      } else if (codeMsg.startsWith('QUOTA_EXCEEDED:')) {
        const giftTitle = codeMsg.slice('QUOTA_EXCEEDED:'.length);
        setOrderActionFeedback({
          type: 'error',
          message: `Não foi possível confirmar o pedido ${ord.id}: todas as cotas de "${giftTitle}" já estão ocupadas.`,
        });
      } else {
        setOrderActionFeedback({
          type: 'error',
          message: formatFirestorePersistenceError(err, OperationType.UPDATE, `gift_orders/${ord.id}`),
        });
      }
    } finally {
      setConfirmingOrderId(null);
    }
  };

  const handleCancelOrder = async (
    ord: GiftOrder,
    newStatus: 'expired' | 'cancelled'
  ) => {
    if (useDemoStore) {
      demoActions.cancelGiftOrder(ord.id, newStatus);
      return;
    }
    try {
      const targets = resolveOrderQuotaTargets(ord);
      const orderRef = doc(db, 'gift_orders', ord.id);

      await runTransaction(db, async (tx) => {
        const orderSnap = await tx.get(orderRef);
        if (!orderSnap.exists()) {
          throw new Error('ORDER_NOT_FOUND');
        }
        const liveOrder = orderSnap.data() as Partial<GiftOrder>;
        if (liveOrder.status === 'confirmed') {
          throw new Error('ORDER_ALREADY_CONFIRMED');
        }
        if (liveOrder.status === 'cancelled' || liveOrder.status === 'expired') {
          throw new Error('ORDER_ALREADY_CLOSED');
        }

        const giftUpdates: Array<{
          ref: ReturnType<typeof doc>;
          nextReserved: number;
        }> = [];

        for (const target of targets) {
          const gRef = doc(db, 'gifts', target.giftId);
          const gSnap = await tx.get(gRef);
          if (!gSnap.exists()) continue;
          const liveGift = gSnap.data() as Partial<GiftItem>;
          const currentReserved = Math.max(0, Number(liveGift.reservedQuotas) || 0);
          const reservedToRelease = Math.min(currentReserved, target.quotas);
          if (reservedToRelease > 0) {
            giftUpdates.push({
              ref: gRef,
              nextReserved: currentReserved - reservedToRelease,
            });
          }
        }

        const now = serverTimestamp();
        tx.update(orderRef, {
          status: newStatus,
          updatedAt: now,
        });
        for (const item of giftUpdates) {
          tx.update(item.ref, {
            reservedQuotas: item.nextReserved,
            updatedAt: now,
          });
        }
      });

      await logAction('Reserva encerrada', `Pedido ${ord.id} -> ${newStatus}`);
    } catch (err) {
      const codeMsg = err instanceof Error ? err.message : '';
      if (codeMsg === 'ORDER_ALREADY_CONFIRMED') {
        setOrderActionFeedback({
          type: 'error',
          message: `O pedido ${ord.id} já foi confirmado e não pode ser cancelado por aqui.`,
        });
      } else if (codeMsg === 'ORDER_ALREADY_CLOSED') {
        setOrderActionFeedback({
          type: 'error',
          message: `O pedido ${ord.id} já foi encerrado anteriormente.`,
        });
      } else {
        setOrderActionFeedback({
          type: 'error',
          message: formatFirestorePersistenceError(err, OperationType.UPDATE, `gift_orders/${ord.id}`),
        });
      }
    }
  };

  const handleSyncMercadoPagoOrder = async (orderId: string) => {
    if (!isAuthenticatedAdmin || !user || syncingMpOrderId || syncingAllPayments) return;
    setSyncingMpOrderId(orderId);
    setOrderActionFeedback(null);
    try {
      const token = await user.getIdToken();
      const res = await fetch(`/api/admin/mercadopago/sync/${encodeURIComponent(orderId)}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        mpStatus?: string;
        mpPaymentId?: string;
        firestoreStatus?: string;
        isPaid?: boolean;
      };
      if (!res.ok || data.ok === false) {
        setOrderActionFeedback({
          type: 'error',
          message:
            data.error || 'Não foi possível sincronizar o status deste pedido com o Firestore.',
        });
        return;
      }
      setOrderActionFeedback({
        type: 'success',
        message:
          data.isPaid && data.firestoreStatus === 'confirmed'
            ? `Pedido ${orderId} confirmado pelo Mercado Pago e gravado no Firestore${data.mpPaymentId ? ` (Pagamento ${data.mpPaymentId})` : ''}.`
            : `Status atualizado no Mercado Pago para ${orderId}: ${data.mpStatus || data.firestoreStatus || 'aguardando'}.`,
      });
    } catch (err) {
      setOrderActionFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'Erro ao consultar o Mercado Pago.',
      });
    } finally {
      setSyncingMpOrderId(null);
    }
  };

  const handleSyncAllPendingPayments = async () => {
    if (!isAuthenticatedAdmin || !user || syncingAllPayments || syncingMpOrderId) return;
    setSyncingAllPayments(true);
    setOrderActionFeedback(null);
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/admin/mercadopago/sync-pending', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        checkedMpCount?: number;
        confirmedCount?: number;
        alreadyConfirmedCount?: number;
        stillPendingCount?: number;
        manualPendingCount?: number;
        cancelledOrExpiredCount?: number;
        mismatchCount?: number;
        errorCount?: number;
        errors?: string[];
      };

      if (!res.ok) {
        setOrderActionFeedback({
          type: 'error',
          message:
            data.error ||
            'Não foi possível sincronizar os pagamentos pendentes com o Mercado Pago e o Firestore.',
        });
        return;
      }

      const confirmed = data.confirmedCount ?? 0;
      const stillPending = data.stillPendingCount ?? 0;
      const manualPending = data.manualPendingCount ?? 0;
      const cancelledOrExpired = data.cancelledOrExpiredCount ?? 0;
      const checked = data.checkedMpCount ?? 0;
      const errCount = (data.errorCount ?? 0) + (data.mismatchCount ?? 0);

      if (checked === 0 && manualPending === 0) {
        setOrderActionFeedback({
          type: 'success',
          message: 'Nenhum pagamento pendente encontrado no Firestore para sincronizar.',
        });
        return;
      }

      const parts = [
        `${confirmed} pagamento(s) confirmado(s)`,
        `${stillPending} continua(m) pendente(s) no Mercado Pago`,
      ];
      if (cancelledOrExpired > 0) {
        parts.push(`${cancelledOrExpired} expirado(s)/cancelado(s)`);
      }
      if (manualPending > 0) {
        parts.push(`${manualPending} Pix manual(is) aguardando conferência`);
      }
      if ((data.alreadyConfirmedCount ?? 0) > 0) {
        parts.push(`${data.alreadyConfirmedCount} já confirmado(s) anteriormente`);
      }

      const summary = `Sincronização concluída (${checked} consultado(s) no Mercado Pago): ${parts.join(' · ')}.`;

      if (data.ok === false || errCount > 0) {
        const errDetail = data.errors && data.errors.length > 0 ? ` Detalhes: ${data.errors.join(' | ')}` : '';
        setOrderActionFeedback({
          type: 'error',
          message: `${summary} Atenção: ${errCount} ocorrência(s) não pôde(puderam) ser gravada(s) ou apresentou(aram) divergência.${errDetail}`,
        });
        return;
      }

      setOrderActionFeedback({
        type: 'success',
        message: summary,
      });
    } catch (err) {
      setOrderActionFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'Erro ao sincronizar pagamentos.',
      });
    } finally {
      setSyncingAllPayments(false);
    }
  };

  const handleConfirmDeleteOrder = async () => {
    if (!orderToDelete || !isAuthenticatedAdmin || deletingOrder) return;
    setDeletingOrder(true);
    setOrderDeleteError(null);
    setOrderActionFeedback(null);
    try {
      const result = await deleteAdminGiftOrder(orderToDelete.id);
      setOrderToDelete(null);
      setOrderActionFeedback({
        type: 'success',
        message:
          result.mode === 'archived'
            ? 'Registro ocultado do histórico administrativo com preservação dos dados financeiros e comprovantes.'
            : 'Registro excluído do histórico administrativo.',
      });
    } catch (err) {
      setOrderDeleteError(
        err instanceof Error ? err.message : 'Não foi possível excluir este registro.'
      );
    } finally {
      setDeletingOrder(false);
    }
  };

  return (
    <div className="space-y-10">
      <section className="rounded-lg border border-dourado/35 bg-creme-claro p-4 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="font-display text-2xl font-semibold text-marrom">
              Pedidos de Presentes · Pix &amp; Cartão ({visibleGiftOrders.length})
            </h2>
            <p className="mt-1 text-xs text-marrom-suave">
              {useDemoStore
                ? 'Modo demonstração: reservas permanecem como "Pendente". A confirmação como pago fica bloqueada até ativar o modo de produção.'
                : 'Consulte e confirme no Firestore os pagamentos pendentes do Mercado Pago usando sua sessão autenticada de administrador.'}
            </p>
          </div>
          {useDemoStore ? (
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-terracota-escuro">
              <Lock className="h-3.5 w-3.5" />
              Pagamentos não simulados
            </span>
          ) : (
            isAuthenticatedAdmin && (
              <button
                type="button"
                disabled={syncingAllPayments || Boolean(syncingMpOrderId)}
                onClick={handleSyncAllPendingPayments}
                className="inline-flex items-center gap-2 rounded-md border border-oliva/60 bg-oliva/10 px-4 py-2 text-xs font-semibold tracking-wider text-oliva uppercase hover:bg-oliva/20 disabled:opacity-50"
              >
                <RefreshCw className={`h-4 w-4 ${syncingAllPayments ? 'animate-spin' : ''}`} />
                {syncingAllPayments
                  ? 'Sincronizando...'
                  : pendingMpOrdersCount > 0
                    ? `Sincronizar pagamentos (${pendingMpOrdersCount})`
                    : 'Sincronizar pagamentos'}
              </button>
            )
          )}
        </div>

        {orderActionFeedback && (
          <p
            className={`mt-4 rounded-md border px-4 py-2.5 text-xs ${
              orderActionFeedback.type === 'error'
                ? 'border-terracota/45 bg-terracota/10 text-terracota-escuro'
                : 'border-oliva/40 bg-oliva/10 text-marrom'
            }`}
          >
            {orderActionFeedback.message}
          </p>
        )}

        {visibleGiftOrders.length === 0 ? (
          <p className="mt-6 text-sm text-marrom-suave">
            Nenhum pedido de presente registrado até o momento.
          </p>
        ) : (
          <div className="mt-5 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-dourado/25 text-xs uppercase text-marrom-suave">
                  <th className="py-2 pr-4">Convidado</th>
                  <th className="py-2 pr-4">Presentes selecionados</th>
                  <th className="py-2 pr-4">Valor</th>
                  <th className="py-2 pr-4">Forma de pagamento</th>
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2 pr-4">Data / Hora</th>
                  <th className="py-2 pr-4">ID do pedido</th>
                  <th className="py-2 pr-4">Mensagem</th>
                  <th className="py-2 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-dourado/15">
                {visibleGiftOrders.map((ord) => {
                  const isMpOrder =
                    Boolean(ord.mpOrderId) ||
                    Boolean(ord.mpPaymentId) ||
                    ord.paymentMethod === 'mercadopago_card' ||
                    ord.paymentMethod === 'pix_webhook';
                  const isCardBrick =
                    ord.mpPaymentType?.startsWith('card_brick') ||
                    (!ord.mpOrderId && ord.paymentMethod === 'mercadopago_card');
                  const isCheckoutProOptional =
                    Boolean(ord.mpOrderId) &&
                    (ord.paymentMethod === 'mercadopago_card' || ord.paymentMethod === 'pix_webhook');
                  const isMpPix =
                    ord.paymentMethod === 'pix_webhook' ||
                    (Boolean(ord.mpOrderId) &&
                      (ord.mpPaymentType === 'pix' || ord.mpPaymentType === 'bank_transfer'));
                  const isDirectPix = !isMpOrder && ord.paymentMethod === 'pix_manual';
                  const guestInformedPix =
                    isDirectPix && /Convidado informou Pix/i.test(ord.receiptNote || '');

                  const paymentMethodLabel = isCardBrick
                    ? 'Cartão Mercado Pago'
                    : isCheckoutProOptional
                      ? 'Checkout Pro opcional'
                      : isMpPix
                        ? 'Pix · Mercado Pago'
                        : isDirectPix
                          ? 'Pix direto'
                          : isMpOrder
                            ? 'Mercado Pago'
                            : 'Demonstração';

                  const isRefunded = ord.mpTransactionStatus === 'refunded';
                  const confirmAudit = manualConfirmLogByOrderId.get(ord.id);
                  const formattedConfirmedAt = ord.confirmedAtIso
                    ? (() => {
                        const parsed = Date.parse(ord.confirmedAtIso);
                        if (Number.isNaN(parsed)) return ord.confirmedAtIso;
                        return new Date(parsed).toLocaleString('pt-BR', {
                          day: '2-digit',
                          month: '2-digit',
                          year: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit',
                        });
                      })()
                    : null;

                  return (
                    <tr key={ord.id}>
                      <td className="py-3 pr-3 sm:pr-4 align-top">
                        <p className="font-medium text-marrom">{ord.giverName}</p>
                        <p className="text-xs text-marrom-suave">{ord.giverContact}</p>
                      </td>
                      <td className="py-3 pr-3 sm:pr-4 text-marrom align-top max-w-xs">
                        <p className="font-medium">{ord.giftTitle}</p>
                        {ord.itemsSnapshot && ord.itemsSnapshot.length > 1 && (
                          <ul className="mt-1 space-y-0.5 text-[11px] text-marrom-suave">
                            {ord.itemsSnapshot.map((snap, idx) => (
                              <li key={`${snap.giftId}-${idx}`}>
                                • {snap.title} ({snap.quotas}x · {formatBRL(snap.totalCents)})
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                      <td className="py-3 pr-3 sm:pr-4 font-semibold text-terracota-escuro tabular-nums whitespace-nowrap align-top">
                        {formatBRL(ord.amountCents)}
                      </td>
                      <td className="py-3 pr-3 sm:pr-4 text-xs text-marrom whitespace-nowrap align-top">
                        <span className="inline-block rounded border border-dourado/45 bg-creme px-2 py-0.5 font-medium">
                          {paymentMethodLabel}
                        </span>
                        {ord.mpPaymentType && (
                          <p className="mt-1 text-[11px] text-marrom-suave">{ord.mpPaymentType}</p>
                        )}
                      </td>
                      <td className="py-3 pr-3 sm:pr-4 text-xs font-medium align-top">
                        {ord.status === 'confirmed' && (
                          <div className="space-y-0.5">
                            <span className="text-salvia font-semibold">
                              {isDirectPix
                                ? 'Pix direto — confirmado manualmente'
                                : isCardBrick
                                  ? 'Cartão Mercado Pago — confirmado'
                                  : isCheckoutProOptional
                                    ? 'Checkout Pro opcional — confirmado'
                                    : 'Pago'}
                            </span>
                            {isDirectPix && (formattedConfirmedAt || confirmAudit) && (
                              <p className="text-[11px] font-normal text-marrom-suave">
                                {formattedConfirmedAt ? `Em ${formattedConfirmedAt}` : 'Confirmado'}
                                {confirmAudit ? ` · ${confirmAudit.actor}` : ''}
                              </p>
                            )}
                          </div>
                        )}
                        {(ord.status === 'awaiting_confirmation' || ord.status === 'reserved') && (
                          <div className="space-y-1">
                            <span className="block text-terracota-escuro font-semibold">
                              {isDirectPix
                                ? 'Pix direto — aguardando confirmação'
                                : isCardBrick
                                  ? 'Cartão Mercado Pago — em processamento'
                                  : isCheckoutProOptional
                                    ? 'Checkout Pro opcional — aguardando'
                                    : 'Pendente'}
                            </span>
                            {guestInformedPix && (
                              <span className="inline-block rounded border border-dourado/60 bg-dourado/15 px-1.5 py-0.5 text-[10px] font-semibold text-marrom">
                                Convidado informou Pix
                              </span>
                            )}
                          </div>
                        )}
                        {ord.status === 'expired' && (
                          <span className="text-marrom-suave/75">
                            {isDirectPix ? 'Pix direto — expirado' : 'Expirado'}
                          </span>
                        )}
                        {ord.status === 'cancelled' && (
                          <span className="text-marrom-suave/75">
                            {isRefunded
                              ? 'Reembolsado'
                              : isCardBrick
                                ? 'Cartão Mercado Pago — recusado ou cancelado'
                                : isDirectPix
                                  ? 'Pix direto — cancelado'
                                  : 'Cancelado'}
                          </span>
                        )}
                        {ord.mpTransactionStatus && (
                          <p className="mt-0.5 text-[11px] font-normal text-marrom-suave">
                            MP: {ord.mpTransactionStatus}
                            {ord.mpStatusDetail ? ` (${ord.mpStatusDetail})` : ''}
                          </p>
                        )}
                      </td>
                      <td className="py-3 pr-3 sm:pr-4 text-xs text-marrom-suave whitespace-nowrap align-top tabular-nums">
                        {formatOrderTimestamp(ord)}
                      </td>
                      <td className="py-3 pr-3 sm:pr-4 text-[11px] font-mono text-marrom-suave align-top whitespace-nowrap">
                        <p>{ord.id}</p>
                        {ord.mpOrderId && <p className="text-marrom">Ordem: {ord.mpOrderId}</p>}
                        {ord.mpPaymentId && <p className="text-salvia">Pag.: {ord.mpPaymentId}</p>}
                      </td>
                      <td className="py-3 pr-3 sm:pr-4 text-xs text-marrom-suave max-w-xs align-top">
                        {ord.receiptNote && <p>Nota: {ord.receiptNote}</p>}
                        {ord.messageToCouple && <p className="italic">“{ord.messageToCouple}”</p>}
                      </td>
                      <td className="py-3 text-right whitespace-nowrap align-top">
                        <div className="inline-flex items-center justify-end gap-1.5 sm:gap-2">
                          {(ord.status === 'reserved' || ord.status === 'awaiting_confirmation') && (
                            <>
                              {isMpOrder && isAuthenticatedAdmin && (
                                <button
                                  type="button"
                                  disabled={syncingAllPayments || syncingMpOrderId === ord.id}
                                  onClick={() => handleSyncMercadoPagoOrder(ord.id)}
                                  title="Consultar status oficial no Mercado Pago"
                                  className="inline-flex items-center gap-1 rounded-md border border-oliva/60 bg-oliva/10 px-2.5 py-1.5 text-xs font-semibold text-oliva hover:bg-oliva/20 disabled:opacity-45"
                                >
                                  <RefreshCw
                                    className={`h-3.5 w-3.5 ${
                                      syncingMpOrderId === ord.id ? 'animate-spin' : ''
                                    }`}
                                  />
                                  Verificar MP
                                </button>
                              )}
                              {!isMpOrder && ord.paymentMethod === 'pix_manual' && (
                                <button
                                  type="button"
                                  disabled={useDemoStore || confirmingOrderId === ord.id}
                                  title={
                                    useDemoStore
                                      ? 'Indisponível no modo demonstração (não simulamos pagamentos)'
                                      : 'Confirmar recebimento Pix direto manualmente'
                                  }
                                  onClick={() => handleConfirmOrder(ord)}
                                  className="inline-flex items-center gap-1 rounded-md bg-salvia px-2.5 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
                                >
                                  <Check className="h-3.5 w-3.5" />
                                  {confirmingOrderId === ord.id ? 'Confirmando...' : 'Confirmar Pix'}
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => handleCancelOrder(ord, 'cancelled')}
                                className="inline-flex items-center gap-1 rounded-md border border-dourado/40 px-2.5 py-1.5 text-xs text-marrom-suave hover:text-terracota-escuro"
                              >
                                <XCircle className="h-3.5 w-3.5" />
                                Cancelar
                              </button>
                            </>
                          )}
                          {isAuthenticatedAdmin && (
                            <button
                              type="button"
                              onClick={() => {
                                setOrderDeleteError(null);
                                setOrderToDelete(ord);
                              }}
                              title="Excluir registro"
                              aria-label={`Excluir registro de ${ord.giverName}`}
                              className="inline-flex h-8 w-8 md:h-auto md:w-auto items-center justify-center gap-1 rounded-md border border-terracota/55 bg-terracota/10 md:px-2.5 md:py-1.5 text-xs font-semibold text-terracota-escuro hover:bg-terracota-escuro hover:text-creme-claro transition-colors"
                            >
                              <Trash2 className="h-3.5 w-3.5 shrink-0" />
                              <span className="hidden md:inline">Excluir</span>
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-lg border border-dourado/35 bg-creme-claro p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-2xl font-semibold text-marrom">
              Catálogo de Presentes ({gifts.length})
            </h2>
            <p className="text-xs text-marrom-suave">
              Adicione, edite valores, unidades, cotas, oculte, reordene ou altere imagens sem
              comprometer reservas existentes.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            {!useDemoStore && syncActionCount > 0 && (
              <button
                type="button"
                disabled={seeding}
                onClick={handleSyncCatalog}
                className="inline-flex items-center gap-2 rounded-md border border-oliva/60 bg-oliva/10 px-4 py-2 text-xs font-semibold text-oliva uppercase hover:bg-oliva/20 disabled:opacity-50"
              >
                <Database className="h-4 w-4" />
                {seeding
                  ? 'Sincronizando...'
                  : `Sincronizar catálogo oficial (${syncActionCount})`}
              </button>
            )}
            <button
              type="button"
              onClick={() => setShowLegacyCleanupModal(true)}
              className="inline-flex items-center gap-2 rounded-md border border-dourado/60 bg-creme px-4 py-2 text-xs font-semibold text-marrom uppercase hover:bg-pergaminho"
            >
              <Trash2 className="h-4 w-4 text-terracota-escuro" />
              LIMPAR GALERIA ANTIGA
            </button>
            <button
              type="button"
              onClick={openCreateForm}
              className="inline-flex items-center gap-2 rounded-md bg-terracota-escuro px-4 py-2 text-xs font-semibold text-creme-claro uppercase hover:bg-terracota"
            >
              <Plus className="h-4 w-4" />
              Novo presente
            </button>
          </div>
        </div>

        {syncFeedback && (
          <p className="mt-4 rounded-md border border-oliva/40 bg-oliva/10 px-4 py-2.5 text-xs text-marrom">
            {syncFeedback}
          </p>
        )}

        {catalogFeedback && (
          <p
            role={catalogFeedback.type === 'error' ? 'alert' : 'status'}
            className={`mt-4 rounded-md border px-4 py-2.5 text-xs ${
              catalogFeedback.type === 'error'
                ? 'border-terracota/45 bg-terracota/10 text-terracota-escuro'
                : 'border-oliva/40 bg-oliva/10 text-marrom'
            }`}
          >
            {catalogFeedback.message}
          </p>
        )}

        {needsReviewCount > 0 && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-dourado/55 bg-creme px-4 py-2.5 text-xs text-marrom">
            <span className="inline-flex items-center gap-2">
              <Camera className="h-4 w-4 shrink-0 text-terracota-escuro" />
              <span>
                <strong>{needsReviewCount}</strong> presente(s) utilizam imagem ilustrativa preservada e aguardam revisão por fotografia real.
              </span>
            </span>
            <button
              type="button"
              onClick={() => setFilterOnlyNeedsReview((prev) => !prev)}
              className={`rounded-md px-3 py-1 text-xs font-semibold transition-colors ${
                filterOnlyNeedsReview
                  ? 'bg-terracota-escuro text-creme-claro'
                  : 'border border-terracota/40 text-terracota-escuro hover:bg-terracota/10'
              }`}
            >
              {filterOnlyNeedsReview ? 'Mostrar todos' : 'Filtrar pendentes'}
            </button>
          </div>
        )}

        {/* Filtro rápido por categoria no Admin */}
        <div className="mt-4 flex flex-wrap gap-2">
          {(['Todos', ...CATEGORIES] as const).map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setFilterAdminCategory(cat)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                filterAdminCategory === cat
                  ? 'bg-terracota-escuro text-creme-claro'
                  : 'border border-dourado/40 bg-creme text-marrom hover:bg-pergaminho'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
          {displayedGifts.map((g) => {
            const fullIndex = gifts.findIndex((item) => item.id === g.id);
            const totalCents = g.priceCents * g.totalQuotas;
            const locked = g.paidQuotas > 0 || g.reservedQuotas > 0;
            return (
              <div
                key={g.id}
                data-gift-card-id={g.id}
                className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-md border p-3.5 transition-colors ${
                  g.active
                    ? 'border-dourado/30 bg-creme/45'
                    : 'border-dourado/20 bg-pergaminho/40 opacity-75'
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="h-14 w-[74px] shrink-0 overflow-hidden rounded border border-dourado/30 bg-pergaminho">
                    <ResilientImage
                      key={g.imageUrl}
                      src={g.imageUrl}
                      alt={g.title}
                      className="h-full w-full object-cover"
                    />
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-marrom-suave">
                      <span className="truncate">
                        {g.category === 'Lua de mel' || g.giftType === 'symbolic'
                          ? `${g.category === 'Lua de mel' ? 'Lua de Mel' : g.category} · ${g.paidQuotas} confirmada(s) (${g.reservedQuotas} reserv.) · disp. ${g.totalQuotas}`
                          : `${g.category} · ${g.paidQuotas}/${g.totalQuotas} pagas (${g.reservedQuotas} reserv.)`}
                        {!g.active ? ' · Oculto' : ''}
                      </span>
                      {isGiftPhotoArtificialOrPending(g) && (
                        <span className="inline-flex items-center gap-1 rounded border border-terracota/40 bg-terracota/10 px-1.5 py-0.5 text-[10px] font-semibold text-terracota-escuro">
                          <Camera className="h-3 w-3" />
                          Substituir foto artificial
                        </span>
                      )}
                    </div>
                    <p className="font-display text-lg font-semibold text-marrom truncate">
                      {g.title}
                    </p>
                    <p className="text-xs font-semibold text-terracota-escuro tabular-nums">
                      {g.category === 'Lua de mel' || g.giftType === 'symbolic'
                        ? `Valor sugerido: ${formatBRL(g.priceCents)} · Contribuição flexível`
                        : g.totalQuotas > 1
                          ? `${formatBRL(g.priceCents)} / cota · Total ${formatBRL(totalCents)}`
                          : formatBRL(g.priceCents)}
                      {g.category !== 'Lua de mel' &&
                      g.giftType !== 'symbolic' &&
                      g.desiredUnits &&
                      g.desiredUnits > 1
                        ? ` · ${g.desiredUnits} unid.`
                        : ''}
                    </p>
                    {g.photoSource && (
                      <p className="mt-0.5 text-[10px] text-marrom-suave/80 truncate">
                        Foto: {g.photoSource}
                      </p>
                    )}
                  </div>
                </div>
                <div className="relative z-10 flex items-center justify-end gap-1.5 sm:gap-1 shrink-0 pt-1 sm:pt-0 border-t sm:border-t-0 border-dourado/20">
                  {filterAdminCategory === 'Todos' && !filterOnlyNeedsReview && (
                    <>
                      <button
                        type="button"
                        disabled={fullIndex <= 0}
                        onClick={() => handleMoveGift(fullIndex, -1)}
                        aria-label={`Mover ${g.title} para cima`}
                        title="Mover para cima"
                        className="inline-flex h-9 w-9 sm:h-8 sm:w-8 items-center justify-center rounded-md border border-dourado/40 text-marrom hover:bg-pergaminho disabled:opacity-30 cursor-pointer"
                      >
                        <ArrowUp className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        disabled={fullIndex >= gifts.length - 1}
                        onClick={() => handleMoveGift(fullIndex, 1)}
                        aria-label={`Mover ${g.title} para baixo`}
                        title="Mover para baixo"
                        className="inline-flex h-9 w-9 sm:h-8 sm:w-8 items-center justify-center rounded-md border border-dourado/40 text-marrom hover:bg-pergaminho disabled:opacity-30 cursor-pointer"
                      >
                        <ArrowDown className="h-3.5 w-3.5" />
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    onClick={() => handleToggleActive(g)}
                    aria-label={g.active ? `Ocultar ${g.title}` : `Exibir ${g.title}`}
                    title={g.active ? 'Ocultar na lista' : 'Exibir na lista'}
                    className="inline-flex h-9 w-9 sm:h-8 sm:w-8 items-center justify-center rounded-md border border-dourado/40 text-marrom hover:bg-pergaminho cursor-pointer"
                  >
                    {g.active ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                  </button>
                  <button
                    type="button"
                    data-testid={`edit-gift-btn-${g.id}`}
                    onClick={() => openEditForm(g)}
                    aria-label={`Editar ${g.title}`}
                    title={`Editar ${g.title}`}
                    className="inline-flex h-9 w-9 sm:h-8 sm:w-8 items-center justify-center rounded-md border border-dourado/40 text-marrom hover:bg-pergaminho cursor-pointer"
                  >
                    <Edit3 className="h-3.5 w-3.5" />
                  </button>
                  {!locked && (
                    <button
                      type="button"
                      onClick={() => handleDeleteGift(g)}
                      aria-label={`Excluir ${g.title}`}
                      title={`Excluir ${g.title}`}
                      className="inline-flex h-9 w-9 sm:h-8 sm:w-8 items-center justify-center rounded-md border border-dourado/40 text-terracota-escuro hover:bg-terracota/10 cursor-pointer"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {showNewForm && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="gift-form-modal-title"
          data-testid="gift-edit-modal"
          data-gift-id={editingGift?.id || 'new'}
          className="fixed inset-0 z-40 flex items-start sm:items-center justify-center overflow-y-auto bg-marrom/60 p-3 sm:p-6 backdrop-blur-xs"
          onClick={() => {
            if (!saving) {
              setShowNewForm(false);
            }
          }}
        >
          <div
            ref={giftModalPanelRef}
            className="relative my-auto w-full max-w-3xl max-h-[92vh] overflow-y-auto rounded-lg border border-dourado/55 bg-creme-claro shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-dourado/30 bg-creme px-5 py-4">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-oliva">
                  {editingGift ? `ID: ${editingGift.id}` : 'Novo item do catálogo'}
                </p>
                <h3
                  id="gift-form-modal-title"
                  className="font-display text-xl sm:text-2xl font-semibold text-marrom truncate"
                >
                  {editingGift ? `Editar presente — ${editingGift.title}` : 'Cadastrar presente'}
                </h3>
              </div>
              <button
                type="button"
                disabled={saving}
                onClick={() => setShowNewForm(false)}
                aria-label="Fechar formulário de presente"
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-dourado/45 bg-creme-claro text-marrom hover:bg-pergaminho disabled:opacity-50"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSaveGift} className="space-y-4 p-5 sm:p-6">
              {editingGift?.needsPhotoReview && (
                <p className="rounded-md border border-terracota/35 bg-terracota/10 px-3.5 py-2 text-xs text-terracota-escuro">
                  Este item está marcado para revisão de fotografia. Ao informar uma nova URL de foto real e salvar, a pendência será removida automaticamente.
                </p>
              )}

              {editingGift && (editingGift.paidQuotas > 0 || editingGift.reservedQuotas > 0) && (
                <p className="rounded-md border border-dourado/45 bg-creme px-3.5 py-2 text-xs text-marrom-suave">
                  Atenção: este item possui{' '}
                  <strong className="text-marrom">{editingGift.paidQuotas} cota(s) paga(s)</strong> e{' '}
                  <strong className="text-marrom">
                    {editingGift.reservedQuotas} reservada(s)
                  </strong>
                  . O total de cotas não pode ficar abaixo de{' '}
                  {editingGift.paidQuotas + editingGift.reservedQuotas}.
                </p>
              )}

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="gift-edit-title" className="block text-xs font-medium text-marrom">
                    Nome *
                  </label>
                  <input
                    id="gift-edit-title"
                    type="text"
                    required
                    maxLength={140}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="mt-1 w-full rounded-md border border-dourado/40 bg-creme px-3 py-2 text-sm text-marrom"
                  />
                </div>
                <div>
                  <label
                    htmlFor="gift-edit-category"
                    className="block text-xs font-medium text-marrom"
                  >
                    Categoria *
                  </label>
                  <select
                    id="gift-edit-category"
                    value={category}
                    onChange={(e) => setCategory(e.target.value as GiftCategory)}
                    className="mt-1 w-full rounded-md border border-dourado/40 bg-creme px-3 py-2 text-sm text-marrom"
                  >
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                    {!CATEGORIES.includes(category) && (
                      <option value={category}>{category}</option>
                    )}
                  </select>
                </div>
                <div>
                  <label htmlFor="gift-edit-price" className="block text-xs font-medium text-marrom">
                    {isFlexibleForm ? 'Valor sugerido (R$) *' : 'Valor por cota (R$) *'}
                  </label>
                  <input
                    id="gift-edit-price"
                    type="text"
                    required
                    value={priceReais}
                    onChange={(e) => setPriceReais(e.target.value)}
                    className="mt-1 w-full rounded-md border border-dourado/40 bg-creme px-3 py-2 text-sm text-marrom tabular-nums"
                  />
                </div>
                {isFlexibleForm ? (
                  <div className="grid grid-cols-2 gap-2.5">
                    <div>
                      <label htmlFor="gift-edit-type" className="block text-xs font-medium text-marrom">
                        Tipo
                      </label>
                      <select
                        id="gift-edit-type"
                        value={giftType}
                        onChange={(e) => setGiftType(e.target.value as GiftType)}
                        className="mt-1 w-full rounded-md border border-dourado/40 bg-creme px-2.5 py-2 text-sm text-marrom"
                      >
                        <option value="symbolic">Contribuição flexível</option>
                        <option value="full">Único</option>
                        <option value="quota">Dividido</option>
                      </select>
                    </div>
                    <div>
                      <label
                        htmlFor="gift-edit-availability"
                        className="block text-xs font-medium text-marrom"
                      >
                        Disponibilidade
                      </label>
                      <input
                        id="gift-edit-availability"
                        type="number"
                        min={1}
                        max={1000}
                        value={quotasPerUnit}
                        onChange={(e) => {
                          setDesiredUnits(1);
                          setQuotasPerUnit(Math.max(1, Math.min(1000, Number(e.target.value) || 1)));
                        }}
                        className="mt-1 w-full rounded-md border border-dourado/40 bg-creme px-2.5 py-2 text-sm text-marrom tabular-nums"
                      />
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-3 gap-2.5">
                    <div>
                      <label htmlFor="gift-edit-type" className="block text-xs font-medium text-marrom">
                        Tipo
                      </label>
                      <select
                        id="gift-edit-type"
                        value={giftType}
                        onChange={(e) => setGiftType(e.target.value as GiftType)}
                        className="mt-1 w-full rounded-md border border-dourado/40 bg-creme px-2.5 py-2 text-sm text-marrom"
                      >
                        <option value="full">Único</option>
                        <option value="quota">Cotas</option>
                        <option value="symbolic">Contribuição flexível</option>
                      </select>
                    </div>
                    <div>
                      <label
                        htmlFor="gift-edit-units"
                        className="block text-xs font-medium text-marrom"
                      >
                        Unidades
                      </label>
                      <input
                        id="gift-edit-units"
                        type="number"
                        min={1}
                        max={100}
                        value={desiredUnits}
                        onChange={(e) => setDesiredUnits(Math.max(1, Math.round(Number(e.target.value) || 1)))}
                        className="mt-1 w-full rounded-md border border-dourado/40 bg-creme px-2.5 py-2 text-sm text-marrom tabular-nums"
                      />
                    </div>
                    <div>
                      <label
                        htmlFor="gift-edit-quotas"
                        className="block text-xs font-medium text-marrom"
                      >
                        Cotas/unid.
                      </label>
                      <input
                        id="gift-edit-quotas"
                        type="number"
                        min={1}
                        max={100}
                        value={quotasPerUnit}
                        onChange={(e) => setQuotasPerUnit(Math.max(1, Number(e.target.value) || 1))}
                        className="mt-1 w-full rounded-md border border-dourado/40 bg-creme px-2.5 py-2 text-sm text-marrom tabular-nums"
                      />
                    </div>
                  </div>
                )}
              </div>

              <div className="rounded-md border border-dourado/30 bg-creme px-3.5 py-2 text-xs text-marrom-suave flex flex-wrap gap-x-5 gap-y-1">
                {isFlexibleForm ? (
                  <>
                    <span>
                      Disponibilidade:{' '}
                      <strong className="text-marrom">{computedTotalQuotas} contribuições</strong>
                    </span>
                    <span>
                      Valor sugerido:{' '}
                      <strong className="text-terracota-escuro">
                        {formatBRL(parsedPriceCents)}
                      </strong>
                    </span>
                  </>
                ) : (
                  <>
                    <span>
                      Total de cotas: <strong className="text-marrom">{computedTotalQuotas}</strong>
                    </span>
                    {desiredUnits > 1 && (
                      <span>
                        Valor unitário:{' '}
                        <strong className="text-marrom">
                          {formatBRL(parsedPriceCents * Math.max(1, quotasPerUnit))}
                        </strong>
                      </span>
                    )}
                    <span>
                      Valor total do presente:{' '}
                      <strong className="text-terracota-escuro">
                        {formatBRL(parsedPriceCents * computedTotalQuotas)}
                      </strong>
                    </span>
                  </>
                )}
              </div>

              <div>
                <label
                  htmlFor="gift-edit-description"
                  className="block text-xs font-medium text-marrom"
                >
                  Descrição breve *
                </label>
                <textarea
                  id="gift-edit-description"
                  rows={2}
                  required
                  maxLength={500}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="mt-1 w-full rounded-md border border-dourado/40 bg-creme px-3 py-2 text-sm text-marrom"
                />
              </div>

              {/* Ferramenta: Buscar fotos reais de produtos comerciais */}
              <div className="rounded-md border border-dourado/40 bg-creme/90 p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="h-16 w-20 shrink-0 overflow-hidden rounded border border-dourado/35 bg-pergaminho">
                      <ResilientImage
                        key={imageUrl}
                        src={imageUrl}
                        alt={title || 'Prévia do presente'}
                        className="h-full w-full object-cover"
                      />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-marrom">
                        Fotografia real do produto
                      </p>
                      <p className="mt-0.5 text-[11px] text-marrom-suave truncate">
                        {photoSource || 'Consulte catálogos comerciais oficiais ou envie uma foto do produto'}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setFormError(null);
                        setShowPhotoSearchModal(true);
                      }}
                      className="inline-flex items-center gap-1.5 rounded-md bg-terracota-escuro px-3.5 py-2 text-xs font-semibold uppercase text-creme-claro hover:bg-terracota shadow-xs"
                    >
                      <Search className="h-3.5 w-3.5" />
                      BUSCAR FOTOS REAIS
                    </button>

                    {imageUrl && (
                      <button
                        type="button"
                        onClick={() => {
                          setFormError(null);
                          setShowPhotoSearchModal(true);
                        }}
                        className="inline-flex items-center gap-1.5 rounded-md border border-dourado/55 bg-creme-claro px-3 py-2 text-xs font-semibold uppercase text-marrom hover:bg-pergaminho"
                      >
                        <Camera className="h-3.5 w-3.5" />
                        SUBSTITUIR FOTO
                      </button>
                    )}

                    <button
                      type="button"
                      disabled={uploadingManualInline}
                      onClick={() => manualUploadInputRef.current?.click()}
                      className="inline-flex items-center gap-1.5 rounded-md border border-dourado/55 bg-creme-claro px-3 py-2 text-xs font-semibold uppercase text-marrom hover:bg-pergaminho disabled:opacity-60"
                    >
                      <Upload className="h-3.5 w-3.5" />
                      {uploadingManualInline ? 'Enviando...' : 'ENVIAR MINHA FOTO'}
                    </button>
                    <input
                      ref={manualUploadInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      onChange={handleInlineManualUpload}
                      className="hidden"
                    />

                    {initialPhotoBackup &&
                      (imageUrl.trim() !== initialPhotoBackup.imageUrl.trim() ||
                        photoSource.trim() !== (initialPhotoBackup.photoSource || '').trim()) && (
                        <button
                          type="button"
                          onClick={handleRestorePreviousPhoto}
                          className="inline-flex items-center gap-1.5 rounded-md border border-dourado/55 bg-creme-claro px-3 py-2 text-xs font-semibold uppercase text-marrom hover:bg-pergaminho"
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                          RESTAURAR FOTO ANTERIOR
                        </button>
                      )}
                  </div>
                </div>

                {photoFeedback && (
                  <p className="rounded border border-oliva/40 bg-oliva/10 px-3 py-1.5 text-xs text-marrom">
                    {photoFeedback}
                  </p>
                )}

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label
                      htmlFor="gift-edit-image-url"
                      className="block text-xs font-medium text-marrom"
                    >
                      URL verificada da fotografia do produto
                    </label>
                    <input
                      id="gift-edit-image-url"
                      type="text"
                      maxLength={600}
                      value={imageUrl}
                      onChange={(e) => {
                        setImageUrl(e.target.value);
                        if (!photoSource.trim()) {
                          setPhotoSource('URL personalizada (Admin)');
                        }
                        setNeedsPhotoReview(false);
                      }}
                      className="mt-1 w-full rounded-md border border-dourado/40 bg-creme-claro px-3 py-2 text-sm text-marrom"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="gift-edit-photo-source"
                      className="block text-xs font-medium text-marrom"
                    >
                      Fonte da imagem
                    </label>
                    <input
                      id="gift-edit-photo-source"
                      type="text"
                      maxLength={160}
                      value={photoSource}
                      onChange={(e) => setPhotoSource(e.target.value)}
                      placeholder="Ex.: Site oficial do fabricante"
                      className="mt-1 w-full rounded-md border border-dourado/40 bg-creme-claro px-3 py-2 text-sm text-marrom"
                    />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 sm:items-center">
                <div className="sm:col-span-2 flex flex-wrap gap-5 text-xs text-marrom">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={active}
                      onChange={(e) => setActive(e.target.checked)}
                    />
                    Visível na lista pública
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={featured}
                      onChange={(e) => setFeatured(e.target.checked)}
                    />
                    Destacar na ordenação principal
                  </label>
                </div>
                <div>
                  <label
                    htmlFor="gift-edit-sort-order"
                    className="block text-xs font-medium text-marrom"
                  >
                    Ordem de exibição
                  </label>
                  <input
                    id="gift-edit-sort-order"
                    type="number"
                    min={0}
                    max={10000}
                    value={sortOrderInput}
                    onChange={(e) =>
                      setSortOrderInput(Math.max(0, Math.min(10000, Number(e.target.value) || 0)))
                    }
                    className="mt-1 w-full rounded-md border border-dourado/40 bg-creme px-3 py-2 text-sm text-marrom tabular-nums"
                  />
                </div>
              </div>

              {formError && (
                <p
                  role="alert"
                  className="rounded-md border border-terracota/40 bg-terracota/10 px-3.5 py-2.5 text-xs text-terracota-escuro"
                >
                  {formError}
                </p>
              )}

              <div className="flex flex-wrap gap-3 pt-1">
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-md bg-terracota-escuro px-5 py-2.5 text-xs font-semibold text-creme-claro uppercase hover:bg-terracota disabled:opacity-55"
                >
                  {saving ? 'Salvando...' : 'Salvar presente'}
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => setShowNewForm(false)}
                  className="rounded-md border border-dourado/40 bg-creme px-4 py-2.5 text-xs font-semibold text-marrom hover:bg-pergaminho disabled:opacity-55"
                >
                  Cancelar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <GiftPhotoSearchModal
        open={showPhotoSearchModal}
        giftTitle={title}
        currentImageUrl={imageUrl}
        currentPhotoSource={photoSource}
        previousImageUrl={initialPhotoBackup?.imageUrl || imageUrl}
        previousPhotoSource={initialPhotoBackup?.photoSource}
        onApplyPhoto={applyPhotoPayload}
        onRestorePrevious={handleRestorePreviousPhoto}
        onClose={() => setShowPhotoSearchModal(false)}
      />

      <LegacyGalleryCleanupModal
        open={showLegacyCleanupModal}
        gifts={gifts}
        onClose={() => setShowLegacyCleanupModal(false)}
      />

      {orderToDelete && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-delete-order-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-marrom/55 p-4 backdrop-blur-xs"
          onClick={() => {
            if (!deletingOrder) {
              setOrderToDelete(null);
              setOrderDeleteError(null);
            }
          }}
        >
          <div
            className="w-full max-w-md rounded-lg border border-dourado/45 bg-creme-claro p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-terracota/35 bg-terracota/10 text-terracota-escuro">
                <Trash2 className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <h3
                  id="confirm-delete-order-title"
                  className="font-display text-2xl font-semibold text-marrom"
                >
                  Excluir este registro?
                </h3>
                <p className="mt-1.5 text-sm leading-relaxed text-marrom-suave">
                  Esta ação removerá o registro do histórico administrativo e não poderá ser desfeita.
                </p>
              </div>
            </div>

            <div className="mt-4 rounded-md border border-dourado/30 bg-creme/70 px-3.5 py-2.5 text-xs text-marrom">
              <p className="font-semibold truncate">{orderToDelete.giverName}</p>
              <p className="mt-0.5 text-marrom-suave truncate">
                {orderToDelete.giftTitle} ·{' '}
                <strong className="text-terracota-escuro tabular-nums">
                  {formatBRL(orderToDelete.amountCents)}
                </strong>
              </p>
            </div>

            {(orderToDelete.status === 'confirmed' ||
              Boolean(orderToDelete.confirmedAtIso) ||
              orderToDelete.paymentMethod === 'pix_webhook' ||
              Boolean(orderToDelete.mpPaymentId)) && (
              <p className="mt-3 rounded-md border border-dourado/40 bg-creme px-3 py-2 text-xs text-marrom-suave">
                Registros com pagamento confirmado são arquivados (ocultados do histórico ativo) para preservar comprovantes e a prestação de contas financeira.
              </p>
            )}

            {orderDeleteError && (
              <p
                role="alert"
                className="mt-3 rounded-md border border-terracota/40 bg-terracota/10 px-3 py-2 text-xs text-terracota-escuro"
              >
                {orderDeleteError}
              </p>
            )}

            <div className="mt-6 flex flex-wrap justify-end gap-2.5">
              <button
                type="button"
                disabled={deletingOrder}
                onClick={() => {
                  setOrderToDelete(null);
                  setOrderDeleteError(null);
                }}
                className="rounded-md border border-dourado/45 bg-creme px-4 py-2 text-xs font-semibold text-marrom uppercase hover:bg-pergaminho disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={deletingOrder}
                onClick={handleConfirmDeleteOrder}
                className="inline-flex items-center gap-1.5 rounded-md bg-terracota-escuro px-4 py-2 text-xs font-semibold text-creme-claro uppercase hover:bg-terracota disabled:opacity-50"
              >
                <Trash2 className="h-3.5 w-3.5" />
                {deletingOrder ? 'Excluindo...' : 'Sim, excluir'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
