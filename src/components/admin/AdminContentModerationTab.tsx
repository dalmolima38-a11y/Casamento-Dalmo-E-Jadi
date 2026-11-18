import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Check,
  Pencil,
  Plus,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { useWedding } from '../../context/WeddingContext';
import { db, handleFirestoreError, OperationType } from '../../lib/firebase';
import { generateRandomToken } from '../../lib/pix';
import {
  deleteCoverflowViaGitHub,
  formatBytesCompact,
  isSupportedImageFile,
  MAX_RAW_SELECT_BYTES,
  OptimizedImageResult,
  optimizeImageForUpload,
  uploadCoverflowViaServer,
} from '../../lib/imageOptimizer';
import { CoverflowPhoto, FaqCategory, ModerationStatus, TimelineEvent } from '../../types/wedding';

function getAdminCoverflowThumbUrl(imageUrl: string): string {
  if (imageUrl.startsWith('/images/coverflow/')) {
    const filename = imageUrl.slice('/images/coverflow/'.length);
    if (filename && !filename.includes('/') && !filename.includes('..')) {
      return `/api/media/coverflow/display/${encodeURIComponent(filename)}?variant=card`;
    }
  }
  return imageUrl;
}

export const AdminContentModerationTab: React.FC = () => {
  const {
    guestbookMessages,
    photos,
    coverflowPhotos,
    timelineEvents,
    faqs,
    albums,
    user,
    demoAdminActive,
    isAdmin,
    demoActions,
  } = useWedding();

  const useDemoStore = demoAdminActive || !isAdmin;

  const cfFileInputRef = useRef<HTMLInputElement | null>(null);
  const cfSubmitLockRef = useRef(false);
  const [cfFile, setCfFile] = useState<File | null>(null);
  const [cfOptimized, setCfOptimized] = useState<OptimizedImageResult | null>(null);
  const [cfOptimizing, setCfOptimizing] = useState(false);
  const [cfPreviewUrl, setCfPreviewUrl] = useState<string | null>(null);
  const [cfCaption, setCfCaption] = useState('');
  const [cfUploading, setCfUploading] = useState(false);
  const [cfUploadProgress, setCfUploadProgress] = useState(0);
  const [cfUploadStage, setCfUploadStage] = useState<string | null>(null);
  const [cfFeedback, setCfFeedback] = useState<string | null>(null);
  const [cfError, setCfError] = useState<string | null>(null);
  const [githubStatus, setGithubStatus] = useState<{
    checked: boolean;
    configured: boolean;
    authMode?: string;
    missingVars?: string[];
  }>({ checked: false, configured: false });
  const [confirmRemoveCfId, setConfirmRemoveCfId] = useState<string | null>(null);
  const [deletingCfId, setDeletingCfId] = useState<string | null>(null);
  const [editingCfId, setEditingCfId] = useState<string | null>(null);
  const [editCfCaption, setEditCfCaption] = useState('');

  const [evDate, setEvDate] = useState('');
  const [evSubtitle, setEvSubtitle] = useState('');
  const [evTitle, setEvTitle] = useState('');
  const [evDesc, setEvDesc] = useState('');
  const [evImg, setEvImg] = useState('');
  const [evGalleryText, setEvGalleryText] = useState('');

  const [editingEvId, setEditingEvId] = useState<string | null>(null);
  const [editDate, setEditDate] = useState('');
  const [editSubtitle, setEditSubtitle] = useState('');
  const [editTitle, setEditTitle] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editImg, setEditImg] = useState('');
  const [editGallery, setEditGallery] = useState<string[]>([]);
  const [editGalleryInput, setEditGalleryInput] = useState('');

  const [faqCat, setFaqCat] = useState<FaqCategory>('Geral');
  const [faqQ, setFaqQ] = useState('');
  const [faqA, setFaqA] = useState('');

  const [photoAlbumId, setPhotoAlbumId] = useState(albums[0]?.id || 'album-pre-wedding');
  const [photoUrl, setPhotoUrl] = useState('');
  const [photoCaption, setPhotoCaption] = useState('');

  const logAction = async (action: string, details: string) => {
    if (useDemoStore || !user) return;
    await setDoc(doc(db, 'admin_logs', `log_${generateRandomToken(6)}`), {
      actorUid: user.uid,
      actorEmail: user.email || '',
      action,
      details: details.slice(0, 500),
      createdAt: serverTimestamp(),
    });
  };

  const moderateMessage = async (id: string, status: ModerationStatus) => {
    if (useDemoStore) {
      demoActions.moderateGuestbookMessage(id, status);
      return;
    }
    try {
      await updateDoc(doc(db, 'guestbook_messages', id), {
        status,
        updatedAt: serverTimestamp(),
      });
      await logAction('Recado moderado', `${id} -> ${status}`);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `guestbook_messages/${id}`);
    }
  };

  const deleteMessage = async (id: string) => {
    if (useDemoStore) {
      demoActions.deleteGuestbookMessage(id);
      return;
    }
    try {
      await deleteDoc(doc(db, 'guestbook_messages', id));
      await logAction('Recado excluído', id);
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `guestbook_messages/${id}`);
    }
  };

  const moderatePhoto = async (id: string, status: ModerationStatus) => {
    if (useDemoStore) {
      demoActions.moderateGalleryPhoto(id, status);
      return;
    }
    try {
      await updateDoc(doc(db, 'gallery_photos', id), { status });
      await logAction('Foto moderada', `${id} -> ${status}`);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `gallery_photos/${id}`);
    }
  };

  const deletePhoto = async (id: string) => {
    if (useDemoStore) {
      demoActions.deleteGalleryPhoto(id);
      return;
    }
    try {
      await deleteDoc(doc(db, 'gallery_photos', id));
      await logAction('Foto excluída', id);
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `gallery_photos/${id}`);
    }
  };

  const parseGalleryUrls = (raw: string): string[] =>
    raw
      .split(/[\n,]+/)
      .map((u) => u.trim().slice(0, 600))
      .filter((u) => u.length > 0)
      .slice(0, 8);

  const handleAddTimeline = async (e: React.FormEvent) => {
    e.preventDefault();
    const id = `tl_${generateRandomToken(6)}`;
    const nextOrder =
      timelineEvents.reduce((max, item) => Math.max(max, item.order), 0) + 1;
    const galleryUrls = parseGalleryUrls(evGalleryText);
    const item: TimelineEvent = {
      id,
      dateLabel: (evDate.trim() || `Capítulo ${String(nextOrder).padStart(2, '0')}`).slice(0, 60),
      ...(evSubtitle.trim() ? { subtitle: evSubtitle.trim().slice(0, 160) } : {}),
      title: evTitle.trim().slice(0, 140),
      description: evDesc.trim().slice(0, 2500),
      ...(evImg.trim() ? { imageUrl: evImg.trim().slice(0, 600) } : {}),
      ...(galleryUrls.length > 0 ? { galleryUrls } : {}),
      order: nextOrder,
      isDemoExample: false,
    };

    if (useDemoStore) {
      demoActions.addTimelineEvent(item);
    } else {
      try {
        const now = serverTimestamp();
        const { id: _id, ...rest } = item;
        await setDoc(doc(db, 'timeline_events', id), {
          ...rest,
          isDemoExample: false,
          createdAt: now,
          updatedAt: now,
        });
        await logAction('Capítulo da história adicionado', evTitle);
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, `timeline_events/${id}`);
      }
    }
    setEvDate('');
    setEvSubtitle('');
    setEvTitle('');
    setEvDesc('');
    setEvImg('');
    setEvGalleryText('');
  };

  const startEditTimeline = (ev: TimelineEvent) => {
    setEditingEvId(ev.id);
    setEditDate(ev.dateLabel || '');
    setEditSubtitle(ev.subtitle || '');
    setEditTitle(ev.title || '');
    setEditDesc(ev.description || '');
    setEditImg(ev.imageUrl || '');
    setEditGallery(ev.galleryUrls ? [...ev.galleryUrls] : []);
    setEditGalleryInput('');
  };

  const handleAddGalleryPhotoToEdit = () => {
    const url = editGalleryInput.trim().slice(0, 600);
    if (!url || editGallery.length >= 8) return;
    setEditGallery((prev) => [...prev, url]);
    setEditGalleryInput('');
  };

  const handleSaveTimelineEdit = async (e: React.FormEvent, original: TimelineEvent) => {
    e.preventDefault();
    const cleanedGallery = editGallery.map((u) => u.trim().slice(0, 600)).filter(Boolean).slice(0, 8);
    const updated: TimelineEvent = {
      ...original,
      dateLabel: (editDate.trim() || original.dateLabel || 'Capítulo').slice(0, 60),
      subtitle: editSubtitle.trim().slice(0, 160),
      title: editTitle.trim().slice(0, 140),
      description: editDesc.trim().slice(0, 2500),
      imageUrl: editImg.trim().slice(0, 600),
      galleryUrls: cleanedGallery,
      isDemoExample: false,
    };

    if (useDemoStore) {
      demoActions.updateTimelineEvent(updated);
      setEditingEvId(null);
      return;
    }

    try {
      await updateDoc(doc(db, 'timeline_events', original.id), {
        dateLabel: updated.dateLabel,
        subtitle: updated.subtitle || '',
        title: updated.title,
        description: updated.description,
        imageUrl: updated.imageUrl || '',
        galleryUrls: cleanedGallery,
        isDemoExample: false,
        updatedAt: serverTimestamp(),
      });
      await logAction('Capítulo da história atualizado', updated.title);
      setEditingEvId(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `timeline_events/${original.id}`);
    }
  };

  const handleMoveTimeline = async (index: number, direction: -1 | 1) => {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= timelineEvents.length) return;
    const reordered = [...timelineEvents];
    const [moved] = reordered.splice(index, 1);
    reordered.splice(targetIndex, 0, moved);

    if (useDemoStore) {
      demoActions.reorderTimelineEvents(reordered.map((item) => item.id));
      return;
    }

    try {
      const batch = writeBatch(db);
      const now = serverTimestamp();
      reordered.forEach((item, idx) => {
        batch.update(doc(db, 'timeline_events', item.id), {
          order: idx + 1,
          updatedAt: now,
        });
      });
      await batch.commit();
      await logAction('Capítulos reordenados', moved.title);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, 'timeline_events');
    }
  };

  const handleDeleteTimeline = async (id: string) => {
    if (useDemoStore) {
      demoActions.deleteTimelineEvent(id);
      if (editingEvId === id) setEditingEvId(null);
      return;
    }
    try {
      await deleteDoc(doc(db, 'timeline_events', id));
      await logAction('Capítulo da história excluído', id);
      if (editingEvId === id) setEditingEvId(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `timeline_events/${id}`);
    }
  };

  const handleAddFaq = async (e: React.FormEvent) => {
    e.preventDefault();
    const id = `faq_${generateRandomToken(6)}`;
    const item = {
      id,
      category: faqCat,
      question: faqQ.trim().slice(0, 240),
      answer: faqA.trim().slice(0, 1200),
      order: faqs.length + 1,
      isDemoExample: useDemoStore,
    };
    if (useDemoStore) {
      demoActions.addFaq(item);
    } else {
      const { id: _id, ...rest } = item;
      await setDoc(doc(db, 'faqs', id), {
        ...rest,
        isDemoExample: false,
        updatedAt: serverTimestamp(),
      });
      await logAction('FAQ adicionada', faqQ);
    }
    setFaqQ('');
    setFaqA('');
  };

  const handleDeleteFaq = async (id: string) => {
    if (useDemoStore) {
      demoActions.deleteFaq(id);
      return;
    }
    await deleteDoc(doc(db, 'faqs', id));
  };

  const handleAddOfficialPhoto = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!photoUrl.trim()) return;
    const id = `pho_${generateRandomToken(6)}`;
    const photoObj = {
      id,
      albumId: photoAlbumId,
      imageUrl: photoUrl.trim().slice(0, 600),
      ...(photoCaption.trim() ? { caption: photoCaption.trim().slice(0, 240) } : {}),
      uploadedBy: 'Dalmo & Jadi',
      sizeBytes: 0,
      status: 'approved' as const,
      consentToPublish: true,
    };

    if (useDemoStore) {
      demoActions.createGalleryPhoto(photoObj);
    } else {
      const { id: _id, ...rest } = photoObj;
      await setDoc(doc(db, 'gallery_photos', id), {
        ...rest,
        createdAt: serverTimestamp(),
      });
      await logAction('Foto oficial adicionada', photoAlbumId);
    }
    setPhotoUrl('');
    setPhotoCaption('');
  };

  useEffect(() => {
    let cancelled = false;
    fetch('/api/media/storage-status')
      .then((r) => r.json())
      .then((data: {
        github?: {
          configured?: boolean;
          authMode?: string;
          missingVars?: string[];
        };
      }) => {
        if (!cancelled) {
          setGithubStatus({
            checked: true,
            configured: Boolean(data.github?.configured),
            authMode: data.github?.authMode,
            missingVars: data.github?.missingVars,
          });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setGithubStatus({ checked: true, configured: false });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (cfPreviewUrl) {
        URL.revokeObjectURL(cfPreviewUrl);
      }
    };
  }, [cfPreviewUrl]);

  const handleSelectCoverflowFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setCfError(null);
    setCfFeedback(null);
    setCfUploadProgress(0);
    setCfUploadStage(null);
    const file = e.target.files?.[0] || null;
    if (!file) {
      setCfFile(null);
      setCfOptimized(null);
      setCfPreviewUrl(null);
      return;
    }
    if (!isSupportedImageFile(file)) {
      setCfError('Selecione uma imagem válida (JPG, JPEG, PNG ou WEBP).');
      e.target.value = '';
      setCfFile(null);
      setCfOptimized(null);
      setCfPreviewUrl(null);
      return;
    }
    if (file.size <= 0 || file.size > MAX_RAW_SELECT_BYTES) {
      setCfError('A imagem selecionada deve ter no máximo 25 MB.');
      e.target.value = '';
      setCfFile(null);
      setCfOptimized(null);
      setCfPreviewUrl(null);
      return;
    }

    setCfFile(file);
    setCfOptimized(null);
    setCfOptimizing(true);
    try {
      const optimized = await optimizeImageForUpload(file, {
        maxDimension: 1600,
        targetMaxBytes: 1200 * 1024,
        quality: 0.86,
      });
      setCfOptimized(optimized);
      setCfPreviewUrl(URL.createObjectURL(optimized.blob));
    } catch (err) {
      setCfFile(null);
      setCfOptimized(null);
      setCfPreviewUrl(null);
      e.target.value = '';
      setCfError(
        err instanceof Error
          ? err.message
          : 'Não foi possível preparar e otimizar a imagem selecionada.'
      );
    } finally {
      setCfOptimizing(false);
    }
  };

  const handleAddCoverflowPhoto = async (e: React.FormEvent) => {
    e.preventDefault();
    if (cfSubmitLockRef.current || cfUploading || cfOptimizing) return;

    if (!cfFile) {
      setCfError('Selecione uma fotografia antes de adicionar ao carrossel 3D.');
      return;
    }

    cfSubmitLockRef.current = true;
    setCfUploading(true);
    setCfError(null);
    setCfFeedback(null);
    setCfUploadProgress(0);

    try {
      let prepared = cfOptimized;
      if (!prepared) {
        setCfUploadStage('Otimizando fotografia...');
        prepared = await optimizeImageForUpload(cfFile, {
          maxDimension: 1600,
          targetMaxBytes: 1200 * 1024,
          quality: 0.86,
        });
        setCfOptimized(prepared);
      }

      setCfUploadStage('Enviando para o GitHub e validando URL pública...');
      const uploadResult = await uploadCoverflowViaServer({
        blob: prepared.blob,
        fileName: prepared.fileName,
        caption: cfCaption,
        onProgress: (pct) => {
          setCfUploadProgress(pct);
          if (pct >= 85) {
            setCfUploadStage('Publicando no GitHub e validando exibição imediata...');
          }
        },
      });

      setCfUploadProgress(96);
      setCfUploadStage('Salvando na Galeria 3D (Firestore)...');

      const id = `cf_${generateRandomToken(6)}`;
      const nextOrder =
        coverflowPhotos.reduce((max, item) => Math.max(max, item.order), 0) + 1;
      const trimmedCaption = cfCaption.trim().slice(0, 200);
      const newPhoto: CoverflowPhoto = {
        id,
        imageUrl: uploadResult.url,
        ...(trimmedCaption ? { caption: trimmedCaption } : {}),
        order: nextOrder,
      };

      if (useDemoStore) {
        demoActions.addCoverflowPhoto(newPhoto);
      } else {
        try {
          const existingSnap = await getDocs(collection(db, 'coverflow_photos'));
          const batch = writeBatch(db);
          const now = serverTimestamp();

          if (existingSnap.empty && coverflowPhotos.length > 0) {
            coverflowPhotos.forEach((starter, idx) => {
              batch.set(doc(db, 'coverflow_photos', starter.id), {
                imageUrl: starter.imageUrl,
                ...(starter.caption ? { caption: starter.caption } : {}),
                order: idx + 1,
                createdAt: now,
                updatedAt: now,
              });
            });
          }

          batch.set(doc(db, 'coverflow_photos', id), {
            imageUrl: newPhoto.imageUrl,
            ...(trimmedCaption ? { caption: trimmedCaption } : {}),
            order: existingSnap.empty ? coverflowPhotos.length + 1 : nextOrder,
            createdAt: now,
            updatedAt: now,
          });
          await batch.commit();
          await logAction('Foto adicionada ao carrossel 3D', trimmedCaption || uploadResult.filename);
        } catch (err) {
          const rawMsg = err instanceof Error ? err.message : String(err);
          if (/permission|insufficient/i.test(rawMsg)) {
            throw new Error(
              'A fotografia foi salva no GitHub, mas o Firestore recusou a gravação em coverflow_photos (Missing or insufficient permissions). Verifique sua sessão Google de administrador e o firestore.rules publicado.'
            );
          }
          handleFirestoreError(err, OperationType.CREATE, `coverflow_photos/${id}`);
          throw err;
        }
      }

      setCfUploadProgress(100);
      setCfFile(null);
      setCfOptimized(null);
      setCfPreviewUrl(null);
      setCfCaption('');
      if (cfFileInputRef.current) {
        cfFileInputRef.current.value = '';
      }
      setCfFeedback(
        `Fotografia "${uploadResult.filename}" enviada ao GitHub, verificada e exibida imediatamente no carrossel 3D!`
      );
    } catch (err) {
      setCfError(err instanceof Error ? err.message : 'Erro ao enviar fotografia.');
    } finally {
      cfSubmitLockRef.current = false;
      setCfUploading(false);
      setCfUploadStage(null);
    }
  };

  const handleSaveCoverflowCaption = async (photo: CoverflowPhoto) => {
    const cleanedCaption = editCfCaption.trim().slice(0, 200);
    const updated: CoverflowPhoto = {
      ...photo,
      caption: cleanedCaption,
    };

    if (useDemoStore) {
      demoActions.updateCoverflowPhoto(updated);
      setEditingCfId(null);
      return;
    }

    try {
      const existingSnap = await getDocs(collection(db, 'coverflow_photos'));
      const now = serverTimestamp();
      if (existingSnap.empty) {
        const batch = writeBatch(db);
        coverflowPhotos.forEach((item, idx) => {
          const nextCap = item.id === photo.id ? cleanedCaption : item.caption || '';
          batch.set(doc(db, 'coverflow_photos', item.id), {
            imageUrl: item.imageUrl,
            ...(nextCap ? { caption: nextCap } : {}),
            order: idx + 1,
            createdAt: now,
            updatedAt: now,
          });
        });
        await batch.commit();
      } else {
        await updateDoc(doc(db, 'coverflow_photos', photo.id), {
          caption: cleanedCaption,
          updatedAt: now,
        });
      }
      await logAction('Legenda do carrossel 3D atualizada', photo.id);
      setEditingCfId(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `coverflow_photos/${photo.id}`);
    }
  };

  const handleMoveCoverflowPhoto = async (index: number, direction: -1 | 1) => {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= coverflowPhotos.length) return;
    const reordered = [...coverflowPhotos];
    const [moved] = reordered.splice(index, 1);
    reordered.splice(targetIndex, 0, moved);

    if (useDemoStore) {
      demoActions.reorderCoverflowPhotos(reordered.map((item) => item.id));
      return;
    }

    try {
      const existingSnap = await getDocs(collection(db, 'coverflow_photos'));
      const existingIds = new Set(existingSnap.docs.map((d) => d.id));
      const batch = writeBatch(db);
      const now = serverTimestamp();

      reordered.forEach((item, idx) => {
        const ref = doc(db, 'coverflow_photos', item.id);
        if (existingIds.has(item.id)) {
          batch.update(ref, {
            order: idx + 1,
            updatedAt: now,
          });
        } else {
          batch.set(ref, {
            imageUrl: item.imageUrl,
            ...(item.caption ? { caption: item.caption } : {}),
            order: idx + 1,
            createdAt: now,
            updatedAt: now,
          });
        }
      });

      await batch.commit();
      await logAction('Carrossel 3D reordenado', moved.caption || moved.id);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, 'coverflow_photos');
    }
  };

  const handleDeleteCoverflowPhoto = async (photo: CoverflowPhoto) => {
    if (deletingCfId) return;
    setCfError(null);
    setCfFeedback(null);
    setConfirmRemoveCfId(null);
    setDeletingCfId(photo.id);

    try {
      if (useDemoStore) {
        demoActions.deleteCoverflowPhoto(photo.id);
        if (editingCfId === photo.id) setEditingCfId(null);
        return;
      }

      // Safely remove file from GitHub only if it is an uploaded GitHub coverflow file (starter lembranca-* files are protected on backend)
      let githubNotice = '';
      if (photo.imageUrl.includes('/public/images/coverflow/')) {
        const ghRes = await deleteCoverflowViaGitHub(photo.imageUrl);
        if (ghRes.githubDeleted) {
          githubNotice = ' e removida do repositório GitHub';
        }
      }

      const existingSnap = await getDocs(collection(db, 'coverflow_photos'));
      const remaining = coverflowPhotos.filter((p) => p.id !== photo.id);
      const batch = writeBatch(db);
      const now = serverTimestamp();

      if (existingSnap.empty) {
        remaining.forEach((item, idx) => {
          batch.set(doc(db, 'coverflow_photos', item.id), {
            imageUrl: item.imageUrl,
            ...(item.caption ? { caption: item.caption } : {}),
            order: idx + 1,
            createdAt: now,
            updatedAt: now,
          });
        });
      } else {
        batch.delete(doc(db, 'coverflow_photos', photo.id));
        remaining.forEach((item, idx) => {
          batch.update(doc(db, 'coverflow_photos', item.id), {
            order: idx + 1,
            updatedAt: now,
          });
        });
      }

      await batch.commit();
      await logAction('Foto removida do carrossel 3D', photo.id);
      if (editingCfId === photo.id) setEditingCfId(null);
      setCfFeedback(`Fotografia removida do carrossel 3D${githubNotice}.`);
    } catch (err) {
      setCfError(
        err instanceof Error ? err.message : 'Não foi possível excluir a fotografia.'
      );
    } finally {
      setDeletingCfId(null);
    }
  };

  return (
    <div className="space-y-10">
      <section className="rounded-lg border border-dourado/45 bg-creme-claro p-6 space-y-5">
        <div>
          <h2 className="font-display text-2xl font-semibold text-marrom">
            Galeria 3D do Cartão Inicial — Nossa Caminhada ({coverflowPhotos.length})
          </h2>
          <p className="mt-1 text-xs text-marrom-suave">
            Selecione uma fotografia, informe uma legenda opcional e adicione ao carrossel 3D. A imagem é otimizada automaticamente em WebP, salva no GitHub e exibida imediatamente sem republicar o site.
          </p>
        </div>

        {githubStatus.checked && !githubStatus.configured && (
          <div className="rounded-md border border-terracota/45 bg-terracota/10 px-3.5 py-2.5 text-xs text-marrom">
            <strong>Configuração pendente do GitHub App:</strong> o envio automático está aguardando as credenciais nas Secrets do servidor (
            <code className="text-[11px]">
              {(githubStatus.missingVars || ['GITHUB_APP_ID', 'GITHUB_APP_INSTALLATION_ID', 'GITHUB_APP_PRIVATE_KEY']).join(', ')}
            </code>
            ). Configure o GitHub App nas Secrets do Google AI Studio para habilitar o envio direto pelo painel.
          </div>
        )}

        <form
          onSubmit={handleAddCoverflowPhoto}
          className="rounded-md border border-dourado/35 bg-creme/55 p-4 space-y-3"
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-12 sm:items-center">
            <label
              className={`sm:col-span-5 flex items-center gap-2 rounded-md border border-dashed border-dourado/70 bg-creme-claro px-3 py-2.5 text-xs font-medium text-marrom transition-colors ${
                cfUploading || cfOptimizing
                  ? 'cursor-not-allowed opacity-60'
                  : 'cursor-pointer hover:bg-pergaminho/45'
              }`}
            >
              <Upload className="h-4 w-4 shrink-0 text-terracota-escuro" />
              <span className="truncate">
                {cfFile ? cfFile.name : 'Selecionar fotografia (JPG, PNG ou WEBP)'}
              </span>
              <input
                ref={cfFileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                disabled={cfUploading || cfOptimizing}
                onChange={handleSelectCoverflowFile}
                className="sr-only"
              />
            </label>

            <input
              type="text"
              maxLength={200}
              disabled={cfUploading}
              value={cfCaption}
              onChange={(e) => setCfCaption(e.target.value)}
              placeholder="Legenda opcional"
              aria-label="Legenda opcional"
              className="sm:col-span-4 rounded-md border border-dourado/40 bg-creme-claro px-3 py-2 text-sm disabled:opacity-60"
            />

            <button
              type="submit"
              disabled={cfUploading || cfOptimizing || !cfFile}
              className="sm:col-span-3 inline-flex items-center justify-center gap-1.5 rounded-md bg-terracota-escuro px-4 py-2.5 text-xs font-semibold text-creme-claro uppercase disabled:opacity-50 hover:bg-terracota transition-colors"
            >
              <Plus className="h-4 w-4" />
              {cfOptimizing
                ? 'Otimizando...'
                : cfUploading
                  ? `Enviando (${cfUploadProgress}%)`
                  : 'Adicionar ao carrossel 3D'}
            </button>
          </div>

          {cfUploading && (
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[11px] text-marrom-suave">
                <span>{cfUploadStage || 'Enviando fotografia...'}</span>
                <span className="tabular-nums font-semibold">{cfUploadProgress}%</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-dourado/25">
                <div
                  className="h-full bg-terracota-escuro transition-all duration-150"
                  style={{ width: `${cfUploadProgress}%` }}
                />
              </div>
            </div>
          )}

          {cfPreviewUrl && cfOptimized && (
            <div className="flex items-center gap-3 pt-1">
              <img
                src={cfPreviewUrl}
                alt="Pré-visualização da fotografia selecionada"
                className="h-14 w-20 shrink-0 rounded border border-dourado/45 object-cover"
              />
              <p className="text-[11px] text-oliva font-medium">
                Pronta em {cfOptimized.mimeType === 'image/webp' ? 'WebP' : 'JPEG'} (
                {cfOptimized.width}×{cfOptimized.height}px ·{' '}
                {formatBytesCompact(cfOptimized.originalBytes)} →{' '}
                {formatBytesCompact(cfOptimized.optimizedBytes)})
              </p>
            </div>
          )}

          {cfError && <p className="text-xs font-medium text-terracota-escuro">{cfError}</p>}
          {cfFeedback && <p className="text-xs font-medium text-oliva">{cfFeedback}</p>}
        </form>

        {coverflowPhotos.length === 0 ? (
          <p className="text-sm text-marrom-suave">
            Nenhuma fotografia no carrossel 3D no momento. Envie uma imagem acima para exibi-la no cartão da página inicial.
          </p>
        ) : (
          <div className="space-y-2.5">
            {coverflowPhotos.map((photo, index) => {
              const isEditing = editingCfId === photo.id;
              return (
                <div
                  key={photo.id}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-md border border-dourado/30 bg-creme/50 p-3"
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <span className="w-6 text-center font-display text-sm font-semibold text-terracota-escuro tabular-nums shrink-0">
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    <img
                      src={getAdminCoverflowThumbUrl(photo.imageUrl)}
                      alt={photo.caption || `Foto ${index + 1}`}
                      onError={(e) => {
                        const img = e.currentTarget;
                        if (img.src !== window.location.origin + photo.imageUrl) {
                          img.src = photo.imageUrl;
                        }
                      }}
                      className="h-14 w-20 shrink-0 rounded border border-dourado/40 object-cover bg-pergaminho/40"
                    />
                    <div className="min-w-0 flex-1">
                      {isEditing ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <input
                            type="text"
                            maxLength={200}
                            value={editCfCaption}
                            onChange={(e) => setEditCfCaption(e.target.value)}
                            placeholder="Legenda da fotografia"
                            className="flex-1 min-w-[180px] rounded-md border border-dourado/50 bg-creme-claro px-2.5 py-1.5 text-xs"
                          />
                          <button
                            type="button"
                            onClick={() => handleSaveCoverflowCaption(photo)}
                            className="inline-flex items-center gap-1 rounded bg-salvia px-2.5 py-1.5 text-xs font-semibold text-white"
                          >
                            <Check className="h-3.5 w-3.5" />
                            Salvar
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingCfId(null)}
                            className="rounded border border-dourado/40 px-2.5 py-1.5 text-xs text-marrom"
                          >
                            Cancelar
                          </button>
                        </div>
                      ) : (
                        <>
                          <p className="text-sm font-medium text-marrom truncate">
                            {photo.caption || 'Sem legenda'}
                          </p>
                          <p className="text-[11px] text-marrom-suave truncate">
                            {photo.imageUrl}
                          </p>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-1 self-end sm:self-center">
                    <button
                      type="button"
                      onClick={() => handleMoveCoverflowPhoto(index, -1)}
                      disabled={index === 0}
                      aria-label="Mover fotografia para cima"
                      className="rounded border border-dourado/35 p-1.5 text-marrom disabled:opacity-35 hover:bg-creme-claro"
                    >
                      <ArrowUp className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleMoveCoverflowPhoto(index, 1)}
                      disabled={index === coverflowPhotos.length - 1}
                      aria-label="Mover fotografia para baixo"
                      className="rounded border border-dourado/35 p-1.5 text-marrom disabled:opacity-35 hover:bg-creme-claro"
                    >
                      <ArrowDown className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingCfId(photo.id);
                        setEditCfCaption(photo.caption || '');
                      }}
                      aria-label="Editar legenda da fotografia"
                      className="rounded border border-dourado/35 p-1.5 text-marrom hover:bg-creme-claro"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    {confirmRemoveCfId === photo.id ? (
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => handleDeleteCoverflowPhoto(photo)}
                          className="rounded bg-terracota-escuro px-2 py-1 text-[11px] font-semibold text-creme-claro hover:bg-terracota"
                        >
                          Remover do 3D
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmRemoveCfId(null)}
                          className="rounded border border-dourado/35 px-2 py-1 text-[11px] text-marrom hover:bg-creme-claro"
                        >
                          Cancelar
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmRemoveCfId(photo.id)}
                        aria-label="Remover fotografia da lista do carrossel 3D"
                        className="rounded border border-dourado/35 p-1.5 text-terracota-escuro hover:bg-creme-claro"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="rounded-lg border border-dourado/35 bg-creme-claro p-6">
        <h2 className="font-display text-2xl font-semibold text-marrom">
          Moderação do Mural de Recados ({guestbookMessages.length})
        </h2>
        <div className="mt-4 space-y-3">
          {guestbookMessages.length === 0 ? (
            <p className="text-sm text-marrom-suave">Nenhuma mensagem enviada ainda.</p>
          ) : (
            guestbookMessages.map((m) => (
              <div
                key={m.id}
                className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-md border border-dourado/30 bg-creme/50 p-4"
              >
                <div>
                  <p className="text-xs font-semibold text-salvia uppercase">
                    {m.status} · {m.authorName} {m.relationship ? `(${m.relationship})` : ''}
                  </p>
                  <p className="mt-1 text-sm text-marrom">“{m.message}”</p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => moderateMessage(m.id, 'approved')}
                    className="inline-flex items-center gap-1 rounded-md bg-salvia px-3 py-1.5 text-xs font-semibold text-white"
                  >
                    <Check className="h-3.5 w-3.5" />
                    Aprovar
                  </button>
                  <button
                    type="button"
                    onClick={() => moderateMessage(m.id, 'rejected')}
                    className="inline-flex items-center gap-1 rounded-md border border-dourado/40 px-3 py-1.5 text-xs text-marrom"
                  >
                    <X className="h-3.5 w-3.5" />
                    Ocultar
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteMessage(m.id)}
                    aria-label="Excluir recado"
                    className="inline-flex items-center justify-center rounded-md border border-dourado/40 p-1.5 text-terracota-escuro"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="rounded-lg border border-dourado/35 bg-creme-claro p-6 space-y-5">
        <h2 className="font-display text-2xl font-semibold text-marrom">
          Galeria &amp; Moderação de Fotos ({photos.length})
        </h2>

        <form onSubmit={handleAddOfficialPhoto} className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <select
            value={photoAlbumId}
            onChange={(e) => setPhotoAlbumId(e.target.value)}
            className="rounded-md border border-dourado/40 bg-creme-claro px-3 py-2 text-sm"
          >
            {albums.map((a) => (
              <option key={a.id} value={a.id}>
                {a.title}
              </option>
            ))}
          </select>
          <input
            type="url"
            required
            value={photoUrl}
            onChange={(e) => setPhotoUrl(e.target.value)}
            placeholder="URL da foto do casal"
            className="rounded-md border border-dourado/40 bg-creme-claro px-3 py-2 text-sm"
          />
          <input
            type="text"
            value={photoCaption}
            onChange={(e) => setPhotoCaption(e.target.value)}
            placeholder="Legenda opcional"
            className="rounded-md border border-dourado/40 bg-creme-claro px-3 py-2 text-sm"
          />
          <button
            type="submit"
            className="inline-flex items-center justify-center gap-1.5 rounded-md bg-terracota-escuro px-4 py-2 text-xs font-semibold text-creme-claro uppercase"
          >
            <Plus className="h-4 w-4" />
            Adicionar foto
          </button>
        </form>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {photos.map((p) => (
            <div key={p.id} className="rounded-md border border-dourado/30 bg-creme/50 p-3 space-y-2">
              <img
                src={p.imageUrl}
                alt={p.caption || 'Foto enviada'}
                referrerPolicy="no-referrer"
                className="aspect-[4/3] w-full rounded object-cover"
              />
              <p className="text-xs text-marrom-suave">
                {p.status} · por {p.uploadedBy}
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => moderatePhoto(p.id, 'approved')}
                  className="flex-1 rounded bg-salvia py-1 text-xs font-semibold text-white"
                >
                  Aprovar
                </button>
                <button
                  type="button"
                  onClick={() => moderatePhoto(p.id, 'rejected')}
                  className="flex-1 rounded border border-dourado/40 py-1 text-xs text-marrom"
                >
                  Ocultar
                </button>
                <button
                  type="button"
                  onClick={() => deletePhoto(p.id)}
                  className="rounded border border-dourado/40 px-2 text-terracota-escuro"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        <section className="rounded-lg border border-dourado/35 bg-creme-claro p-6 space-y-5">
          <div>
            <h2 className="font-display text-2xl font-semibold text-marrom">
              Capítulos de Nossa História ({timelineEvents.length})
            </h2>
            <p className="mt-1 text-xs text-marrom-suave">
              Edite títulos, subtítulos, narrativas, fotografia principal e galeria de cada capítulo, ou reordene os acontecimentos.
            </p>
          </div>

          <div className="space-y-3">
            {timelineEvents.map((ev, index) => {
              const isEditing = editingEvId === ev.id;
              return (
                <div
                  key={ev.id}
                  className="rounded-md border border-dourado/35 bg-creme/50 p-4 space-y-3"
                >
                  {isEditing ? (
                    <form
                      onSubmit={(e) => handleSaveTimelineEdit(e, ev)}
                      className="space-y-3"
                    >
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <input
                          type="text"
                          required
                          maxLength={60}
                          value={editDate}
                          onChange={(e) => setEditDate(e.target.value)}
                          placeholder="Rótulo / Momento (ex.: Capítulo 01)"
                          className="w-full rounded-md border border-dourado/40 bg-creme-claro px-3 py-2 text-sm"
                        />
                        <input
                          type="text"
                          maxLength={160}
                          value={editSubtitle}
                          onChange={(e) => setEditSubtitle(e.target.value)}
                          placeholder="Subtítulo do capítulo"
                          className="w-full rounded-md border border-dourado/40 bg-creme-claro px-3 py-2 text-sm"
                        />
                      </div>
                      <input
                        type="text"
                        required
                        maxLength={140}
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        placeholder="Título do capítulo"
                        className="w-full rounded-md border border-dourado/40 bg-creme-claro px-3 py-2 text-sm font-medium"
                      />
                      <textarea
                        rows={5}
                        required
                        maxLength={2500}
                        value={editDesc}
                        onChange={(e) => setEditDesc(e.target.value)}
                        placeholder="Narrativa completa do acontecimento"
                        className="w-full rounded-md border border-dourado/40 bg-creme-claro px-3 py-2 text-sm leading-relaxed"
                      />
                      <input
                        type="url"
                        maxLength={600}
                        value={editImg}
                        onChange={(e) => setEditImg(e.target.value)}
                        placeholder="URL da fotografia principal (opcional)"
                        className="w-full rounded-md border border-dourado/40 bg-creme-claro px-3 py-2 text-sm"
                      />

                      <div className="space-y-2 rounded-md border border-dourado/25 bg-creme-claro/80 p-3">
                        <p className="text-xs font-semibold text-marrom">
                          Galeria de fotografias associada ({editGallery.length}/8)
                        </p>
                        <div className="flex gap-2">
                          <input
                            type="url"
                            maxLength={600}
                            value={editGalleryInput}
                            onChange={(e) => setEditGalleryInput(e.target.value)}
                            placeholder="Adicionar URL de foto para este capítulo"
                            className="flex-1 rounded-md border border-dourado/40 bg-creme-claro px-3 py-1.5 text-xs"
                          />
                          <button
                            type="button"
                            onClick={handleAddGalleryPhotoToEdit}
                            className="rounded-md border border-dourado/60 px-3 py-1.5 text-xs font-semibold text-marrom hover:bg-pergaminho/60"
                          >
                            Incluir
                          </button>
                        </div>
                        {editGallery.length > 0 && (
                          <div className="grid grid-cols-2 gap-2 pt-1 sm:grid-cols-3">
                            {editGallery.map((url, idx) => (
                              <div
                                key={`${url}-${idx}`}
                                className="relative overflow-hidden rounded border border-dourado/35 bg-creme"
                              >
                                <img
                                  src={url}
                                  alt={`Galeria ${idx + 1}`}
                                  referrerPolicy="no-referrer"
                                  className="aspect-[4/3] w-full object-cover"
                                />
                                <button
                                  type="button"
                                  onClick={() =>
                                    setEditGallery((prev) => prev.filter((_, i) => i !== idx))
                                  }
                                  aria-label="Remover foto da galeria do capítulo"
                                  className="absolute top-1 right-1 rounded bg-marrom/80 p-1 text-creme-claro hover:bg-terracota-escuro"
                                >
                                  <X className="h-3 w-3" />
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="flex flex-wrap gap-2 pt-1">
                        <button
                          type="submit"
                          className="inline-flex items-center gap-1.5 rounded-md bg-terracota-escuro px-4 py-2 text-xs font-semibold text-creme-claro uppercase"
                        >
                          <Check className="h-3.5 w-3.5" />
                          Salvar capítulo
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingEvId(null)}
                          className="rounded-md border border-dourado/40 px-4 py-2 text-xs font-medium text-marrom"
                        >
                          Cancelar
                        </button>
                      </div>
                    </form>
                  ) : (
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-[11px] font-semibold tracking-wider text-salvia uppercase">
                          {String(index + 1).padStart(2, '0')} · {ev.dateLabel}
                          {ev.subtitle ? ` — ${ev.subtitle}` : ''}
                        </p>
                        <p className="mt-0.5 font-display text-lg font-semibold text-marrom">
                          {ev.title}
                        </p>
                        <p className="mt-1 line-clamp-2 text-xs text-marrom-suave">
                          {ev.description}
                        </p>
                        <p className="mt-1.5 text-[11px] text-marrom-suave">
                          Foto principal: {ev.imageUrl ? 'configurada' : 'vazia'} · Galeria:{' '}
                          {ev.galleryUrls?.length || 0} foto(s)
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          onClick={() => handleMoveTimeline(index, -1)}
                          disabled={index === 0}
                          aria-label="Mover capítulo para cima"
                          className="rounded border border-dourado/35 p-1.5 text-marrom disabled:opacity-35 hover:bg-creme-claro"
                        >
                          <ArrowUp className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleMoveTimeline(index, 1)}
                          disabled={index === timelineEvents.length - 1}
                          aria-label="Mover capítulo para baixo"
                          className="rounded border border-dourado/35 p-1.5 text-marrom disabled:opacity-35 hover:bg-creme-claro"
                        >
                          <ArrowDown className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => startEditTimeline(ev)}
                          aria-label="Editar capítulo"
                          className="rounded border border-dourado/35 p-1.5 text-marrom hover:bg-creme-claro"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteTimeline(ev.id)}
                          aria-label="Remover capítulo"
                          className="rounded border border-dourado/35 p-1.5 text-terracota-escuro hover:bg-creme-claro"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <form
            onSubmit={handleAddTimeline}
            className="space-y-3 border-t border-dourado/30 pt-4"
          >
            <p className="text-xs font-semibold tracking-wider text-marrom uppercase">
              Adicionar novo capítulo
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <input
                type="text"
                required
                maxLength={60}
                value={evDate}
                onChange={(e) => setEvDate(e.target.value)}
                placeholder="Rótulo (ex.: Capítulo 04)"
                className="w-full rounded-md border border-dourado/40 bg-creme-claro px-3 py-2 text-sm"
              />
              <input
                type="text"
                maxLength={160}
                value={evSubtitle}
                onChange={(e) => setEvSubtitle(e.target.value)}
                placeholder="Subtítulo (opcional)"
                className="w-full rounded-md border border-dourado/40 bg-creme-claro px-3 py-2 text-sm"
              />
            </div>
            <input
              type="text"
              required
              maxLength={140}
              value={evTitle}
              onChange={(e) => setEvTitle(e.target.value)}
              placeholder="Título do capítulo"
              className="w-full rounded-md border border-dourado/40 bg-creme-claro px-3 py-2 text-sm"
            />
            <textarea
              rows={3}
              required
              maxLength={2500}
              value={evDesc}
              onChange={(e) => setEvDesc(e.target.value)}
              placeholder="Narrativa do momento"
              className="w-full rounded-md border border-dourado/40 bg-creme-claro px-3 py-2 text-sm"
            />
            <input
              type="url"
              maxLength={600}
              value={evImg}
              onChange={(e) => setEvImg(e.target.value)}
              placeholder="URL da foto principal (opcional)"
              className="w-full rounded-md border border-dourado/40 bg-creme-claro px-3 py-2 text-sm"
            />
            <textarea
              rows={2}
              value={evGalleryText}
              onChange={(e) => setEvGalleryText(e.target.value)}
              placeholder="URLs de fotos da galeria do capítulo (uma por linha, opcional)"
              className="w-full rounded-md border border-dourado/40 bg-creme-claro px-3 py-2 text-xs"
            />
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 rounded-md bg-terracota-escuro px-4 py-2 text-xs font-semibold text-creme-claro uppercase"
            >
              <Plus className="h-3.5 w-3.5" />
              Adicionar capítulo
            </button>
          </form>
        </section>

        <section className="rounded-lg border border-dourado/35 bg-creme-claro p-6 space-y-4">
          <h2 className="font-display text-2xl font-semibold text-marrom">
            Perguntas Frequentes ({faqs.length})
          </h2>
          <form onSubmit={handleAddFaq} className="space-y-3">
            <select
              value={faqCat}
              onChange={(e) => setFaqCat(e.target.value as FaqCategory)}
              className="w-full rounded-md border border-dourado/40 bg-creme-claro px-3 py-2 text-sm"
            >
              {(['RSVP', 'Presentes', 'Horários', 'Crianças', 'Cerimônia', 'Geral'] as const).map(
                (c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                )
              )}
            </select>
            <input
              type="text"
              required
              value={faqQ}
              onChange={(e) => setFaqQ(e.target.value)}
              placeholder="Pergunta"
              className="w-full rounded-md border border-dourado/40 bg-creme-claro px-3 py-2 text-sm"
            />
            <textarea
              rows={2}
              required
              value={faqA}
              onChange={(e) => setFaqA(e.target.value)}
              placeholder="Resposta oficial dos noivos"
              className="w-full rounded-md border border-dourado/40 bg-creme-claro px-3 py-2 text-sm"
            />
            <button
              type="submit"
              className="rounded-md bg-terracota-escuro px-4 py-2 text-xs font-semibold text-creme-claro uppercase"
            >
              Adicionar pergunta
            </button>
          </form>
          <div className="space-y-2 pt-2">
            {faqs.map((f) => (
              <div
                key={f.id}
                className="flex items-center justify-between gap-3 rounded border border-dourado/25 bg-creme/50 px-3 py-2 text-xs"
              >
                <span className="truncate font-medium text-marrom">
                  [{f.category}] {f.question}
                </span>
                {(useDemoStore || !f.id.startsWith('demo-')) && (
                  <button
                    type="button"
                    onClick={() => handleDeleteFaq(f.id)}
                    className="text-terracota-escuro"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
};
