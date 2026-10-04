# Fonte central da homologação

`Code.gs` é o backend do Conecta Control: um Apps Script publicado como app da
web, gravando numa planilha Google. Ele substitui a gravação antiga, que ficava
no navegador de cada pessoa e mandava o histórico sem nenhuma credencial.

O que muda:

- **Fonte única.** O estado de cada uma das 54 atividades vem da aba
  `homologacoes`. Uma marcação é uma linha nova, com usuário, nome, atividade,
  ação (`concluida` ou `reaberta`) e a data do servidor. Nada é apagado: reabrir
  também é uma linha.
- **Quem marcou.** Toda chamada exige usuário e token. O token é pessoal; na
  planilha fica só o hash SHA-256. Cada acesso é *homologa* ou *somente leitura*.
- **Progresso calculado no servidor**, com os pesos do Anexo III (`PESOS` em
  `Code.gs`). O Control avisa se os pesos da página divergirem dos do servidor.
- **Sem URL no código.** O endereço do app da web é entregue a cada pessoa junto
  com o token e digitado na tela de login do Control.

## Implantar (uma vez, por quem é dono da planilha)

1. Abra a planilha do histórico e vá em **Extensões → Apps Script**.
2. Guarde uma cópia do código atual fora do projeto. Depois troque o conteúdo de
   `Code.gs` pelo deste arquivo e salve.
3. Opcional: em **Configurações do projeto → Propriedades do script**, crie
   `ABA_HISTORICO_ANTIGO` com o nome da aba do histórico atual. Os pontos antigos
   continuam aparecendo na linha do tempo, marcados como "registro anterior, sem
   identificação".
4. Recarregue a planilha. Vai aparecer o menu **Conecta Control**. Na primeira vez
   o Google pede autorização.
5. **Conecta Control → Gerar ou renovar token de acesso**, uma vez para cada
   pessoa. O token aparece uma única vez; copie e entregue só para ela, por canal
   privado. Gerar de novo para o mesmo usuário invalida o token anterior.
6. **Implantar → Nova implantação → App da Web**:
   - Executar como: **Eu**
   - Quem pode acessar: **Qualquer pessoa** (a credencial é o token)

   Copie a URL que termina em `/exec`. Ela vai para as pessoas junto com o token,
   **não** para o repositório.
7. **Implantar → Gerenciar implantações → arquive as implantações antigas.** As
   URLs antigas estão no histórico do repositório público e aceitam gravação sem
   credencial; enquanto existirem, qualquer pessoa com o link grava pontos falsos.
   Havia duas: uma no `index.html` e outra no `roadmap-conecta-market.html`.
8. Proteja a aba `homologacoes` (**Dados → Proteger páginas e intervalos →** só
   você edita). O script grava como você, então continua funcionando; o
   histórico de versões do Sheets registra qualquer edição manual.

## Acessos

Sugestão: quem aceita o contrato (proprietário e, se for o caso, o PM) com
*homologa*; os desenvolvedores com *somente leitura*. Use **Revogar acesso** para
quem sair do projeto e **Listar acessos** para conferir.

## API

Todas as chamadas são `POST` com corpo JSON enviado como `text/plain`, que não
dispara o preflight de CORS. `GET` não devolve dados.

| `action` | Campos extras | Resposta |
|---|---|---|
| `whoami` | — | `user` (`id`, `name`, `canMark`) |
| `state` | — | `state` por ID, `progress`, `completed`, `history`, `legacy` |
| `mark` | `activityId`, `done` (booleano), `note` opcional | o mesmo de `state`; `unchanged: true` quando nada mudou |

Erros voltam com `ok: false` e `error`; `code: "auth"` quando o usuário ou o token
não confere, `code: "forbidden"` para acesso somente leitura.

Se os pesos do Anexo III mudarem, atualize `PESOS` aqui e a tabela do
`index.html` juntos.

## Limites

- O token fica no navegador: na aba (`sessionStorage`) ou, com "Lembrar acesso",
  no `localStorage`. Use "Sair" em computador compartilhado.
- O `index.html` continua público e estático. O login protege a homologação e o
  progresso, não o texto do roadmap.
