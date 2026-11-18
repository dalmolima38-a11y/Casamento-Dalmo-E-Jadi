import React, { useState } from 'react';
import { Camera } from 'lucide-react';
import { Link } from 'react-router-dom';

interface ChurchFacadeShowcaseProps {
  customPhotoUrl?: string;
  showAdminHint?: boolean;
}

export const ChurchFacadeShowcase: React.FC<ChurchFacadeShowcaseProps> = ({
  customPhotoUrl,
  showAdminHint = false,
}) => {
  const custom = customPhotoUrl?.trim();
  const candidateSrc =
    custom && !custom.includes('/assets/aistudio/')
      ? custom
      : '/images/igreja-jardim-florestal.png';
  const [imageError, setImageError] = useState(false);

  return (
    <div className="relative mx-auto w-full max-w-lg lg:max-w-none">
      {!imageError && candidateSrc ? (
        <div className="overflow-hidden rounded-xl border border-dourado/75 bg-marfim shadow-[0_14px_34px_-16px_rgba(111,88,75,0.2)]">
          <img
            src={candidateSrc}
            alt="Fachada da Igreja Adventista do Sétimo Dia — Jardim Florestal, Rio Pardo de Minas - MG"
            onError={() => setImageError(true)}
            className="block aspect-square h-auto w-full object-contain"
          />
        </div>
      ) : (
        <div className="relative flex aspect-square w-full flex-col items-center justify-center rounded-xl border border-dourado/75 bg-marfim p-6 text-center shadow-sm">
          <Camera className="h-8 w-8 text-dourado" aria-hidden="true" />
          <p className="mt-2 font-display text-lg font-semibold text-marrom">
            Igreja Adventista do Sétimo Dia — Jardim Florestal
          </p>
          {showAdminHint && (
            <Link
              to="/admin"
              className="mt-2 text-xs font-medium text-terracota-escuro hover:underline"
            >
              Configurar fotografia no painel
            </Link>
          )}
        </div>
      )}
    </div>
  );
};
