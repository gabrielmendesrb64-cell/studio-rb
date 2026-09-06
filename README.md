# LSH Studio RB — V8 Completo

Atualização completa do site e painel da proprietária.

## O que mudou

- Agendamento com 1 ou vários procedimentos.
- Total dos procedimentos calculado antes de enviar.
- Duração total calculada para evitar conflito com outro atendimento.
- E-mail da cliente obrigatório para permitir confirmação automática por e-mail.
- Área "Meus agendamentos" por WhatsApp ou nome completo.
- Cliente pode desmarcar agendamento Pendente/Confirmado sem limite de antecedência.
- Painel da proprietária para cadastrar procedimentos, valores, duração e ativar/desativar.
- Painel da proprietária para escolher os dias da semana e adicionar/remover cada horário manualmente.
- Horários padrão removidos: a agenda só abre depois que a proprietária liberar horários.
- E-mail para a proprietária em novo agendamento.
- Ao confirmar no painel, o sistema tenta enviar e-mail automático para a cliente.
- Botão de WhatsApp no painel já monta a mensagem de confirmação.
- Suporte opcional a envio automático por WhatsApp Cloud API da Meta.
- Botão "Testar e-mail" no painel.
- Painel mostra se e-mail, WhatsApp automático e banco persistente estão configurados.
- Melhorias fortes para celular em agendamento, área da cliente e painel.
- Sessão admin usa MemoryStore com expiração automática, removendo o alerta antigo do express-session.
- Suporte opcional a PostgreSQL pelo DATABASE_URL. Sem banco, usa JSON como fallback.
- Endereço atualizado: Rua Tereza de Oliveira Prado, 145 — Dom Pedro II.

## Depois de publicar

1. Entre em `/admin.html`.
2. Vá em "Procedimentos" e coloque os valores reais. Procedimentos sem preço ficam indisponíveis para a cliente.
3. Vá em "Dias e horários", adicione os horários desejados para cada dia e salve.
4. Em "Status do sistema", clique em "Testar e-mail".

## Variáveis no Render

Obrigatórias/recomendadas:

- `NODE_ENV=production`
- `SESSION_SECRET` = uma chave grande e aleatória
- `ADMIN_USER`
- `ADMIN_PASSWORD`
- `OWNER_WHATSAPP`
- `OWNER_EMAIL`

Para e-mail Gmail:

- `SMTP_SERVICE=gmail`
- `SMTP_HOST=smtp.gmail.com`
- `SMTP_PORT=587`
- `SMTP_SECURE=false`
- `SMTP_USER=seuemail@gmail.com`
- `SMTP_PASS=SENHA_DE_APP_DO_GMAIL`
- `SMTP_FROM=LSH Studio RB <seuemail@gmail.com>`

Atenção: `SMTP_PASS` precisa ser uma Senha de App do Google quando a conta usa autenticação em duas etapas. Não use a senha normal do Gmail.

## Banco persistente no Render

Para uso real, configure `DATABASE_URL` de um PostgreSQL. Com isso, agendamentos, procedimentos e horários não dependem do disco temporário do serviço web.

Sem `DATABASE_URL`, o site continua funcionando, porém usa os arquivos `data/*.json` como fallback.

## WhatsApp automático

O botão de WhatsApp no painel funciona sem configuração extra e abre a confirmação pronta para envio.

Para envio 100% automático, configure uma conta Meta WhatsApp Cloud API e as variáveis:

- `WHATSAPP_CLOUD_TOKEN`
- `WHATSAPP_PHONE_NUMBER_ID`
- `WHATSAPP_TEMPLATE_NAME` (recomendado para mensagens iniciadas pela empresa)
- `WHATSAPP_TEMPLATE_LANGUAGE=pt_BR`

## Render

- Build Command: `npm install`
- Start Command: `npm start`
- Root Directory: vazio, se `package.json` estiver na raiz do repositório.
