VERSÃO V14 — CORREÇÃO DO GERENCIADOR DE FOTOS

- Corrigidos os botões Excluir foto e Mover foto no painel da proprietária.
- Removida dependência de onclick inline; agora as ações usam eventos JavaScript externos, mais confiáveis no navegador/celular.
- Botões mostram MOVENDO/EXCLUINDO durante a operação.
- Exclusão remove a foto imediatamente do painel e atualiza o portfólio.
- Movimento salva a categoria escolhida e recarrega o painel.
- Ações de categorias também foram reforçadas.
- Cache do admin atualizado para v14.

IMPORTANTE: sem DATABASE_URL no Render, alterações em fotos/configurações usam arquivos locais e podem voltar após novo deploy/reinício. Para persistência real, configure PostgreSQL.
