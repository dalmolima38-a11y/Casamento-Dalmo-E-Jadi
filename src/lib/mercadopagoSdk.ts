export interface MercadoPagoBrickController {
  unmount: () => Promise<void> | void;
  update?: (settings: { amount?: number }) => void;
}

export interface MercadoPagoCardBrickFormData {
  token: string;
  issuer_id?: string | number;
  payment_method_id: string;
  transaction_amount: number;
  installments: number;
  payer?: {
    email?: string;
    identification?: {
      type?: string;
      number?: string;
    };
  };
}

interface MercadoPagoSdkInstance {
  bricks: () => {
    create: (
      brickType: 'cardPayment',
      containerId: string,
      settings: {
        initialization: {
          amount: number;
          payer?: {
            email?: string;
          };
        };
        customization?: {
          visual?: {
            style?: {
              theme?: 'default' | 'dark' | 'bootstrap' | 'flat';
              customVariables?: Record<string, string>;
            };
            texts?: {
              formTitle?: string;
              emailSectionTitle?: string;
              installmentsSectionTitle?: string;
              cardholderName?: { label?: string; placeholder?: string };
              cardholderIdentification?: { label?: string };
              formSubmit?: string;
            };
          };
          paymentMethods?: {
            minInstallments?: number;
            maxInstallments?: number;
          };
        };
        callbacks: {
          onReady?: () => void;
          onSubmit?: (formData: MercadoPagoCardBrickFormData) => Promise<void>;
          onError?: (error: unknown) => void;
        };
      }
    ) => Promise<MercadoPagoBrickController>;
  };
}

declare global {
  interface Window {
    MercadoPago?: new (
      publicKey: string,
      options?: { locale?: string }
    ) => MercadoPagoSdkInstance;
  }
}

const MP_SDK_URL = 'https://sdk.mercadopago.com/js/v2';
let sdkLoadPromise: Promise<void> | null = null;

export function loadMercadoPagoSdk(): Promise<void> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('SDK do Mercado Pago disponível apenas no navegador.'));
  }
  if (window.MercadoPago) {
    return Promise.resolve();
  }
  if (sdkLoadPromise) {
    return sdkLoadPromise;
  }

  sdkLoadPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${MP_SDK_URL}"]`);
    if (existing) {
      if (window.MercadoPago) {
        resolve();
        return;
      }
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener(
        'error',
        () => {
          sdkLoadPromise = null;
          reject(new Error('Não foi possível carregar o SDK oficial do Mercado Pago.'));
        },
        { once: true }
      );
      return;
    }

    const script = document.createElement('script');
    script.src = MP_SDK_URL;
    script.async = true;
    script.defer = true;
    script.onload = () => {
      if (window.MercadoPago) {
        resolve();
      } else {
        sdkLoadPromise = null;
        reject(new Error('O SDK do Mercado Pago foi carregado sem inicializar window.MercadoPago.'));
      }
    };
    script.onerror = () => {
      sdkLoadPromise = null;
      reject(new Error('Falha ao carregar o SDK oficial do Mercado Pago.'));
    };
    document.head.appendChild(script);
  });

  return sdkLoadPromise;
}
