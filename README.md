# LSH Studio RB — V9 Mobile Pro

Atualização focada primeiro em celular (iPhone/Android), mantendo desktop e tablet.

## Principais mudanças
- Layout mobile refeito: hero, foto da Emilly, serviços, resultados, agendamento, área da cliente, contato e navegação inferior.
- Textos do portfólio não ficam mais por cima das fotos no celular.
- Galeria/portfólio gerenciada pela proprietária no painel: adicionar e excluir fotos.
- As fotos enviadas pelo painel são reduzidas e comprimidas no navegador antes do envio.
- Confirmação do agendamento tenta enviar e-mail e WhatsApp automático quando os respectivos provedores estão configurados.
- Botão "Reenviar confirmação" no painel para testar/repetir a notificação de uma cliente confirmada.
- Novo agendamento também tenta avisar a proprietária por e-mail e WhatsApp automático.
- Cancelamento feito pela cliente exige confirmar o WhatsApp usado no agendamento.
- Login com limitação de tentativas, comparação segura da senha, sessão HTTP-only, SameSite, HTTPS em produção, política CSP, Helmet, bloqueio de origem em ações do painel e rate limits.
- PostgreSQL continua recomendado para persistir agenda, configurações e fotos no Render.

## Render — variáveis obrigatórias/recomendadas

### Segurança/admin
- `NODE_ENV=production`
- `SESSION_SECRET=` uma chave longa e aleatória
- `ADMIN_USER=` usuário do painel
- `ADMIN_PASSWORD=` senha forte e exclusiva

### Proprietária
- `OWNER_EMAIL=` e-mail real da Emilly/proprietária
- `OWNER_WHATSAPP=` número no formato internacional, somente números, ex.: `5512999999999`

### E-mail automático (Gmail)
- `SMTP_SERVICE=gmail`
- `SMTP_HOST=smtp.gmail.com`
- `SMTP_PORT=587`
- `SMTP_SECURE=false`
- `SMTP_USER=` seu Gmail
- `SMTP_PASS=` SENHA DE APP do Google (não é a senha normal)
- `SMTP_FROM=LSH Studio RB <seuemail@gmail.com>`

Depois do deploy, entre no painel e use **Status do sistema → Testar e-mail**.

### WhatsApp automático
O site não consegue enviar WhatsApp automático só com um número comum. É necessário configurar a **Meta WhatsApp Cloud API**:
- `WHATSAPP_CLOUD_TOKEN=`
- `WHATSAPP_PHONE_NUMBER_ID=`
- `WHATSAPP_API_VERSION=v23.0`
- `WHATSAPP_TEMPLATE_NAME=` template aprovado pela Meta, quando necessário
- `WHATSAPP_TEMPLATE_LANGUAGE=pt_BR`

Sem a Cloud API, o botão manual do WhatsApp no painel continua funcionando, mas não existe envio automático pelo WhatsApp.

### Banco de dados
- `DATABASE_URL=` URL do PostgreSQL.

**Muito importante:** no Render, use PostgreSQL antes de depender da agenda/fotos em produção. Sem `DATABASE_URL`, o fallback é JSON local e alterações podem ser perdidas após reinícios/deploys.

## Atualização no GitHub
Suba/substitua:
- `public/`
- `data/`
- `server.js`
- `package.json`
- `.env.example`
- `.gitignore`
- `README.md`

Não envie `.env` nem `node_modules`.

Build no Render: `npm install`
Start no Render: `npm start`

## Segurança
Nenhum site conectado à internet pode ser prometido como “impossível de hackear”. Esta versão aplica proteções importantes para um projeto desse porte, mas produção de verdade também depende de senha forte, segredos apenas no Render, PostgreSQL, atualizações de dependências, HTTPS e contas de e-mail/Meta protegidas com 2FA.
