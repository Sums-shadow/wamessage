const fs = require("fs");
const path = require("path");
const fetch = require("node-fetch");

const TRANSACTIONS_FILE = path.join(__dirname, "..", "data", "transactions.json");
const SIMPLY_PAY_URL = (
  process.env.SIMPLY_PAY_API_URL ||
  "https://api-simply-pay.net/api/simply-production"
).trim();
const SIMPLY_PAY_CHECK_STATUS_BASE = `${(
  process.env.SIMPLY_PAY_CHECK_STATUS_URL ||
  "https://api-simply-pay.net/api/checkstatus-ordernumber"
).replace(/\/$/, "")}/`;
const MERCHANT_CODE = process.env.SIMPLY_PAY_MERCHANT_CODE || "458957";

const GREETINGS = [
  "bonjour",
  "salut",
  "hello",
  "hi",
  "hey",
  "coucou",
  "bonsoir",
  "mbote",
  "yo",
  "cc",
  "ça va",
  "ca va",
  "good morning",
  "good evening",
  "asalam",
  "salaam",
];


const HELP_ITEMS = [
  {
    title: "Achat SNEL PAY",
    desc:
      "Pour acheter du courant : indiquez votre numéro de compteur (6 à 12 chiffres), choisissez CDF ou USD, puis le montant parmi les forfaits proposés. Ensuite payez par Mobile Money ou par carte (Stripe).",
  },
  {
    title: "Historique",
    desc:
      "Depuis le menu principal, choisissez 2 pour voir vos dernières transactions enregistrées par ce bot.",
  },
  {
    title: "Paiement & sécurité",
    desc:
      "Mobile Money : vous recevez une demande (push) sur votre téléphone — validez avec votre code secret. Stripe : lien sécurisé ; ne communiquez jamais votre code carte par message.",
  },
];

const USD_PACKAGES = [
  { n: 1, amount: 5, kwh: 50, label: "5 USD → 50 kWh" },
  { n: 2, amount: 10, kwh: 105, label: "10 USD → 105 kWh" },
  { n: 3, amount: 20, kwh: 220, label: "20 USD → 220 kWh" },
  { n: 4, amount: 50, kwh: 550, label: "50 USD → 550 kWh" },
];

const CDF_PACKAGES = [
  { n: 1, amount: 100, kwh: 50, label: "100 CDF → 50 kWh" },
  { n: 2, amount: 200, kwh: 105, label: "200 CDF → 105 kWh" },
  { n: 3, amount: 300, kwh: 220, label: "300 CDF → 220 kWh" },
  { n: 4, amount: 500, kwh: 550, label: "500 CDF → 550 kWh" },
];

let sockRef = null;
let stripeClient = null;

function setMessaging(sock) {
  sockRef = sock;
}

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  if (!stripeClient) {
    stripeClient = require("stripe")(key);
  }
  return stripeClient;
}

function loadTransactions() {
  try {
    const dir = path.dirname(TRANSACTIONS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(TRANSACTIONS_FILE)) return [];
    return JSON.parse(fs.readFileSync(TRANSACTIONS_FILE, "utf8"));
  } catch {
    return [];
  }
}

function saveTransaction(entry) {
  const all = loadTransactions();
  all.unshift({ ...entry, at: new Date().toISOString() });
  fs.writeFileSync(
    TRANSACTIONS_FILE,
    JSON.stringify(all.slice(0, 500), null, 2)
  );
}

/** Message court après paiement validé : jeton = n° commande / référence confirmée */
function paymentSuccessMessage(jeton) {
  const j = String(jeton || "").trim();
  return `✅ *Paiement effectué avec succès.*\n\nVotre jeton : *${j || "—"}*`;
}

function extractConfirmedTokenFromCheckStatus(json, fallbackOrderNumber) {
  if (!json || typeof json !== "object") return fallbackOrderNumber || null;
  const fromApi = String(
    json.reference ||
      json.orderNumber ||
      json.orderNumberFlex ||
      json.transaction?.orderNumberFlex ||
      ""
  ).trim();
  return fromApi || fallbackOrderNumber || null;
}

function extractTokenFromSimplyPayResponse(json) {
  if (!json || typeof json !== "object") return null;
  const o = extractOrderNumberFromInit(json);
  if (o) return o;
  const r = String(json.reference || json.orderNumber || "").trim();
  return r || null;
}

const userStates = new Map();

function getState(jid) {
  if (!userStates.has(jid)) userStates.set(jid, { step: "IDLE", data: {} });
  return userStates.get(jid);
}

function publicBaseUrl() {
  const b = (process.env.PUBLIC_BASE_URL || "").replace(/\/$/, "");
  if (b) return b;
  const p = process.env.PORT || 3050;
  return `http://localhost:${p}`;
}

/** Bonjour (jour) / Bonsoir (à partir de 18h jusqu’à avant 6h) — fuseau RDC par défaut */
function greetingSalutation() {
  const tz = (
    process.env.SNEL_PAY_TZ ||
    process.env.TZ ||
    "Africa/Kinshasa"
  ).trim();
  let hour = 12;
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      hour: "numeric",
      hour12: false,
      timeZone: tz,
    }).formatToParts(new Date());
    const hp = parts.find((p) => p.type === "hour");
    hour = hp ? parseInt(hp.value, 10) : 12;
  } catch {
    hour = new Date().getHours();
  }
  if (hour >= 18 || hour < 6) return "Bonsoir";
  return "Bonjour";
}

function mainMenuText() {
  return (
    `*Menu SNEL PAY*\n\n` +
    `1️⃣ Acheter des kWh\n` +
    `2️⃣ Historique des transactions\n` +
    `3️⃣ Aide\n\n` +
    `Répondez par le numéro ou écrivez *MENU*.`
  );
}

function helpMenuText() {
  let t = "*Aide — tapez le numéro du sujet :*\n\n";
  HELP_ITEMS.forEach((h, i) => {
    t += `${i + 1}. ${h.title}\n`;
  });
  t += `\n0️⃣ Retour au menu`;
  return t;
}

function helpDetailText(index) {
  const h = HELP_ITEMS[index];
  if (!h) return null;
  return `*${h.title}*\n\n${h.desc}`;
}

function extractText(message) {
  if (!message) return "";
  if (message.conversation) return message.conversation;
  if (message.extendedTextMessage?.text) return message.extendedTextMessage.text;
  if (message.imageMessage?.caption) return message.imageMessage.caption;
  if (message.buttonsResponseMessage?.selectedButtonId) {
    return message.buttonsResponseMessage.selectedButtonId;
  }
  if (message.templateButtonReplyMessage?.selectedId) {
    return message.templateButtonReplyMessage.selectedId;
  }
  if (message.listResponseMessage?.singleSelectReply?.selectedRowId) {
    return message.listResponseMessage.singleSelectReply.selectedRowId;
  }
  return "";
}

function extractPhoneFromJid(jid) {
  const raw = String(jid || "").split("@")[0];
  const digits = raw.replace(/\D/g, "");
  return digits || raw || null;
}

function extractGeo(message) {
  const loc = message?.locationMessage || message?.liveLocationMessage;
  if (!loc) return { lat: null, long: null };

  const lat = Number(loc.degreesLatitude ?? loc.latitude);
  const long = Number(loc.degreesLongitude ?? loc.longitude);
  return {
    lat: Number.isFinite(lat) ? lat : null,
    long: Number.isFinite(long) ? long : null,
  };
}

function extractIpHint(msg) {
  const candidates = [
    msg?.ip,
    msg?.ipAddress,
    msg?.message?.ip,
    msg?.message?.ipAddress,
    msg?.message?.contextInfo?.ip,
    msg?.message?.contextInfo?.ipAddress,
  ];
  const found = candidates.find((v) => typeof v === "string" && v.trim());
  return found ? found.trim() : null;
}

function formatCoord(v) {
  return typeof v === "number" ? v.toFixed(6) : "N/A";
}

function isGreeting(raw) {
  const t = raw.trim().toLowerCase();
  if (t.length > 50) return false;
  return GREETINGS.some(
    (g) => t === g || t.startsWith(g + " ") || t.endsWith(" " + g)
  );
}

async function sendText(jid, text) {
  if (!sockRef?.user) return;
  await sockRef.sendMessage(jid, { text });
}

async function sendDeliveryButtons(jid) {
  if (!sockRef?.user) return;
  const text = "Votre commande est prête. Que souhaitez-vous faire ?";
  const footer = "Service livraison";
  try {
    // Priorité aux boutons cliquables demandés.
    await sockRef.sendMessage(jid, {
      text,
      footer,
      buttons: [
        {
          buttonId: "confirm_delivery",
          buttonText: { displayText: "Confirmer livraison" },
          type: 1,
        },
        {
          buttonId: "edit_address",
          buttonText: { displayText: "Modifier adresse" },
          type: 1,
        },
      ],
      headerType: 1,
    });
    return;
  } catch (e) {
    console.error("buttons error", e?.message || e);
  }

  try {
    await sockRef.sendMessage(jid, {
      text,
      footer,
      templateButtons: [
        {
          index: 1,
          quickReplyButton: {
            displayText: "Confirmer livraison",
            id: "confirm_delivery",
          },
        },
        {
          index: 2,
          quickReplyButton: {
            displayText: "Modifier adresse",
            id: "edit_address",
          },
        },
      ],
    });
    return;
  } catch (e) {
    console.error("templateButtons error", e?.message || e);
  }

  try {
    await sockRef.sendMessage(jid, {
      text,
      footer,
      buttonText: "Choisir une action",
      sections: [
        {
          title: "Actions disponibles",
          rows: [
            {
              title: "Confirmer livraison",
              rowId: "confirm_delivery",
              description: "Valider la livraison",
            },
            {
              title: "Modifier adresse",
              rowId: "edit_address",
              description: "Envoyer une nouvelle adresse",
            },
          ],
        },
      ],
    });
    return;
  } catch (e) {
    console.error("list message error", e?.message || e);
  }

  await sendText(
    jid,
    `${text}\n\n1) Confirmer livraison\n2) Modifier adresse\n\nRépondez par *confirm_delivery* ou *edit_address*.`
  );
}

function packagesForCurrency(cur) {
  return cur === "USD" ? USD_PACKAGES : CDF_PACKAGES;
}

function invoiceText(st) {
  const { meter, currency, amount, kwh } = st.data;
  return (
    `*Facture*\n\n` +
    `Compteur : *${meter}*\n` +
    `Devise : *${currency}*\n` +
    `Montant : *${amount} ${currency}*\n` +
    `Crédit : *${kwh} kWh*\n\n` +
    `Choisissez le mode de paiement :\n` +
    `1️⃣ Mobile Money\n` +
    `2️⃣ Carte bancaire (Stripe)`
  );
}

function isPaymentSuccessJson(data) {
  if (!data || typeof data !== "object") return false;
  const s = String(
    data.status || data.paymentStatus || data.state || data.result || ""
  ).toLowerCase();
  if (["success", "paid", "completed", "ok", "approved"].includes(s))
    return true;
  if (data.success === true) return true;
  if (data.data && data.data.success === true) return true;
  if (data.payment === true) return true;
  return false;
}

async function callSimplyPay(phoneDigits, amount, currency) {
  const body = {
    merchantCode: MERCHANT_CODE,
    phone: phoneDigits,
    amount: String(amount),
    currency,
  };
  const res = await fetch(SIMPLY_PAY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  return { ok: res.ok, status: res.status, json };
}

function extractOrderNumberFromInit(json) {
  if (!json || typeof json !== "object") return null;
  const a = json.simply_pay?.orderNumber;
  const b = json.transaction?.orderNumberFlex;
  const s = String(a || b || "").trim();
  return s || null;
}

function isSimplyPayPushSent(json) {
  if (!json || typeof json !== "object") return false;
  if (String(json.simply_pay?.code) !== "0") return false;
  return Boolean(extractOrderNumberFromInit(json));
}

async function callCheckStatusByOrderNumber(orderNumber) {
  const pathSeg = encodeURIComponent(orderNumber);
  const url = `${SIMPLY_PAY_CHECK_STATUS_BASE}${pathSeg}`;
  const res = await fetch(url, {
    method: "GET",
    headers: { Accept: "application/json" },
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  return { ok: res.ok, status: res.status, json };
}

/** Réponse GET checkstatus : ex. code "0" + message succès — voir API Simply Pay */
function interpretCheckStatusResponse(data) {
  if (!data || typeof data !== "object") return { kind: "error", detail: "Réponse invalide" };
  const code = String(data.code ?? "");
  const msg = String(data.message || "");
  const lower = msg.toLowerCase();
  const paidByMessage =
    lower.includes("succès") ||
    lower.includes("succes") ||
    lower.includes("traité avec succ") ||
    lower.includes("traite avec succ");
  if (code === "0" && paidByMessage) return { kind: "paid", data };
  if (lower.includes("attente") || lower.includes("en cours") || lower.includes("pending"))
    return { kind: "pending", data };
  if (code !== "0" && code !== "")
    return { kind: "failed", data, detail: msg || `code ${code}` };
  if (code === "0" && !paidByMessage) return { kind: "pending", data };
  return { kind: "pending", data };
}

async function verifySimplyPayOrder(jid, st) {
  const orderNumber = st.data.pendingOrderNumber;
  if (!orderNumber) {
    await sendText(jid, "Aucune commande en attente de vérification. Reprenez un achat depuis le *MENU*.");
    return;
  }
  const { meter, currency, amount, kwh } = st.data.pendingMm || st.data;
  const phone = st.data.pendingMm?.phone;
  try {
    await sendText(jid, "Vérification du paiement en cours…");
    const { ok, json } = await callCheckStatusByOrderNumber(orderNumber);
    if (!ok) {
      await sendText(
        jid,
        `Le service de vérification a répondu une erreur (${json?.message || "HTTP"}). Réessayez *VÉRIFIER* dans un moment.`
      );
      return;
    }
    const outcome = interpretCheckStatusResponse(json);
    if (outcome.kind === "paid") {
      saveTransaction({
        jid,
        type: "mobile_money",
        meter,
        amount,
        currency,
        kwh,
        phone,
        orderNumber,
        reference: json.reference,
        checkStatusResponse: json,
      });
      st.step = "MAIN_MENU";
      st.data = {};
      const jeton = extractConfirmedTokenFromCheckStatus(json, orderNumber);
      await sendText(jid, paymentSuccessMessage(jeton));
      return;
    }
    if (outcome.kind === "failed") {
      await sendText(
        jid,
        `Paiement non confirmé : ${outcome.detail || json.message || "échec"}.\n\nVous pouvez réessayer un achat depuis le *MENU*.`
      );
      return;
    }
    await sendText(
      jid,
      `Paiement *pas encore confirmé* côté opérateur.\n\nValidez le push sur votre téléphone si ce n'est pas fait, puis réécrivez *VÉRIFIER*.\n\n${json.message ? `Détail : ${json.message}` : ""}`
    );
  } catch (e) {
    console.error("checkstatus error", e);
    await sendText(jid, "Erreur réseau lors de la vérification. Réessayez *VÉRIFIER*.");
  }
}

function normalizeMmPhone(input) {
  let d = String(input).replace(/\D/g, "");
  if (d.startsWith("0") && d.length === 10) d = "243" + d.slice(1);
  if (d.length === 9) d = "243" + d;
  return d;
}

async function sendHistory(jid) {
  const all = loadTransactions().filter((x) => x.jid === jid).slice(0, 10);
  if (!all.length) {
    await sendText(jid, "Aucune transaction enregistrée pour le moment.");
    return;
  }
  let msg = "*Dernières transactions :*\n\n";
  all.forEach((t, i) => {
    msg += `${i + 1}. ${t.at?.slice(0, 16) || "?"} — ${t.type || "?"} — ${
      t.amount
    } ${t.currency || ""} — ${t.kwh || "?"} kWh — compteur ${t.meter || "?"}\n`;
  });
  await sendText(jid, msg);
}

async function startStripeCheckout(jid, st) {
  const stripe = getStripe();
  if (!stripe) {
    await sendText(
      jid,
      "Paiement Stripe indisponible (clé non configurée). Choisissez Mobile Money ou contactez le support."
    );
    return;
  }
  const { meter, currency, amount, kwh } = st.data;
  const base = publicBaseUrl();
  const isUsd = currency === "USD";
  const unitAmount = isUsd
    ? Math.round(Number(amount) * 100)
    : Math.round(Number(amount));

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      success_url: `${base}/whatsapp/payment-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${base}/whatsapp/payment-cancel`,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: currency.toLowerCase(),
            unit_amount: unitAmount,
            product_data: {
              name: `SNEL PAY — ${kwh} kWh`,
              description: `Compteur ${meter}`,
            },
          },
        },
      ],
      metadata: {
        wa_jid: jid,
        meter: String(meter),
        kwh: String(kwh),
        currency: String(currency),
        amount: String(amount),
      },
    });
    st.step = "STRIPE_WAIT";
    await sendText(
      jid,
      `Ouvrez ce lien pour payer par carte (Stripe) :\n${session.url}\n\nUne fois le paiement validé, vous recevrez une confirmation ici sur WhatsApp.`
    );
  } catch (e) {
    console.error("Stripe checkout error", e);
    await sendText(
      jid,
      "Impossible de créer la session de paiement. Réessayez ou utilisez Mobile Money."
    );
  }
}

async function handleMainMenuChoice(jid, t, st) {
  if (t === "1") {
    st.step = "ASK_METER";
    st.data = {};
    await sendText(
      jid,
      "Entrez votre *numéro de compteur SNEL* (6 à 12 chiffres) :"
    );
    return;
  }
  if (t === "2") {
    await sendHistory(jid);
    return;
  }
  if (t === "3") {
    st.step = "HELP_MENU";
    await sendText(jid, helpMenuText());
    return;
  }
  await sendText(jid, `Option inconnue.\n\n${mainMenuText()}`);
}

async function handleUserText(jid, raw) {
  const t = raw.toLowerCase().replace(/\s+/g, " ").trim();
  const st = getState(jid);

  const goMain = async () => {
    st.step = "MAIN_MENU";
    st.data = {};
    await sendText(jid, mainMenuText());
  };

  if (
    t === "test boutons" ||
    t === "test-boutons" ||
    t === "boutons test" ||
    t === "test bouton" ||
    t === "test-bouton" ||
    t === "bouton test" ||
    t === "bouton" ||
    t === "boutons" ||
    t === "livraison"
  ) {
    console.log(`[BUTTON_TEST] trigger="${t}" to ${jid}`);
    await sendDeliveryButtons(jid);
    return;
  }

  if (t === "confirm_delivery") {
    await sendText(jid, "Livraison confirmée, merci.");
    return;
  }

  if (t === "edit_address") {
    await sendText(jid, "D'accord, envoyez votre nouvelle adresse.");
    return;
  }

  if (t === "menu" || t === "accueil") {
    await goMain();
    return;
  }

  if (t === "historique" || t === "historiques") {
    await sendHistory(jid);
    return;
  }

  if (t === "aide" || t === "help") {
    st.step = "HELP_MENU";
    await sendText(jid, helpMenuText());
    return;
  }

  if (t === "achat" || t === "acheter") {
    st.step = "ASK_METER";
    st.data = {};
    await sendText(
      jid,
      "Entrez votre *numéro de compteur SNEL* (6 à 12 chiffres) :"
    );
    return;
  }

  if (
    t === "vérifier" ||
    t === "verifier" ||
    t === "verify" ||
    t === "check"
  ) {
    if (st.step === "MM_PENDING") {
      await verifySimplyPayOrder(jid, st);
      return;
    }
    await sendText(
      jid,
      "La vérification s’utilise après un paiement Mobile Money : quand le bot vous a donné une *référence de commande*, validez le push puis écrivez *VÉRIFIER*.\n\nConsultez aussi *HISTORIQUE* (menu 2)."
    );
    return;
  }

  if (st.step === "IDLE" && isGreeting(raw)) {
    st.step = "MAIN_MENU";
    const salut = greetingSalutation();
    await sendText(
      jid,
      `${salut} et *bienvenue sur SNEL PAY* ! ✨\n\n` +
        `Nous sommes ravis de vous accueillir. Rechargez votre compteur en toute simplicité : forfaits clairs, paiement sécurisé par Mobile Money ou carte bancaire — tout se fait ici, en quelques messages.\n\n` +
        `Besoin d'aide ? Choisissez *3* dans le menu. À tout de suite !\n\n` +
        `${mainMenuText()}`
    );
    return;
  }

  if (st.step === "HELP_MENU") {
    if (t === "0") {
      await goMain();
      return;
    }
    const n = parseInt(t, 10);
    if (n >= 1 && n <= HELP_ITEMS.length) {
      const detail = helpDetailText(n - 1);
      await sendText(jid, detail);
      if (n === 1) {
        st.step = "ASK_METER";
        st.data = {};
        await sendText(
          jid,
          "Entrez votre *numéro de compteur SNEL* (6 à 12 chiffres) :"
        );
      }
      return;
    }
    await sendText(jid, `Tapez un numéro entre 1 et ${HELP_ITEMS.length}, ou 0 pour le menu.\n\n${helpMenuText()}`);
    return;
  }

  if (st.step === "MAIN_MENU" || st.step === "IDLE") {
    if (/^[123]$/.test(t)) {
      st.step = "MAIN_MENU";
      await handleMainMenuChoice(jid, t, st);
      return;
    }
    if (st.step === "IDLE") {
      await sendText(
        jid,
        `Pour commencer, envoyez une salutation ou écrivez *MENU*.\n\n${mainMenuText()}`
      );
      st.step = "MAIN_MENU";
    } else {
      await sendText(jid, `Je n'ai pas compris.\n\n${mainMenuText()}`);
    }
    return;
  }

  if (st.step === "ASK_METER") {
    const digits = raw.replace(/\D/g, "");
    if (digits.length < 6 || digits.length > 12) {
      await sendText(
        jid,
        "Numéro invalide. Le compteur doit contenir *6 à 12 chiffres*. Réessayez :"
      );
      return;
    }
    st.data.meter = digits;
    st.step = "ASK_CURRENCY";
    await sendText(
      jid,
      `Compteur *${digits}* enregistré.\n\nChoisissez votre devise :\n1️⃣ CDF\n2️⃣ USD\n\n(Vous pouvez aussi écrire CDF ou USD)`
    );
    return;
  }

  if (st.step === "ASK_CURRENCY") {
    let cur = null;
    if (t === "1" || t === "cdf") cur = "CDF";
    if (t === "2" || t === "usd") cur = "USD";
    if (!cur) {
      await sendText(jid, "Répondez par *1* (CDF), *2* (USD), ou écrivez CDF / USD.");
      return;
    }
    st.data.currency = cur;
    st.step = "ASK_PACKAGE";
    const pkgs = packagesForCurrency(cur);
    let msg = `Forfaits en *${cur}* — tapez le numéro :\n\n`;
    pkgs.forEach((p) => {
      msg += `${p.n}. ${p.label}\n`;
    });
    await sendText(jid, msg);
    return;
  }

  if (st.step === "ASK_PACKAGE") {
    const cur = st.data.currency;
    const pkgs = packagesForCurrency(cur);
    const n = parseInt(t, 10);
    const chosen = pkgs.find((p) => p.n === n);
    if (!chosen) {
      await sendText(jid, "Choix invalide. Tapez 1, 2, 3 ou 4.");
      return;
    }
    st.data.amount = chosen.amount;
    st.data.kwh = chosen.kwh;
    st.step = "ASK_PAYMENT_METHOD";
    await sendText(jid, invoiceText(st));
    return;
  }

  if (st.step === "ASK_PAYMENT_METHOD") {
    if (t === "1" || t === "mm" || t === "mobile money") {
      st.step = "ASK_MM_PHONE";
      await sendText(
        jid,
        "Entrez le *numéro Mobile Money* à débiter (format RDC accepté, ex. 08… ou 243…) :"
      );
      return;
    }
    if (t === "2" || t === "stripe" || t === "carte") {
      await startStripeCheckout(jid, st);
      return;
    }
    await sendText(jid, "Tapez *1* pour Mobile Money ou *2* pour Stripe.");
    return;
  }

  if (st.step === "ASK_MM_PHONE") {
    const phone = normalizeMmPhone(raw);
    if (phone.length < 11 || phone.length > 15) {
      await sendText(jid, "Numéro Mobile Money invalide. Réessayez :");
      return;
    }
    const { amount, currency, meter, kwh } = st.data;
    await sendText(
      jid,
      "Traitement en cours… Vous pouvez recevoir une demande (push) sur votre téléphone. Merci de patienter."
    );
    try {
      const { ok, json } = await callSimplyPay(phone, amount, currency);
      const orderNumber = extractOrderNumberFromInit(json);

      if (ok && isSimplyPayPushSent(json) && orderNumber) {
        st.data.pendingOrderNumber = orderNumber;
        st.data.pendingMm = { phone, amount, currency, meter, kwh };
        st.step = "MM_PENDING";
        const spMsg =
          json.simply_pay?.message ||
          json.message ||
          "Transaction envoyée. Validez le push sur votre téléphone.";
        await sendText(
          jid,
          `${spMsg}\n\nRéférence commande : *${orderNumber}*\n\nAprès validation sur le téléphone, écrivez *VÉRIFIER* pour confirmer le paiement (ou réessayez plus tard si besoin).`
        );
        return;
      }

      const immediateSuccess = ok && isPaymentSuccessJson(json) && !orderNumber;
      if (immediateSuccess) {
        saveTransaction({
          jid,
          type: "mobile_money",
          meter,
          amount,
          currency,
          kwh,
          phone,
          apiResponse: json,
        });
        st.step = "MAIN_MENU";
        st.data = {};
        const jetonMm = extractTokenFromSimplyPayResponse(json);
        await sendText(jid, paymentSuccessMessage(jetonMm));
        return;
      }

      const hint =
        json?.simply_pay?.message ||
        json?.message ||
        json?.error ||
        JSON.stringify(json).slice(0, 280);
      st.step = "MAIN_MENU";
      st.data = {};
      await sendText(
        jid,
        `Impossible d’initier le paiement Mobile Money.\n\n${hint}\n\nTapez *MENU* pour réessayer.`
      );
    } catch (e) {
      console.error("Simply Pay error", e);
      await sendText(
        jid,
        "Erreur réseau vers le service de paiement. Réessayez plus tard ou choisissez Stripe."
      );
    }
    return;
  }

  if (st.step === "MM_PENDING") {
    if (
      t === "vérifier" ||
      t === "verifier" ||
      t === "verify" ||
      t === "check"
    ) {
      await verifySimplyPayOrder(jid, st);
      return;
    }
    await sendText(
      jid,
      `Paiement Mobile Money en attente.\n\nRéférence : *${st.data.pendingOrderNumber || "?"}*\n\n*VÉRIFIER* — interroger le statut (GET checkstatus)\n*MENU* — menu principal`
    );
    return;
  }

  if (st.step === "STRIPE_WAIT") {
    await sendText(
      jid,
      "Le lien Stripe a été envoyé. Finalisez le paiement dans votre navigateur. Vous serez notifié ici une fois le paiement réussi.\n\n*MENU* pour revenir au menu."
    );
    return;
  }

  await goMain();
}

async function processIncomingMessage(msg) {
  const jid = msg.key.remoteJid;
  if (!jid || jid.endsWith("@g.us")) return;
  if (msg.key.fromMe) return;

  const sender = extractPhoneFromJid(msg.key.participant || jid) || "N/A";
  const ip = extractIpHint(msg) || "N/A";
  const geo = extractGeo(msg.message);
  console.log(
    `[INCOMING] numero=${sender} ip=${ip} lat=${formatCoord(
      geo.lat
    )} long=${formatCoord(geo.long)}`
  );

  const text = extractText(msg.message);
  if (!text || !String(text).trim()) return;
  console.log(`[INCOMING_TEXT] jid=${jid} text=${String(text).trim()}`);
  try {
    await handleUserText(jid, String(text).trim());
  } catch (e) {
    console.error("snel-bot handle error", e);
  }
}

async function handleStripeWebhook(req, res) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const stripe = getStripe();
  if (!secret || !stripe) {
    return res.status(500).send("Stripe webhook non configuré");
  }
  const sig = req.headers["stripe-signature"];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, secret);
  } catch (err) {
    console.error("Webhook Stripe signature:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const jid = session.metadata?.wa_jid;
    const paid =
      session.payment_status === "paid" || session.payment_status === "complete";
    if (jid && paid) {
      saveTransaction({
        jid,
        type: "stripe",
        meter: session.metadata.meter,
        amount: session.metadata.amount,
        currency: session.metadata.currency,
        kwh: session.metadata.kwh,
        sessionId: session.id,
      });
      const pi = session.payment_intent;
      const jetonStripe =
        (typeof pi === "string" ? pi : pi?.id) || session.id;
      setImmediate(() => {
        sendText(jid, paymentSuccessMessage(jetonStripe)).catch((e) =>
          console.error(e)
        );
      });
    }
  }

  res.json({ received: true });
}

module.exports = {
  setMessaging,
  processIncomingMessage,
  handleStripeWebhook,
  publicBaseUrl,
};
