# Óriva — Plataforma de Gestão

Código-fonte completo da plataforma Óriva para gestão de agência, empresas,
clientes, colaboradores e parceiros.

## Funcionalidades incluídas

- autenticação e perfis de acesso;
- empresas, clientes e leads;
- tarefas, agenda e calendário por empresa;
- calendário de posts e aprovação de conteúdos;
- uploads e downloads de arquivos originais;
- parceiros, contratos e financeiro;
- relatórios operacionais;
- chat entre agência, clientes e colaboradores;
- backup e restauração segura;
- políticas de segurança por empresa no Supabase.

## Estrutura principal

- `app/`: páginas e APIs do sistema;
- `public/`: interface, estilos e scripts da plataforma;
- `lib/`: integração segura com Supabase e Storage;
- `supabase/schema.sql`: estrutura completa para uma instalação nova;
- `supabase/migrations/`: alterações incrementais do banco;
- `supabase/functions/`: funções administrativas executadas no backend;
- `tests/`: testes de funcionalidades, permissões e botões.

## Requisitos

- Node.js `22.13.0` ou superior;
- um projeto Supabase com Auth, PostgreSQL e Storage;
- variáveis de ambiente configuradas na hospedagem.

## Instalação local

1. Instale as dependências:

   ```bash
   npm ci
   ```

2. Copie `.env.example` para `.env.local` e preencha somente com os dados do
   seu próprio projeto Supabase.

3. Inicie o projeto:

   ```bash
   npm run dev
   ```

4. Execute os testes antes de publicar:

   ```bash
   npm test
   ```

## Banco de dados

O arquivo `supabase/schema.sql` representa a instalação completa. Antes de
usá-lo em um projeto Supabase novo, substitua o e-mail de exemplo em
`private.platform_settings` pelo e-mail autorizado do proprietário.

As migrations em `supabase/migrations/` preservam o histórico das mudanças
posteriores. As funções em `supabase/functions/` devem ser publicadas no mesmo
projeto Supabase e manter a chave administrativa somente nos segredos seguros
do ambiente.

## Segurança

- Não envie `.env`, senhas, tokens ou chaves administrativas ao GitHub.
- Nunca exponha `SUPABASE_SERVICE_ROLE_KEY` no navegador.
- O repositório contém código e estrutura do banco, não uma cópia dos usuários,
  mensagens ou arquivos do sistema em produção.
- Os dados atuais continuam armazenados no Supabase e devem ser protegidos pelo
  recurso de backup da própria plataforma.

## Observação sobre esta exportação

Esta cópia foi preparada sem `node_modules`, arquivos de build, caches, histórico
local do Git e credenciais. Ela pode ser enviada diretamente para um repositório
privado e instalada novamente a partir do `package-lock.json`.
