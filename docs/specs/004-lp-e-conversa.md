# Spec 004: landing page e tela de conversa estilo mensageiro

**Status:** aprovada pelo responsável em 04/11/2026.
**Pedido:** "vamo fazer uma página web que simule o whats para ficar mais coerente, com um botão na LP de entrar em contato que leva para essa página". Sobre a LP: "LP Mínima, inspirada na LP Centraleng que temos no github e local."

## Problema

A demo abre direto num chat de teste. O lead real chega por uma landing page e conversa num aplicativo de mensagens, então a demo não mostra esse caminho.

## Comportamento

- `/` passa a servir a landing page. A conversa passa para `/conversa`.
- A LP tem marca, título, apoio, cinco serviços, telefones e o botão "Entrar em contato", que leva a `/conversa`. O botão aparece no topo da página e no fim.
- A conversa usa a aparência de um aplicativo de mensagens, em tons verdes: cabeçalho com avatar e "Atendimento CentralEng", fundo de conversa, balões do lead à direita e do agente à esquerda, hora em cada balão, indicador de digitando e barra de envio fixa no rodapé.
- Continua igual: `/api/chat`, `/tela.json`, aviso LGPD como primeira mensagem, limite de 2000 caracteres, painel em `?painel=1`, "Nova conversa" ao encerrar.
- Silêncio segue sem balão de erro. Em `aguardando_humano` o lead não recebe texto fixo.
- R11 não muda: o agente nunca nega ser IA.

## Conteúdo e marca

Base em `lp_centraleng`, reescrita em HTML simples, sem copiar componentes do site:

- Cores da LP: `#254777`, `#202249`, `#0f6fac`, `#f3f5f8`, `#515a6e`, `#171b24`, `#ffffff`, em tokens CSS. A conversa usa tokens próprios em verde.
- Logo: `centraleng-logo-mono.svg`, copiado de `lp_centraleng`, monocromático e sem redesenho.
- Fontes: Barlow Semi Condensed nos títulos e Mukta no texto.
- Texto: "Engenharia aplicada a grandes projetos." e "Projeto, instalação e manutenção de climatização há 25 anos, no RS e em SC."
- Serviços: sistema de climatização, monitoramento e manutenção, engenharia especializada, soluções integradas, elaboração e execução do PMOC.
- Telefones: Santa Maria (55) 3307-7010 e Florianópolis (48) 3364-9840.

Sem fotos, porque as da LP são marcadas como exemplo e não têm licença registrada. A tela não usa nome, logo nem ícone do WhatsApp, e o logo da CentralEng vale só na LP e no cabeçalho da conversa.

## Critérios

- C1: Dado `GET /`, então vem a LP, com link para `/conversa`.
- C2: Dado `GET /conversa`, então vem a tela de conversa, e uma mensagem real recebe resposta.
- C3: Dado clique em "Entrar em contato", então a conversa abre com o aviso LGPD.
- C4: Dado o n8n parado, então não aparece balão de erro e o campo volta a aceitar texto.
- C5: Dado largura de 360 px, então não há rolagem lateral em nenhuma das duas páginas, e a barra de envio fica visível.
- C6: Dado `?painel=1` em `/conversa`, então o painel aparece como hoje.

## Testes de aceite

| Teste | Entrada | Resultado |
|---|---|---|
| T1 | `GET /` com LP configurada | 200, `text/html`, contém `href="/conversa"` |
| T2 | `GET /conversa` com chat configurado | 200, `text/html` |
| T3 | `GET /` sem LP configurada | 404 |
| T4 | `GET /conversa` sem chat configurado | 404 |
| T5 | Arquivo `chat/index.html` | não contém "WhatsApp", contém `aviso_lgpd` |
| T6 | Compose no ar, navegador em 1280 e 360 px | screenshot das duas páginas, sem rolagem lateral |
| T7 | Compose no ar, n8n parado | sem balão de erro, campo livre |

## Fora do escopo

Mudar falas e modo de interação do agente, que é a issue #11. WhatsApp real. Formulário de contato na LP. Inglês e espanhol.

## Perguntas abertas

Nenhuma.
