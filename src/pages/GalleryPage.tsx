import React, { useState } from 'react';
import { Camera, CheckCircle2, Upload } from 'lucide-react';
import { useWedding } from '../context/WeddingContext';
import { handleFirestoreError, OperationType } from '../lib/firebase';
import { generateRandomToken } from '../lib/pix';
import { BotanicalDivider } from '../components/BotanicalDivider';
import { ResilientImage } from '../components/ResilientImage';
import { WatercolorCorners } from '../components/WatercolorCorners';

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Falha ao ler imagem'));
    reader.readAsDataURL(file);
  });
}

export const GalleryPage: React.FC = () => {
  const { albums, photos, setPrivacyModalOpen, demoActions } =
    useWedding();
  const [activeAlbumId, setActiveAlbumId] = useState<string>('all');

  const [uploaderName, setUploaderName] = useState('');
  const [caption, setCaption] = useState('');
  const [targetAlbumId, setTargetAlbumId] = useState('album-colaborativo');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [consent, setConsent] = useState(false);

  const [uploading, setUploading] = useState(false);
  const [uploadSuccess, setUploadSuccess] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const approvedPhotos = photos
    .filter((p) => p.status === 'approved')
    .filter((p) => activeAlbumId === 'all' || p.albumId === activeAlbumId);

  const collaborativeAlbums = albums.filter((a) => a.allowGuestUploads);

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    setUploadError(null);
    setUploadSuccess(false);

    if (!selectedFile) {
      setUploadError('Selecione uma imagem para enviar.');
      return;
    }
    if (!selectedFile.type.startsWith('image/')) {
      setUploadError('Apenas arquivos de imagem são permitidos.');
      return;
    }
    if (selectedFile.size > MAX_PHOTO_BYTES) {
      setUploadError('A imagem ultrapassa o limite de 5 MB.');
      return;
    }
    if (uploaderName.trim().length < 2) {
      setUploadError('Informe seu nome.');
      return;
    }
    if (!consent) {
      setUploadError('Confirme a autorização de publicação e uso de imagem (LGPD).');
      return;
    }

    setUploading(true);
    try {
      const albumToUse = collaborativeAlbums[0]?.id || targetAlbumId;
      const photoId = `pho_${generateRandomToken(8)}`;
      const previewUrl = await readFileAsDataUrl(selectedFile);

      // Sem Firebase Storage no plano Starter: mantém a pré-visualização local no modo demonstração/curadoria
      demoActions.createGalleryPhoto({
        id: photoId,
        albumId: albumToUse,
        imageUrl: previewUrl,
        ...(caption.trim() ? { caption: caption.trim().slice(0, 240) } : {}),
        uploadedBy: uploaderName.trim().slice(0, 100),
        sizeBytes: selectedFile.size,
        status: 'pending',
        consentToPublish: true,
      });

      setUploadSuccess(true);
      setCaption('');
      setSelectedFile(null);
      setConsent(false);
    } catch (err) {
      setUploadError('Não foi possível processar a imagem selecionada.');
      try {
        handleFirestoreError(err, OperationType.CREATE, 'gallery_photos');
      } catch {
        // logged
      }
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="relative overflow-hidden py-14 sm:py-20">
      <WatercolorCorners variant="section" />
      <div className="relative z-20 mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <header className="text-center max-w-2xl mx-auto">
          <p className="text-xs font-semibold tracking-[0.22em] text-oliva uppercase">
            Galeria &amp; Álbum Colaborativo
          </p>
          <h1 className="mt-3 font-display text-4xl sm:text-5xl font-semibold text-marrom">
            Memórias para guardar para sempre
          </h1>
          <p className="mt-3 text-base text-marrom-suave">
            Espaços organizados em álbuns para as fotos do casal e para os registros enviados pelos
            convidados após moderação.
          </p>
        </header>

        <div className="mt-8 flex flex-wrap justify-center gap-2" role="tablist" aria-label="Álbuns">
          <button
            type="button"
            role="tab"
            aria-selected={activeAlbumId === 'all'}
            onClick={() => setActiveAlbumId('all')}
            className={`rounded-md px-4 py-2 text-xs font-medium transition-colors ${
              activeAlbumId === 'all'
                ? 'bg-terracota-escuro text-creme-claro'
                : 'border border-dourado/40 bg-creme-claro text-marrom hover:bg-pergaminho'
            }`}
          >
            Todos os álbuns
          </button>
          {albums.map((alb) => (
            <button
              key={alb.id}
              type="button"
              role="tab"
              aria-selected={activeAlbumId === alb.id}
              onClick={() => setActiveAlbumId(alb.id)}
              className={`rounded-md px-4 py-2 text-xs font-medium transition-colors ${
                activeAlbumId === alb.id
                  ? 'bg-terracota-escuro text-creme-claro'
                  : 'border border-dourado/40 bg-creme-claro text-marrom hover:bg-pergaminho'
              }`}
            >
              {alb.title}
            </button>
          ))}
        </div>

        <section className="mt-10">
          {approvedPhotos.length > 0 ? (
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {approvedPhotos.map((photo) => (
                <figure
                  key={photo.id}
                  className="overflow-hidden rounded-lg border border-dourado/35 bg-creme-claro shadow-sm"
                >
                  <ResilientImage
                    src={photo.imageUrl}
                    alt={photo.caption || 'Foto da galeria'}
                    className="aspect-[4/3] w-full object-cover"
                  />
                  <figcaption className="p-4 text-xs text-marrom-suave">
                    {photo.caption && (
                      <p className="font-display text-base text-marrom mb-1">{photo.caption}</p>
                    )}
                    <span>Enviada por {photo.uploadedBy}</span>
                  </figcaption>
                </figure>
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-dourado/35 bg-creme-claro p-10 text-center">
              <Camera className="mx-auto h-9 w-9 text-dourado mb-3" />
              <h2 className="font-display text-2xl font-semibold text-marrom">
                Álbum pronto para receber recordações
              </h2>
              <p className="mt-2 max-w-lg mx-auto text-sm text-marrom-suave">
                Ainda não há fotografias publicadas neste álbum. Os noivos podem adicionar fotos
                oficiais pelo painel, e os convidados podem enviar fotos do grande dia abaixo.
              </p>
            </div>
          )}
        </section>

        {collaborativeAlbums.length > 0 && (
          <>
            <BotanicalDivider className="my-8" />
            <section className="rounded-lg border border-dourado/40 bg-creme-claro p-6 sm:p-10 shadow-sm">
            <h2 className="font-display text-2xl sm:text-3xl font-semibold text-marrom">
              Enviar foto para o Álbum Colaborativo
            </h2>
            <p className="mt-1 text-sm text-marrom-suave">
              Tamanho máximo de 5 MB por imagem. Todas as fotos passam por moderação antes de
              aparecerem na galeria.
            </p>

            {uploadSuccess && (
              <div className="mt-4 rounded-md border border-salvia/40 bg-salvia/10 p-4 text-sm text-marrom">
                <p className="font-semibold flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-salvia" />
                  Foto enviada para moderação!
                </p>
                <p className="mt-1 text-xs text-marrom-suave">
                  Obrigado por compartilhar esse momento com Dalmo &amp; Jadi.
                </p>
              </div>
            )}

            <form onSubmit={handleUpload} className="mt-6 space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div>
                  <label htmlFor="photoUploader" className="block text-xs font-medium text-marrom">
                    Seu nome *
                  </label>
                  <input
                    id="photoUploader"
                    type="text"
                    required
                    maxLength={100}
                    value={uploaderName}
                    onChange={(e) => setUploaderName(e.target.value)}
                    placeholder="Seu nome"
                    className="mt-1 w-full rounded-md border border-dourado/40 bg-creme-claro px-3 py-2 text-sm text-marrom"
                  />
                </div>

                <div>
                  <label htmlFor="photoAlbum" className="block text-xs font-medium text-marrom">
                    Álbum
                  </label>
                  <select
                    id="photoAlbum"
                    value={targetAlbumId}
                    onChange={(e) => setTargetAlbumId(e.target.value)}
                    className="mt-1 w-full rounded-md border border-dourado/40 bg-creme-claro px-3 py-2 text-sm text-marrom"
                  >
                    {collaborativeAlbums.map((alb) => (
                      <option key={alb.id} value={alb.id}>
                        {alb.title}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="photoCaption" className="block text-xs font-medium text-marrom">
                    Legenda (opcional)
                  </label>
                  <input
                    id="photoCaption"
                    type="text"
                    maxLength={240}
                    value={caption}
                    onChange={(e) => setCaption(e.target.value)}
                    placeholder="Ex.: Saída dos noivos"
                    className="mt-1 w-full rounded-md border border-dourado/40 bg-creme-claro px-3 py-2 text-sm text-marrom"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="photoFile" className="block text-xs font-medium text-marrom">
                  Escolher fotografia (JPG, PNG ou WebP · máx. 5 MB) *
                </label>
                <input
                  id="photoFile"
                  type="file"
                  accept="image/*"
                  onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                  className="mt-1.5 block w-full text-xs text-marrom-suave file:mr-4 file:rounded-md file:border file:border-dourado/45 file:bg-pergaminho file:px-4 file:py-2 file:text-xs file:font-semibold file:text-marrom"
                />
              </div>

              <label className="flex items-start gap-2.5 text-xs text-marrom-suave cursor-pointer">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-dourado accent-terracota-escuro"
                />
                <span>
                  Autorizo o envio e exibição desta imagem no álbum do casamento após aprovação dos
                  noivos (LGPD).{' '}
                  <button
                    type="button"
                    onClick={() => setPrivacyModalOpen(true)}
                    className="font-semibold text-terracota-escuro underline"
                  >
                    Política de privacidade
                  </button>
                </span>
              </label>

              {uploadError && (
                <p role="alert" className="rounded-md bg-terracota/10 px-4 py-2.5 text-xs text-terracota-escuro">
                  {uploadError}
                </p>
              )}

              <button
                type="submit"
                disabled={uploading}
                className="inline-flex items-center gap-2 rounded-md bg-terracota-escuro px-6 py-3 text-xs font-semibold tracking-wider text-creme-claro uppercase hover:bg-terracota disabled:opacity-50 transition-colors"
              >
                <Upload className="h-4 w-4" />
                {uploading ? 'Enviando imagem...' : 'Enviar para moderação'}
              </button>
            </form>
          </section>
          </>
        )}
      </div>
    </div>
  );
};
