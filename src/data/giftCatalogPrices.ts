import type { GiftCategory, GiftType } from '../types/wedding';

export interface CatalogPriceEntry {
  id: string;
  title: string;
  category: GiftCategory;
  priceCents: number;
  giftType: GiftType;
  totalQuotas: number;
}

export const OFFICIAL_GIFT_CATALOG_PRICES: CatalogPriceEntry[] = [
  { id: 'gift-01-jogo-de-panelas', title: 'Jogo de Panelas', category: 'Cozinha & Mesa', priceCents: 15000, giftType: 'quota', totalQuotas: 4 },
  { id: 'gift-02-panela-de-pressao', title: 'Panela de Pressão', category: 'Cozinha & Mesa', priceCents: 20000, giftType: 'full', totalQuotas: 1 },
  { id: 'gift-03-jogo-assadeiras-formas', title: 'Jogo de Assadeiras e Formas', category: 'Cozinha & Mesa', priceCents: 18000, giftType: 'full', totalQuotas: 1 },
  { id: 'gift-04-kit-utensilios-cozinha', title: 'Kit de Utensílios de Cozinha', category: 'Cozinha & Mesa', priceCents: 15000, giftType: 'full', totalQuotas: 1 },
  { id: 'gift-05-jogo-facas-tabua', title: 'Jogo de Facas e Tábua de Corte', category: 'Cozinha & Mesa', priceCents: 12500, giftType: 'quota', totalQuotas: 2 },
  { id: 'gift-06-faqueiro-completo', title: 'Faqueiro Completo', category: 'Cozinha & Mesa', priceCents: 17500, giftType: 'quota', totalQuotas: 2 },
  { id: 'gift-07-kit-escorredores', title: 'Kit de Escorredores', category: 'Cozinha & Mesa', priceCents: 13000, giftType: 'full', totalQuotas: 1 },
  { id: 'gift-08-chaleira-fervedor', title: 'Chaleira ou Fervedor', category: 'Cozinha & Mesa', priceCents: 10000, giftType: 'full', totalQuotas: 1 },
  { id: 'gift-09-kit-acessorios-essenciais', title: 'Kit de Acessórios Essenciais', category: 'Cozinha & Mesa', priceCents: 15000, giftType: 'full', totalQuotas: 1 },
  { id: 'gift-10-jogo-copos-jarra', title: 'Jogo de Copos e Jarra', category: 'Cozinha & Mesa', priceCents: 14000, giftType: 'full', totalQuotas: 1 },
  { id: 'gift-11-jogo-de-tacas', title: 'Jogo de Taças', category: 'Cozinha & Mesa', priceCents: 12000, giftType: 'quota', totalQuotas: 2 },
  { id: 'gift-12-jogo-de-xicaras', title: 'Jogo de Xícaras', category: 'Cozinha & Mesa', priceCents: 16000, giftType: 'full', totalQuotas: 1 },
  { id: 'gift-13-aparelho-de-jantar', title: 'Aparelho de Jantar', category: 'Cozinha & Mesa', priceCents: 15000, giftType: 'quota', totalQuotas: 3 },
  { id: 'gift-14-jogo-potes-hermeticos', title: 'Jogo de Potes Herméticos e Vasilhas de Vidro', category: 'Cozinha & Mesa', priceCents: 18000, giftType: 'full', totalQuotas: 1 },
  { id: 'gift-15-jogo-travessas-refratarias', title: 'Jogo de Travessas Refratárias', category: 'Cozinha & Mesa', priceCents: 20000, giftType: 'full', totalQuotas: 1 },
  { id: 'gift-16-kit-tigelas-petisqueira-saladeira', title: 'Kit de Tigelas, Petisqueira e Saladeira', category: 'Cozinha & Mesa', priceCents: 18000, giftType: 'full', totalQuotas: 1 },
  { id: 'gift-17-jogo-de-cama', title: 'Jogo de Cama Casal', category: 'Cama, Mesa & Banho', priceCents: 12000, giftType: 'quota', totalQuotas: 6 },
  { id: 'gift-18-jogo-americano', title: 'Jogo Americano', category: 'Cama, Mesa & Banho', priceCents: 10000, giftType: 'full', totalQuotas: 1 },
  { id: 'gift-19-edredom-mantas-colchas', title: 'Edredom, Mantas e Colchas', category: 'Cama, Mesa & Banho', priceCents: 18000, giftType: 'quota', totalQuotas: 2 },
  { id: 'gift-20-kit-protetores-cama', title: 'Kit de Protetores para Cama', category: 'Cama, Mesa & Banho', priceCents: 18000, giftType: 'full', totalQuotas: 1 },
  { id: 'gift-21-jogo-de-travesseiros', title: 'Jogo de Travesseiros', category: 'Cama, Mesa & Banho', priceCents: 20000, giftType: 'full', totalQuotas: 1 },
  { id: 'gift-22-kit-toalha-mesa-panos-prato', title: 'Kit de Toalha de Mesa e Panos de Prato', category: 'Cama, Mesa & Banho', priceCents: 13000, giftType: 'full', totalQuotas: 1 },
  { id: 'gift-23-jogo-toalhas-banho-rosto', title: 'Jogo de Toalhas de Banho e Rosto', category: 'Cama, Mesa & Banho', priceCents: 18000, giftType: 'quota', totalQuotas: 3 },
  { id: 'gift-24-kit-tapetes-banheiro', title: 'Kit de Tapetes de Banheiro', category: 'Cama, Mesa & Banho', priceCents: 14000, giftType: 'full', totalQuotas: 1 },
  { id: 'gift-25-kit-organizacao-quarto', title: 'Kit de Organização para o Quarto', category: 'Cama, Mesa & Banho', priceCents: 15000, giftType: 'full', totalQuotas: 1 },
  { id: 'gift-26-sanduicheira-grill', title: 'Sanduicheira ou Grill', category: 'Eletrodomésticos', priceCents: 12000, giftType: 'full', totalQuotas: 1 },
  { id: 'gift-27-churrasqueira-eletrica', title: 'Churrasqueira Elétrica', category: 'Eletrodomésticos', priceCents: 15000, giftType: 'quota', totalQuotas: 3 },
  { id: 'gift-28-aspirador-po-vertical', title: 'Aspirador de Pó Vertical', category: 'Eletrodomésticos', priceCents: 11000, giftType: 'quota', totalQuotas: 2 },
  { id: 'gift-29-air-fryer', title: 'Air Fryer', category: 'Eletrodomésticos', priceCents: 17500, giftType: 'quota', totalQuotas: 2 },
  { id: 'gift-30-liquidificador', title: 'Liquidificador', category: 'Eletrodomésticos', priceCents: 16000, giftType: 'full', totalQuotas: 1 },
  { id: 'gift-31-cafeteira-eletrica', title: 'Cafeteira Elétrica', category: 'Eletrodomésticos', priceCents: 15000, giftType: 'full', totalQuotas: 1 },
  { id: 'gift-32-micro-ondas', title: 'Micro-ondas', category: 'Eletrodomésticos', priceCents: 11000, giftType: 'quota', totalQuotas: 5 },
  { id: 'gift-33-multiprocessador-alimentos', title: 'Multiprocessador de Alimentos', category: 'Eletrodomésticos', priceCents: 15000, giftType: 'quota', totalQuotas: 2 },
  { id: 'gift-34-ferro-passar-vaporizador', title: 'Ferro de Passar ou Vaporizador', category: 'Eletrodomésticos', priceCents: 18000, giftType: 'full', totalQuotas: 1 },
  { id: 'gift-35-purificador-filtro-agua', title: 'Purificador ou Filtro de Água', category: 'Eletrodomésticos', priceCents: 15000, giftType: 'quota', totalQuotas: 4 },
  { id: 'gift-36-velas-aromaticas-difusores', title: 'Velas Aromáticas e Difusores', category: 'Decoração & Conforto', priceCents: 12000, giftType: 'full', totalQuotas: 1 },
  { id: 'gift-37-quadros-porta-retratos', title: 'Quadros Decorativos e Porta-Retratos', category: 'Decoração & Conforto', priceCents: 18000, giftType: 'full', totalQuotas: 1 },
  { id: 'gift-38-luminaria-ou-abajur', title: 'Luminária ou Abajur', category: 'Decoração & Conforto', priceCents: 20000, giftType: 'full', totalQuotas: 1 },
  { id: 'gift-39-cuscuzeira', title: 'Cuscuzeira', category: 'Cozinha & Mesa', priceCents: 15000, giftType: 'full', totalQuotas: 1 },
  { id: 'gift-40-boleira', title: 'Boleira', category: 'Cozinha & Mesa', priceCents: 12000, giftType: 'full', totalQuotas: 1 },
  { id: 'gift-41-fruteira', title: 'Fruteira', category: 'Cozinha & Mesa', priceCents: 8000, giftType: 'full', totalQuotas: 1 },
  { id: 'gift-42-geladeira', title: 'Geladeira', category: 'Eletrodomésticos', priceCents: 30000, giftType: 'quota', totalQuotas: 12 },
  { id: 'gift-43-fogao', title: 'Fogão', category: 'Eletrodomésticos', priceCents: 20000, giftType: 'quota', totalQuotas: 10 },
  { id: 'gift-44-batedeira', title: 'Batedeira', category: 'Eletrodomésticos', priceCents: 14000, giftType: 'quota', totalQuotas: 4 },
  { id: 'gift-45-ventilador', title: 'Ventilador', category: 'Eletrodomésticos', priceCents: 18000, giftType: 'full', totalQuotas: 1 },
  { id: 'gift-46-tapete-para-quarto', title: 'Tapete para Quarto', category: 'Decoração & Conforto', priceCents: 15000, giftType: 'quota', totalQuotas: 2 },
  { id: 'gift-47-cortinas', title: 'Cortinas', category: 'Decoração & Conforto', priceCents: 18000, giftType: 'quota', totalQuotas: 2 },
  { id: 'gift-48-estante', title: 'Estante', category: 'Decoração & Conforto', priceCents: 15000, giftType: 'quota', totalQuotas: 3 },
  { id: 'gift-49-lua-de-mel-ilhabela', title: 'Nossa Lua de Mel em Ilhabela', category: 'Lua de mel', priceCents: 15000, giftType: 'symbolic', totalQuotas: 200 },
];

export const OFFICIAL_GIFT_CATALOG_MAP = new Map<string, CatalogPriceEntry>(
  OFFICIAL_GIFT_CATALOG_PRICES.map((entry) => [entry.id, entry])
);
