# Lash Studio RB — V17 DATABASE PRODUCTION

Versão preparada para produção com PostgreSQL persistente.

## O que mudou
- PostgreSQL relacional para agendamentos, procedimentos, horários semanais, horários por data, bloqueios, categorias e fotos.
- Migração automática dos dados antigos da tabela `lsh_state` ou dos JSON locais quando o banco estiver vazio.
- Em produção, se o PostgreSQL não estiver conectado, o painel NÃO finge que salvou: alterações retornam erro e nada é gravado em arquivo temporário.
- Removido do painel o aviso visual sobre database/JSON.
- Corrigido falso “horário salvo” quando a gravação falhava.
- Tratamento melhor de erros assíncronos.
- Upload de foto com limite maior e até 100 fotos.
- Cache do painel atualizado para V17.
- SMTP mantido, com mensagem de diagnóstico compatível com a porta configurada.

## Render
Variável obrigatória para persistência:
`DATABASE_URL=<Internal Database URL do PostgreSQL do Render>`

Também mantenha:
- NODE_ENV=production
- SESSION_SECRET
- ADMIN_USER
- ADMIN_PASSWORD
- OWNER_EMAIL
- OWNER_WHATSAPP
- SMTP_HOST
- SMTP_PORT
- SMTP_SECURE
- SMTP_SERVICE
- SMTP_USER
- SMTP_PASS
- SMTP_FROM

## Banco
O arquivo `database.sql` está na raiz. O `server.js` cria as tabelas automaticamente ao iniciar.
Não é necessário executar o SQL manualmente se `DATABASE_URL` estiver correta.

## Deploy
Build: `npm install`
Start: `npm start`

Depois do deploy, confira os Logs. Deve aparecer:
`[DATABASE] PostgreSQL conectado e pronto.`

## Segurança
Nunca envie `.env`, SMTP_PASS, ADMIN_PASSWORD ou DATABASE_URL para GitHub público.
