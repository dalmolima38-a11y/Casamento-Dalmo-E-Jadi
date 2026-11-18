# Nosso Para Sempre | Dalmo & Jadi

Site oficial de casamento para **Dalmo & Jadi** (Domingo, 10 de janeiro de 2027, às 15:00 h · Igreja Adventista do Sétimo Dia — Jardim Florestal, Rio Pardo de Minas - MG).

## Arquitetura & Segurança
- **Frontend**: React 19, TypeScript, Vite, Tailwind CSS v4, Motion (`prefers-reduced-motion`).
- **Backend / Webhooks**: Express (`server.ts`) com proteção por rate limit e validação HMAC-SHA256 / Bearer para webhooks Pix (`/api/webhooks/pix`).
- **Firebase**:
  - **Authentication**: Login Google exclusivo para os noivos/administradores.
  - **Firestore**: Persistência em tempo real com regras Zero-Trust (`firestore.rules`) isolando dados privados (`rsvps`, `gift_orders`, `rsvp_revisions`, `admin_logs`) e exigindo moderação prévia para recados e fotos públicas.
  - **Storage**: Regras dedicadas (`storage.rules`) para comprovantes privados (`/receipts`) e fotos do álbum colaborativo (`/gallery`).

## Configuração Inicial
1. **Acesso Administrativo**: Faça login com Google em `/admin` usando o e-mail `dalmofilho38@gmail.com`. Ao entrar pela primeira vez, clique em **"Inicializar dados no Firestore"** para gravar as configurações padrão e os exemplos editáveis.
2. **Dados Reais (Pix, Endereço e Prazos)**:
   - No painel `/admin` > **Configurações & Admins**, cadastre a chave Pix real do casal, favorecido, endereço de rua/coordenadas da cerimônia e prazo do RSVP.
   - Sem chave Pix cadastrada, o site opera em **Modo Demonstração** explícito e nunca simula pagamentos confirmados.
3. **Webhook de Pagamento (Opcional)**:
   - Configure `PIX_WEBHOOK_SECRET` e `FIREBASE_SERVICE_ACCOUNT_JSON` nas variáveis de ambiente do servidor (nunca no navegador).
   - Aponte seu provedor Pix para `POST /api/webhooks/pix`.
4. **Firebase Storage Rules**:
   - Caso utilize o envio de arquivos no Storage, publique também `storage.rules` via Firebase CLI (`firebase deploy --only storage`).
5. **Domínio Curto**:
   - Configure o redirecionamento externo em `https://bit.ly/nossoparasempre` apontando para a URL pública publicada deste aplicativo.
