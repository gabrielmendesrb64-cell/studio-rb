# Lash Studio RB — V15 Production Ready

Versão revisada para começar a usar com clientes.

## Correções principais
- Horários semanais: o botão **+ Horário** agora salva imediatamente no servidor; não depende de um segundo botão.
- Calendário grande no painel: clique em qualquer dia e libere horários específicos daquela data.
- Horários específicos por data substituem o padrão semanal apenas naquele dia.
- Procedimentos: novo procedimento só é salvo como ativo quando nome, valor e duração são válidos. Após salvar, já fica disponível para seleção no site.
- Teste de e-mail: verifica a conexão SMTP antes do envio e mostra mensagens mais claras para senha de app/login/porta.
- Painel admin redesenhado em rosa/branco, no mesmo padrão visual da área das clientes.
- Galeria: mover/excluir fotos e categorias com o novo JS do painel, evitando cache antigo.
- Cache/PWA antigo é removido para evitar o navegador carregar scripts velhos.
- Backup manual: botão **Baixar backup** exporta agenda, configurações, procedimentos e fotos.
- Aviso de produção no painel mostra claramente se o armazenamento está em PostgreSQL ou JSON temporário.

## IMPORTANTE antes de usar com clientes
No Render, configure `DATABASE_URL` com PostgreSQL. Sem PostgreSQL o Render pode perder alterações feitas em JSON após reinício ou novo deploy.

O e-mail automático usa `SMTP_USER`, `SMTP_PASS`, `OWNER_EMAIL` e demais variáveis do `.env.example` configuradas no Render.

WhatsApp automático exige Meta WhatsApp Cloud API. Sem ela, o botão manual de WhatsApp continua disponível no painel.

## Deploy
Suba o conteúdo desta pasta no mesmo repositório GitHub e faça novo deploy no Render.
Não envie `.env` nem `node_modules`.
