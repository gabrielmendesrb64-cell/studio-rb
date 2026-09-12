# Studio RB — V18 Catálogo + PIX

Versão redesenhada com base no catálogo enviado pela cliente.

## Principais mudanças
- Visual preto, rosa/pink e branco, inspirado no PDF da Studio RB.
- Catálogo de procedimentos com os valores do material de referência.
- Fluxo de reserva com sinal PIX (padrão R$ 20,00).
- Cliente pode enviar comprovante pelo próprio site ou seguir para o WhatsApp.
- Agendamento fica como **Comprovante enviado** até aprovação da Emilly.
- Painel admin possui **Aprovar / Confirmar**, **Recusar PIX** e **Ver comprovante**.
- Chave PIX, valor do sinal, recebedor, cidade e instruções são configuráveis no painel.
- Uploads de fotos do celular agora usam multipart e otimização no servidor com Sharp. O servidor aceita imagem de até 20 MB e reduz automaticamente para WebP.
- Fotos de portfólio também são otimizadas automaticamente no servidor.
- PostgreSQL/Supabase continua sendo a fonte persistente dos dados.

## Banco
Ao iniciar, `database.sql` cria/atualiza as tabelas. A V18 adiciona:
- campos de status PIX no agendamento;
- tabela `lsh_payment_proofs` para os comprovantes.

## Render
Build command: `npm install`
Start command: `npm start`

Variável obrigatória:
`DATABASE_URL=<Session Pooler do Supabase>`

Mantenha também as variáveis de admin, e-mail e WhatsApp já configuradas.

## Primeiro acesso após deploy
1. Abra o painel `/admin.html`.
2. Vá em **PIX & Sinal**.
3. Coloque a chave PIX correta e confirme o valor do sinal.
4. Confira os procedimentos/valores.
5. Libere os horários.
6. Faça um agendamento de teste e envie um comprovante de teste.
7. No painel, abra o comprovante e aprove.

## Segurança
Nunca envie `DATABASE_URL`, `SMTP_PASS`, senha de admin ou outras credenciais ao GitHub público.
