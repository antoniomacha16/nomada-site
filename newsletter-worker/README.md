# Newsletter NÓMADA — endpoint de produção

Estado atual: **não é preciso fazer nada disto para a newsletter funcionar.** O site já está a
subscrever pessoas através da Storefront API (`mode: 'storefront'`).

Segue estes passos quando quiseres a versão à prova de futuro. O motivo está no fim.

---

## 1. Criar a app no Shopify Admin

1. Shopify Admin → **Definições** (canto inferior esquerdo) → **Aplicações e canais de vendas**
2. **Desenvolver aplicações** → **Criar uma aplicação**
3. Nome: `NOMADA Newsletter`. Criar.
4. Separador **Configuração** → **Admin API integration** → **Configurar**
5. Marca **apenas** estes dois scopes:
   - `write_customers`
   - `read_customers`
6. **Guardar**
7. Separador **Chaves de API** → **Instalar aplicação**
8. Em **Admin API access token**, clica **Revelar token uma vez** e copia o valor.

O valor começa por `shpat_`. **Só é mostrado uma vez.** Se o perderes, gera outro.

> Este token dá acesso total aos teus clientes. Nunca o metas no HTML, no JavaScript, num
> print, ou num chat. Ele vive só no passo 2.

## 2. Deploy do Worker

Precisas de Node instalado. Numa conta Cloudflare gratuita:

```bash
cd newsletter-worker
npx wrangler login
npx wrangler secret put SHOPIFY_ADMIN_TOKEN   # cola aqui o shpat_... e Enter
npx wrangler deploy
```

No fim, o comando imprime o URL, algo como:
`https://nomada-newsletter.<o-teu-subdominio>.workers.dev`

Copia esse URL.

Custo: o plano gratuito da Cloudflare dá 100.000 pedidos por dia. Uma newsletter usa uma
fração disso.

## 3. Ligar o site ao Worker

Em **`index.html`** e **`produto.html`**, procura `var NOMADA_NEWSLETTER` e muda duas linhas:

```js
mode: 'endpoint',
endpointUrl: 'https://nomada-newsletter.<o-teu-subdominio>.workers.dev',
```

Mais nada muda. O popup, o design e o comportamento ficam iguais.

## 4. Confirmar

1. Abre o site, submete um email real teu.
2. Deve aparecer "Obrigada! O teu desconto de 10% está a caminho."
3. Shopify Admin → **Clientes** → procura esse email → deve ter
   **"Subscreveu o email marketing"**.
4. Verifica a caixa de correio: a automação *Boas-vindas! Aqui tens 10% de desconto* deve chegar.

Se algo falhar, vê os logs em tempo real com:

```bash
npx wrangler tail
```

---

## Porque é preciso um Worker

A mutation `customerEmailMarketingSubscribe` da **Storefront API** só existe na versão
`unstable`. Confirmado por introspeção ao schema da loja: está ausente de `2026-01`, `2026-04`,
`2026-07` e `2026-10`.

`unstable` funciona hoje, mas a Shopify pode alterá-la ou removê-la sem aviso — e nesse dia a
newsletter deixa de funcionar em silêncio.

A **Admin API** faz o mesmo numa versão estável e versionada, mas exige um token privado. Um
token privado não pode estar num site público, e o browser bloqueia chamadas diretas à Admin
API por CORS. Daí o Worker: é o sítio, fora do HTML, onde o token pode viver em segurança.

## Detalhe que faz a diferença

O Worker envia sempre `consentUpdatedAt` com a hora atual. A Shopify **só dispara** a automação
de boas-vindas se esse campo estiver dentro das últimas 24 horas. Sem isso, a pessoa entra na
lista mas nunca recebe o email dos 10%.

## Nota sobre abuso

O endpoint é público por natureza — aceita apenas pedidos vindos dos domínios em
`ALLOWED_ORIGINS`, o que trava uso casual por terceiros, mas o header `Origin` pode ser forjado
fora do browser. Se algum dia vires subscrições de lixo, ativa uma regra de **Rate Limiting** no
painel da Cloudflare para esta rota (por exemplo, 5 pedidos por minuto por IP).
