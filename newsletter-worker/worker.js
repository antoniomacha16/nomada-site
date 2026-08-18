/**
 * NÓMADA — endpoint de subscrição da newsletter.
 *
 * Corre num Cloudflare Worker. Recebe { "email": "..." } do popup do site e subscreve
 * essa pessoa na lista de email marketing da Shopify através da Admin API (versão estável).
 *
 * Porque existe: a mutation customerEmailMarketingSubscribe da Storefront API só existe
 * na versão 'unstable'. A Admin API faz o mesmo numa versão estável, mas exige um token
 * privado — que nunca pode estar no HTML público. Este Worker é o sítio onde esse token vive.
 *
 * Segredos (nunca no código — ver README):
 *   SHOPIFY_ADMIN_TOKEN  → Admin API access token da app personalizada (shpat_...)
 * Variáveis:
 *   SHOPIFY_SHOP_DOMAIN  → qgze5e-ae.myshopify.com
 *   ALLOWED_ORIGINS      → lista separada por vírgulas dos domínios do site
 */

const API_VERSION = '2026-07';

/* Aceita apenas pedidos vindos do site. Evita que o endpoint seja usado por terceiros. */
function corsHeaders(request, env) {
  const allowed = (env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  const origin = request.headers.get('Origin') || '';
  const headers = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
  if (allowed.includes(origin)) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
}

function json(body, status, extraHeaders) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  });
}

/* Validação de email deliberadamente conservadora: rejeita lixo óbvio, não tenta ser RFC 5322. */
function isValidEmail(email) {
  return typeof email === 'string' && email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function shopifyAdmin(env, query, variables) {
  const res = await fetch(
    `https://${env.SHOPIFY_SHOP_DOMAIN}/admin/api/${API_VERSION}/graphql.json`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': env.SHOPIFY_ADMIN_TOKEN,
      },
      body: JSON.stringify({ query, variables }),
    }
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Shopify Admin API respondeu ${res.status}`);
  if (data.errors && data.errors.length) throw new Error(data.errors[0].message);
  return data.data;
}

const FIND_CUSTOMER = `
  query findCustomer($query: String!) {
    customers(first: 1, query: $query) {
      edges { node { id } }
    }
  }`;

const CREATE_CUSTOMER = `
  mutation customerCreate($input: CustomerInput!) {
    customerCreate(input: $input) {
      customer { id }
      userErrors { field message }
    }
  }`;

const UPDATE_CONSENT = `
  mutation customerEmailMarketingConsentUpdate($input: CustomerEmailMarketingConsentUpdateInput!) {
    customerEmailMarketingConsentUpdate(input: $input) {
      customer { id }
      userErrors { field message }
    }
  }`;

async function subscribe(env, email) {
  /* consentUpdatedAt TEM de estar dentro das últimas 24h, senão a Shopify não dispara a
     automação de boas-vindas ("Customer subscribed to email marketing"). */
  const emailMarketingConsent = {
    marketingState: 'SUBSCRIBED',
    marketingOptInLevel: 'SINGLE_OPT_IN',
    consentUpdatedAt: new Date().toISOString(),
  };

  /* Escapa aspas para não partir a sintaxe da query de pesquisa da Shopify. */
  const found = await shopifyAdmin(env, FIND_CUSTOMER, {
    query: `email:"${email.replace(/"/g, '\\"')}"`,
  });
  const existing = found?.customers?.edges?.[0]?.node?.id;

  if (existing) {
    const data = await shopifyAdmin(env, UPDATE_CONSENT, {
      input: { customerId: existing, emailMarketingConsent },
    });
    const errs = data?.customerEmailMarketingConsentUpdate?.userErrors || [];
    if (errs.length) throw new Error(errs[0].message);
    return;
  }

  const data = await shopifyAdmin(env, CREATE_CUSTOMER, {
    input: { email, emailMarketingConsent },
  });
  const errs = data?.customerCreate?.userErrors || [];
  if (errs.length) throw new Error(errs[0].message);
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'POST') return json({ ok: false, error: 'Método não permitido.' }, 405, cors);
    if (!cors['Access-Control-Allow-Origin']) {
      return json({ ok: false, error: 'Origem não autorizada.' }, 403, cors);
    }

    const body = await request.json().catch(() => null);
    const email = body && typeof body.email === 'string' ? body.email.trim() : '';
    if (!isValidEmail(email)) return json({ ok: false, error: 'Email inválido.' }, 400, cors);

    try {
      await subscribe(env, email);
      return json({ ok: true }, 200, cors);
    } catch (err) {
      /* O detalhe fica no log do Worker; o site recebe só uma mensagem genérica. */
      console.error('Falha na subscrição:', err && err.message);
      return json({ ok: false, error: 'Não foi possível concluir a subscrição.' }, 502, cors);
    }
  },
};
