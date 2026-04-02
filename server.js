const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { MongoClient } = require("mongodb");

loadEnvFile();

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
const PUBLIC_DIR = path.join(__dirname, "public");
const APP_NAME = "Ai's Shelf";
const AI_ENGINE_NAME = "HALLAYM AI";
const SESSION_COOKIE = "aishelf_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;
const MAX_BODY_BYTES = 12 * 1024 * 1024;

const APP_STATE = {
  storageMode: hasRealEnv(process.env.MONGODB_URI) ? "mongodb-uri" : "memory",
  hallaymReady: Boolean(
    hasRealEnv(process.env.HALLAYM_API_KEY) || hasRealEnv(process.env.GROQ_API_KEY)
  ),
  cloudinaryReady: Boolean(
    hasRealEnv(process.env.CLOUDINARY_CLOUD_NAME) &&
      ((hasRealEnv(process.env.CLOUDINARY_API_KEY) &&
        hasRealEnv(process.env.CLOUDINARY_API_SECRET)) ||
        hasRealEnv(process.env.CLOUDINARY_UPLOAD_PRESET))
  ),
  videoReady: Boolean(
    (hasRealEnv(process.env.TURN_URL) || hasRealEnv(process.env.EXPRESSTURN_HOST)) &&
      hasRealEnv(process.env.EXPRESSTURN_USERNAME || process.env.TURN_USERNAME) &&
      hasRealEnv(process.env.EXPRESSTURN_PASSWORD || process.env.TURN_PASSWORD)
  ),
};

const COMING_SOON_PAGES = new Set(["/slidesai.html", "/websiteai.html"]);
const sessions = new Map();

const DOMAIN_KEYWORDS = {
  medical: [
    "doctor",
    "shifokor",
    "davolash",
    "kasallik",
    "simptom",
    "alomat",
    "og'riq",
    "isitma",
    "dori",
    "retsept",
    "tahlil",
    "analysis",
    "diagnosis",
    "blood",
    "pressure",
    "pregnancy",
    "hamilador",
    "sog'liq",
    "soglik",
    "salomatlik",
    "jarohat",
    "wound",
    "rash",
    "surunkali",
    "allergiya",
  ],
  legal: [
    "lawyer",
    "advokat",
    "huquq",
    "qonun",
    "shartnoma",
    "sud",
    "da'vo",
    "davo",
    "jarima",
    "meros",
    "nikoh",
    "ajrim",
    "contract",
    "law",
    "legal",
    "police",
    "prokuror",
    "ijara",
    "soliq",
    "license",
    "litsenziya",
    "mulk",
    "debt",
    "qarz",
  ],
  agriculture: [
    "agro",
    "ekin",
    "yer",
    "dala",
    "fermer",
    "hosil",
    "o'g'it",
    "ogit",
    "urug'",
    "urug",
    "sug'orish",
    "sugorish",
    "zararkunanda",
    "pest",
    "crop",
    "soil",
    "tuproq",
    "bog'",
    "bog",
    "greenhouse",
    "issiqxona",
    "traktor",
  ],
  private: [
    "private",
    "shaxsiy",
    "personal",
    "career",
    "karyera",
    "habit",
    "productivity",
    "reja",
    "plan",
    "motivation",
    "goal",
    "maqsad",
    "relationship",
    "munosabat",
    "finance",
    "budjet",
    "budget",
    "business",
    "startup",
  ],
  highRisk: [
    "suicide",
    "o'zini o'ldirish",
    "ozini oldirish",
    "self harm",
    "bomb",
    "weapon",
    "fraud",
    "scam",
    "hack",
    "narkotik",
    "drug trafficking",
  ],
};

const ASSISTANTS = [
  {
    id: "agro-ai",
    slug: "agroai",
    page: "/agroai.html",
    enabled: true,
    name: "Agro AI",
    shortName: "Agro",
    tagline: "Fermer, dala va hosil jarayonlari uchun raqamli agro maslahatchi.",
    intro:
      "Agro AI ekin, parvarish, tuproq, sug'orish, hosil va agro-reja masalalarida tez yordam beradi.",
    accent: "#76d45e",
    specialty: "agriculture",
    systemPrompt: [
      `You are Agro AI inside ${APP_NAME}.`,
      `Never mention Groq, GroqCloud, or any external provider. If asked, say the assistant runs on ${AI_ENGINE_NAME}.`,
      "Respond in Uzbek Latin unless the user clearly writes in another language.",
      "Your role is agriculture, farming, greenhouse, crop health, irrigation, harvest planning, and rural operations support.",
      "If the request is mainly medical, legal, or deeply personal therapy, clearly refuse and recommend the correct specialist assistant.",
      "Give practical, step-by-step answers with light caution where needed.",
    ].join(" "),
  },
  {
    id: "doctor-ai",
    slug: "doctorai",
    page: "/doctorai.html",
    enabled: true,
    name: "Doctor AI",
    shortName: "Doctor",
    tagline: "Sog'liq, simptom va umumiy tibbiy yo'nalishlar uchun ehtiyotkor suhbatdosh.",
    intro:
      "Doctor AI simptomlar, tahlillar, profilaktika va kundalik sog'liq savollarini tushuntirib beradi.",
    accent: "#7ce7ff",
    specialty: "medical",
    systemPrompt: [
      `You are Doctor AI inside ${APP_NAME}.`,
      `Never mention Groq, GroqCloud, or any external provider. If asked, say the assistant runs on ${AI_ENGINE_NAME}.`,
      "Respond in Uzbek Latin unless the user clearly writes in another language.",
      "Be medically careful. You are not a licensed doctor and must not present your answer as a diagnosis or prescription.",
      "If there are red-flag symptoms, advise urgent in-person care or local emergency services immediately.",
      "If the request is mainly legal, contract, police, court, or rights-related, politely refuse and recommend Lawyer AI.",
      "When users send images, describe visible findings carefully and avoid certainty.",
    ].join(" "),
  },
  {
    id: "lawyer-ai",
    slug: "lawyerai",
    page: "/lawyerai.html",
    enabled: true,
    name: "Lawyer AI",
    shortName: "Lawyer",
    tagline: "Huquqiy savollar, hujjatlar va risklarni tartibli tushuntiruvchi yordamchi.",
    intro:
      "Lawyer AI shartnoma, huquqiy risk, sud, jarima va hujjatlar bo'yicha umumiy yo'nalish beradi.",
    accent: "#ffd27d",
    specialty: "legal",
    systemPrompt: [
      `You are Lawyer AI inside ${APP_NAME}.`,
      `Never mention Groq, GroqCloud, or any external provider. If asked, say the assistant runs on ${AI_ENGINE_NAME}.`,
      "Respond in Uzbek Latin unless the user clearly writes in another language.",
      "You are not a licensed attorney and cannot replace formal legal counsel.",
      "If a request is mainly medical or diagnostic, refuse and recommend Doctor AI.",
      "If the user shares documents or images, summarize visible legal structure, obligations, deadlines, and possible risks.",
      "Be clear, structured, and careful with uncertainty.",
    ].join(" "),
  },
  {
    id: "private-ai",
    slug: "privateai",
    page: "/privateai.html",
    enabled: true,
    name: "Private AI",
    shortName: "Private",
    tagline: "Shaxsiy reja, strategiya, odatlar va maxfiy ish yuritish uchun premium yordamchi.",
    intro:
      "Private AI kunlik reja, fokus, produktivlik, biznes-mantiq va maxfiy ish oqimlarida hamroh bo'ladi.",
    accent: "#d9b8ff",
    specialty: "private",
    systemPrompt: [
      `You are Private AI inside ${APP_NAME}.`,
      `Never mention Groq, GroqCloud, or any external provider. If asked, say the assistant runs on ${AI_ENGINE_NAME}.`,
      "Respond in Uzbek Latin unless the user clearly writes in another language.",
      "Your role is private planning, productivity, business thinking, personal routines, and focused life support.",
      "If the request is mainly medical, refuse and recommend Doctor AI. If it is mainly legal, refuse and recommend Lawyer AI.",
      "Be discreet, warm, direct, and organized.",
    ].join(" "),
  },
];

ASSISTANTS.push(
  {
    id: "slides-ai",
    slug: "slidesai",
    page: "/slidesai.html",
    enabled: false,
    name: "Slides AI",
    shortName: "Slides",
    tagline: "Tez orada alohida ishlab chiqiladi.",
    intro: "Slides AI hozircha yopiq.",
    accent: "#b6c1ff",
    specialty: "creative",
    systemPrompt: "",
  },
  {
    id: "website-ai",
    slug: "websiteai",
    page: "/websiteai.html",
    enabled: false,
    name: "Website AI",
    shortName: "Website",
    tagline: "Tez orada alohida ishlab chiqiladi.",
    intro: "Website AI hozircha yopiq.",
    accent: "#ffb8b8",
    specialty: "creative",
    systemPrompt: "",
  }
);

const PROVIDER_TYPES = [
  {
    id: "doctor",
    name: "Shifokor",
    assistantId: "doctor-ai",
    page: "/doctorai.html",
  },
  {
    id: "lawyer",
    name: "Advokat",
    assistantId: "lawyer-ai",
    page: "/lawyerai.html",
  },
  {
    id: "agro",
    name: "Agro mutaxassisi",
    assistantId: "agro-ai",
    page: "/agroai.html",
  },
  {
    id: "private",
    name: "Private consultant",
    assistantId: "private-ai",
    page: "/privateai.html",
  },
];

const providerTypeMap = new Map(PROVIDER_TYPES.map((item) => [item.id, item]));

const assistantMap = new Map(ASSISTANTS.map((assistant) => [assistant.id, assistant]));

const DEFAULT_SITE_SETTINGS = {
  updatedAt: "",
  brand: {
    siteName: APP_NAME,
    shortName: "AS",
    tagline: "Premium multi-agent platform",
    logoUrl: "",
    faviconUrl: "",
    primaryColor: "#2a8a7d",
    secondaryColor: "#102033",
    goldColor: "#c88639",
  },
  landing: {
    heroBadge: "Premium multi-agent platform",
    heroTitle: "Bir shelf ichida bir nechta real AI yo'nalishlari.",
    heroDescription:
      "Ai's Shelf foydalanuvchiga kerakli mutaxassis AIni tanlab suhbat boshlash, rasm yuborish, kameradan analiz qildirish va kerak bo'lsa boshqa Aiga axloqiy tarzda o'tish imkonini beradi.",
    heroPrimaryLabel: "Platformani ochish",
    heroSecondaryLabel: "Dashboard",
    sectionTitle: "Ham vizual, ham nazorat qilinadigan AI platforma",
    sectionDescription:
      "Foydalanuvchi oqimi, media analiz, provider tavsiyasi va admin moderation bitta premium sayt ichida ishlaydi.",
    heroImages: {
      agro:
        "https://images.unsplash.com/photo-1501004318641-b39e6451bec6?auto=format&fit=crop&w=1200&q=80",
      doctor:
        "https://images.unsplash.com/photo-1576091160550-2173dba999ef?auto=format&fit=crop&w=1200&q=80",
      lawyer:
        "https://images.unsplash.com/photo-1450101499163-c8848c66ca85?auto=format&fit=crop&w=1200&q=80",
      private:
        "https://images.unsplash.com/photo-1517048676732-d65bc937f952?auto=format&fit=crop&w=1200&q=80",
    },
  },
  chat: {
    aiWelcome: "Chat tayyor. Savol yozing yoki rasm yuboring.",
    serviceWelcome: "Service thread tayyor. Xabar yozishingiz mumkin.",
    videoLabel: "Masofaviy video aloqa",
  },
  assistantBranding: {
    "agro-ai": {
      name: "Agro AI",
      shortName: "AG",
      logoUrl: "",
      accent: "#76d45e",
    },
    "doctor-ai": {
      name: "Doctor AI",
      shortName: "DR",
      logoUrl: "",
      accent: "#7ce7ff",
    },
    "lawyer-ai": {
      name: "Lawyer AI",
      shortName: "LW",
      logoUrl: "",
      accent: "#ffd27d",
    },
    "private-ai": {
      name: "Private AI",
      shortName: "PR",
      logoUrl: "",
      accent: "#d9b8ff",
    },
    "service-chat": {
      name: "Service Chat",
      shortName: "SV",
      logoUrl: "",
      accent: "#2a8a7d",
    },
  },
};

const memoryStore = {
  users: [],
  conversations: [],
  providerThreads: [],
  siteSettings: clone(DEFAULT_SITE_SETTINGS),
};

let storage = createMemoryAdapter();

const server = http.createServer(async (req, res) => {
  try {
    setSecurityHeaders(res);

    if (req.url === "/favicon.ico") {
      const settings = await storage.getSiteSettings();
      if (settings.brand.faviconUrl.startsWith("data:image/")) {
        const match = settings.brand.faviconUrl.match(/^data:(image\/[^;]+);base64,(.+)$/);
        if (match) {
          res.writeHead(200, { "Content-Type": match[1] });
          res.end(Buffer.from(match[2], "base64"));
          return;
        }
      }
      if (/^https?:\/\//i.test(settings.brand.faviconUrl)) {
        res.writeHead(302, { Location: settings.brand.faviconUrl });
        res.end();
        return;
      }
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const pathname = decodeURIComponent(url.pathname);
    const method = req.method || "GET";

    if (pathname.startsWith("/api/")) {
      await routeApi(req, res, url, pathname, method);
      return;
    }

    if (COMING_SOON_PAGES.has(pathname)) {
      sendHtml(res, renderComingSoon(pathname));
      return;
    }

    if (pathname === "/") {
      await sendStaticFile(req, res, path.join(PUBLIC_DIR, "index.html"));
      return;
    }

    const filePath = path.join(PUBLIC_DIR, pathname.replace(/^\/+/, ""));
    if (!filePath.startsWith(PUBLIC_DIR)) {
      sendJson(res, 403, { error: "Ruxsat yo'q." });
      return;
    }

    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      await sendStaticFile(req, res, filePath);
      return;
    }

    sendHtml(res, renderNotFound(), 404);
  } catch (error) {
    console.error("[Ai's Shelf] Kutilmagan xato:", error);
    sendJson(res, 500, {
      error: "Serverda kutilmagan xatolik yuz berdi.",
      detail: error.message,
    });
  }
});

bootstrap()
  .then(() => {
    server.listen(PORT, HOST, () => {
      console.log(
        `[Ai's Shelf] http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}`
      );
      console.log(`[Ai's Shelf] Storage: ${APP_STATE.storageMode}`);
      console.log(
        `[Ai's Shelf] HALLAYM AI: ${
          APP_STATE.hallaymReady ? "ready" : "missing HALLAYM_API_KEY or GROQ_API_KEY"
        }`
      );
      console.log(
        `[Ai's Shelf] Cloudinary: ${
          APP_STATE.cloudinaryReady ? "ready" : "not configured"
        }`
      );
    });
  })
  .catch((error) => {
    console.error("[Ai's Shelf] Ishga tushishda xato:", error);
    process.exitCode = 1;
  });

async function bootstrap() {
  await initializeStorage();
  await ensureAdminAccount();
  setInterval(cleanupSessions, 1000 * 60 * 10).unref();
}

async function initializeStorage() {
  if (APP_STATE.storageMode !== "mongodb-uri") {
    storage = createMemoryAdapter();
    return;
  }

  const mongoStorage = createMongoAdapter();

  try {
    await mongoStorage.ping();
    storage = mongoStorage;
  } catch (error) {
    APP_STATE.storageMode = "memory";
    storage = createMemoryAdapter();
    console.warn(
      "[Ai's Shelf] Mongo ulanib bo'lmadi, memory rejimga o'tildi:",
      error.message
    );
  }
}

async function routeApi(req, res, url, pathname, method) {
  if (pathname === "/api/site-kit.js" && method === "GET") {
    res.writeHead(200, {
      "Content-Type": "text/javascript; charset=utf-8",
    });
    res.end(renderSiteKitScript());
    return;
  }

  if (pathname === "/api/config" && method === "GET") {
    sendJson(res, 200, {
      appName: APP_NAME,
      aiEngineName: AI_ENGINE_NAME,
      storageMode: APP_STATE.storageMode,
      hallaymReady: APP_STATE.hallaymReady,
      cloudinaryReady: APP_STATE.cloudinaryReady,
      videoReady: APP_STATE.videoReady,
      providerTypes: PROVIDER_TYPES,
      assistants: ASSISTANTS.map((assistant) => ({
        id: assistant.id,
        slug: assistant.slug,
        page: assistant.page,
        enabled: assistant.enabled,
        name: assistant.name,
        shortName: assistant.shortName,
        tagline: assistant.tagline,
        intro: assistant.intro,
        accent: assistant.accent,
      })),
    });
    return;
  }

  if (pathname === "/api/site-settings" && method === "GET") {
    const currentUser = await getAuthenticatedUser(req);
    sendJson(res, 200, {
      settings: await storage.getSiteSettings(),
      canEdit: currentUser?.role === "admin",
    });
    return;
  }

  if (pathname === "/api/site-settings" && method === "PATCH") {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const body = await readJsonBody(req);
    const existing = await storage.getSiteSettings();
    const nextSettings = normalizeSiteSettings(
      deepMerge(existing, body.settings || body || {})
    );
    nextSettings.updatedAt = nowIso();
    const saved = await storage.updateSiteSettings(nextSettings);

    sendJson(res, 200, {
      message: "Sayt sozlamalari yangilandi.",
      settings: saved,
    });
    return;
  }

  if (pathname === "/api/auth/register" && method === "POST") {
    const body = await readJsonBody(req);
    const name = String(body.name || "").trim();
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    const accountType = String(body.accountType || "user").trim().toLowerCase();
    const providerType = normalizeProviderType(body.providerType);
    const providerServices = String(body.providerServices || "").trim().slice(0, 220);

    if (name.length < 2 || !isValidEmail(email) || password.length < 6) {
      sendJson(res, 400, {
        error: "Ism, email va kamida 6 belgili parol kerak.",
      });
      return;
    }

    if (accountType === "provider" && !providerType) {
      sendJson(res, 400, {
        error: "Mutaxassis hisobi uchun yo'nalish tanlang.",
      });
      return;
    }

    const existing = await storage.findUserByEmail(email);
    if (existing) {
      sendJson(res, 409, { error: "Bu email bilan foydalanuvchi mavjud." });
      return;
    }

    const user = {
      id: crypto.randomUUID(),
      name,
      email,
      emailLower: email,
      passwordHash: hashPassword(password),
      role: accountType === "provider" ? "provider" : "user",
      isActive: true,
      company: "",
      bio: "",
      locationLabel: "",
      latitude: null,
      longitude: null,
      geoConsent: false,
      providerType: providerType || "",
      providerServices,
      providerIntro: "",
      providerLicense: "",
      consultationFee: "",
      availableForRecommendations: accountType === "provider",
      videoEnabled: false,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      lastSeenAt: nowIso(),
    };

    await storage.createUser(user);
    createSession(res, user.id);
    sendJson(res, 201, {
      message: "Ro'yxatdan o'tish muvaffaqiyatli yakunlandi.",
      user: sanitizeUser(user),
    });
    return;
  }

  if (pathname === "/api/auth/login" && method === "POST") {
    const body = await readJsonBody(req);
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    const user = await storage.findUserByEmail(email);

    if (!user || !verifyPassword(password, user.passwordHash)) {
      sendJson(res, 401, { error: "Email yoki parol noto'g'ri." });
      return;
    }

    if (!user.isActive) {
      sendJson(res, 403, { error: "Hisob bloklangan. Admin bilan bog'laning." });
      return;
    }

    await storage.updateUser(user.id, { lastSeenAt: nowIso() });
    createSession(res, user.id);
    sendJson(res, 200, {
      message: "Tizimga kirildi.",
      user: sanitizeUser(await storage.findUserById(user.id)),
    });
    return;
  }

  if (pathname === "/api/auth/logout" && method === "POST") {
    destroySession(req, res);
    sendJson(res, 200, { message: "Chiqish bajarildi." });
    return;
  }

  if (pathname === "/api/auth/me" && method === "GET") {
    const user = await getAuthenticatedUser(req);
    sendJson(res, 200, {
      user: user ? sanitizeUser(user) : null,
    });
    return;
  }

  if (pathname === "/api/assistants" && method === "GET") {
    sendJson(res, 200, {
      assistants: ASSISTANTS.map((assistant) => ({
        id: assistant.id,
        name: assistant.name,
        shortName: assistant.shortName,
        enabled: assistant.enabled,
        page: assistant.page,
        tagline: assistant.tagline,
        intro: assistant.intro,
        accent: assistant.accent,
      })),
    });
    return;
  }

  if (pathname === "/api/profile" && method === "GET") {
    const user = await requireAuth(req, res);
    if (!user) return;

    const conversations = await storage.listUserConversations(user.id);
    const providerThreads = await storage.listProviderThreadsForUser(user);
    sendJson(res, 200, {
      user: sanitizeUser(user),
      stats: buildUserStats(conversations),
      recentConversations: conversations.slice(0, 5).map(toConversationSummary),
      recentProviderThreads: providerThreads.slice(0, 5).map(toProviderThreadSummary),
    });
    return;
  }

  if (pathname === "/api/profile" && method === "PATCH") {
    const user = await requireAuth(req, res);
    if (!user) return;

    const body = await readJsonBody(req);
    const requestedProviderType = normalizeProviderType(body.providerType || user.providerType);
    const wantsProviderMode = Boolean(body.asProvider) || user.role === "provider";
    const latitude = body.latitude === null || body.latitude === "" ? null : Number(body.latitude);
    const longitude = body.longitude === null || body.longitude === "" ? null : Number(body.longitude);
    const updates = {
      name: String(body.name || user.name).trim().slice(0, 80),
      company: String(body.company || "").trim().slice(0, 120),
      bio: String(body.bio || "").trim().slice(0, 400),
      locationLabel: String(body.locationLabel || "").trim().slice(0, 160),
      latitude: Number.isFinite(latitude) ? latitude : null,
      longitude: Number.isFinite(longitude) ? longitude : null,
      geoConsent: Boolean(body.geoConsent) || (Number.isFinite(latitude) && Number.isFinite(longitude)),
      providerType: wantsProviderMode ? requestedProviderType || "" : "",
      providerServices: String(body.providerServices || "").trim().slice(0, 220),
      providerIntro: String(body.providerIntro || "").trim().slice(0, 500),
      providerLicense: String(body.providerLicense || "").trim().slice(0, 120),
      consultationFee: String(body.consultationFee || "").trim().slice(0, 80),
      availableForRecommendations: wantsProviderMode ? Boolean(body.availableForRecommendations ?? true) : false,
      videoEnabled: wantsProviderMode ? Boolean(body.videoEnabled) : false,
      updatedAt: nowIso(),
    };

    if (updates.name.length < 2) {
      sendJson(res, 400, { error: "Ism juda qisqa." });
      return;
    }

    if (wantsProviderMode && !updates.providerType) {
      sendJson(res, 400, { error: "Provider profil uchun yo'nalish tanlang." });
      return;
    }

    if (user.role !== "admin" && user.role !== "provider" && wantsProviderMode) {
      updates.role = "provider";
    }

    await storage.updateUser(user.id, updates);
    sendJson(res, 200, {
      message: "Profil yangilandi.",
      user: sanitizeUser(await storage.findUserById(user.id)),
    });
    return;
  }

  if (pathname === "/api/provider-types" && method === "GET") {
    sendJson(res, 200, { providerTypes: PROVIDER_TYPES });
    return;
  }

  if (pathname === "/api/providers" && method === "GET") {
    const user = await requireAuth(req, res);
    if (!user) return;

    const providerType = normalizeProviderType(url.searchParams.get("type"));
    const radiusKm = Math.max(1, Math.min(300, Number(url.searchParams.get("radiusKm") || 100)));
    const latitude = Number(url.searchParams.get("lat") || user.latitude);
    const longitude = Number(url.searchParams.get("lng") || user.longitude);
    const requesterHasCoords = Number.isFinite(latitude) && Number.isFinite(longitude);

    let providers = await storage.listProviders({
      providerType,
      excludeUserId: user.id,
    });

    providers = providers
      .map((provider) => {
        const distanceKm =
          requesterHasCoords &&
          Number.isFinite(provider.latitude) &&
          Number.isFinite(provider.longitude)
            ? haversineKm(latitude, longitude, provider.latitude, provider.longitude)
            : null;

        return {
          ...sanitizeUser(provider),
          distanceKm,
          providerTypeLabel: getProviderTypeLabel(provider.providerType),
        };
      })
      .filter((provider) => provider.distanceKm == null || provider.distanceKm <= radiusKm)
      .sort((a, b) => {
        if (a.distanceKm == null && b.distanceKm == null) return 0;
        if (a.distanceKm == null) return 1;
        if (b.distanceKm == null) return -1;
        return a.distanceKm - b.distanceKm;
      });

    sendJson(res, 200, {
      providers,
      locationUsed: requesterHasCoords ? { latitude, longitude } : null,
    });
    return;
  }

  if (pathname === "/api/provider-threads" && method === "GET") {
    const user = await requireAuth(req, res);
    if (!user) return;

    const threads = await storage.listProviderThreadsForUser(user);
    const users = await storage.listUsers();
    const userMap = new Map(users.map((item) => [item.id, item]));

    sendJson(res, 200, {
      threads: threads.map((thread) =>
        toProviderThreadSummary(thread, {
          requester: userMap.get(thread.userId),
          provider: userMap.get(thread.providerId),
        })
      ),
    });
    return;
  }

  if (pathname === "/api/provider-threads/request" && method === "POST") {
    const user = await requireAuth(req, res);
    if (!user) return;

    const body = await readJsonBody(req);
    const providerId = String(body.providerId || "").trim();
    const note = String(body.note || "").trim().slice(0, 1000);
    const sourceAssistantId = String(body.sourceAssistantId || "").trim();
    const provider = await storage.findUserById(providerId);

    if (!provider || provider.role !== "provider" || !provider.isActive) {
      sendJson(res, 404, { error: "Provider topilmadi." });
      return;
    }

    const providerDistanceKm =
      Number.isFinite(user.latitude) &&
      Number.isFinite(user.longitude) &&
      Number.isFinite(provider.latitude) &&
      Number.isFinite(provider.longitude)
        ? haversineKm(user.latitude, user.longitude, provider.latitude, provider.longitude)
        : null;

    const existingThreads = await storage.listProviderThreadsForUser(user);
    const existing = existingThreads.find(
      (thread) => thread.providerId === providerId && thread.status !== "closed"
    );

    if (existing) {
      sendJson(res, 200, {
        message: "Mavjud provider chat topildi.",
        threadId: existing.id,
      });
      return;
    }

    const now = nowIso();
    const initialText =
      note ||
      `Salom, men ${getProviderTypeLabel(provider.providerType).toLowerCase()} bilan bog'lanmoqchiman.`;
    const initialMessage = createProviderThreadMessage({
      senderId: user.id,
      senderRole: "user",
      text: initialText,
    });

    const thread = {
      id: crypto.randomUUID(),
      userId: user.id,
      providerId: provider.id,
      providerType: provider.providerType,
      title: `${provider.name} bilan bog'lanish`,
      status: "requested",
      sourceAssistantId,
      recommendation: {
        locationLabel: user.locationLabel || "",
        latitude: user.latitude ?? null,
        longitude: user.longitude ?? null,
        distanceKm: providerDistanceKm,
      },
      createdAt: now,
      updatedAt: now,
      lastMessageAt: initialMessage.createdAt,
      lastMessagePreview: truncate(initialText, 180),
      messageCount: 1,
      messages: [initialMessage],
      callSignals: [],
    };

    await storage.createProviderThread(thread);
    sendJson(res, 201, {
      message: "Providerga so'rov yuborildi.",
      threadId: thread.id,
      thread: toProviderThreadSummary(thread, {
        requester: user,
        provider,
      }),
    });
    return;
  }

  if (pathname === "/api/provider-thread" && method === "GET") {
    const user = await requireAuth(req, res);
    if (!user) return;

    const threadId = String(url.searchParams.get("id") || "").trim();
    if (!threadId) {
      sendJson(res, 400, { error: "Thread ID kerak." });
      return;
    }

    const thread = await storage.findProviderThreadById(threadId);
    if (!thread || !canAccessProviderThread(user, thread)) {
      sendJson(res, 404, { error: "Provider chat topilmadi." });
      return;
    }

    const [requester, provider] = await Promise.all([
      storage.findUserById(thread.userId),
      storage.findUserById(thread.providerId),
    ]);

    sendJson(res, 200, {
      thread: {
        ...thread,
        providerTypeLabel: getProviderTypeLabel(thread.providerType),
        requester: sanitizeUser(requester),
        provider: sanitizeUser(provider),
      },
    });
    return;
  }

  if (pathname === "/api/provider-thread/message" && method === "POST") {
    const user = await requireAuth(req, res);
    if (!user) return;

    const body = await readJsonBody(req);
    const threadId = String(body.threadId || "").trim();
    const text = String(body.message || "").trim().slice(0, 2000);
    const imageUrl = String(body.imageUrl || "").trim();
    const imagePublicId = String(body.imagePublicId || "").trim();

    if (!threadId || (!text && !imageUrl)) {
      sendJson(res, 400, { error: "Thread va xabar yoki rasm kerak." });
      return;
    }

    const thread = await storage.findProviderThreadById(threadId);
    if (!thread || !canAccessProviderThread(user, thread)) {
      sendJson(res, 404, { error: "Provider chat topilmadi." });
      return;
    }

    const senderRole = user.id === thread.providerId ? "provider" : "user";
    const message = createProviderThreadMessage({
      senderId: user.id,
      senderRole,
      text,
      imageUrl,
      imagePublicId,
    });

    const updatedThread = await storage.appendProviderThreadMessages(threadId, [message], {
      updatedAt: nowIso(),
      lastMessageAt: message.createdAt,
      lastMessagePreview: truncate(text || "Rasm yuborildi.", 180),
      messageCount: (thread.messageCount || thread.messages.length || 0) + 1,
      status: "active",
    });

    sendJson(res, 200, {
      message: "Xabar yuborildi.",
      thread: updatedThread,
    });
    return;
  }

  if (pathname === "/api/video-config" && method === "GET") {
    const user = await requireAuth(req, res);
    if (!user) return;

    sendJson(res, 200, {
      ready: APP_STATE.videoReady,
      iceServers: buildIceServers(),
    });
    return;
  }

  if (pathname === "/api/provider-call/signal" && method === "POST") {
    const user = await requireAuth(req, res);
    if (!user) return;

    const body = await readJsonBody(req);
    const threadId = String(body.threadId || "").trim();
    const type = String(body.type || "").trim();
    const payload = body.payload ?? null;

    if (!threadId || !type) {
      sendJson(res, 400, { error: "Signal uchun thread va type kerak." });
      return;
    }

    const thread = await storage.findProviderThreadById(threadId);
    if (!thread || !canAccessProviderThread(user, thread)) {
      sendJson(res, 404, { error: "Provider chat topilmadi." });
      return;
    }

    const signal = {
      id: crypto.randomUUID(),
      senderId: user.id,
      type,
      payload,
      createdAt: nowIso(),
      ts: Date.now(),
    };

    await storage.appendProviderThreadSignals(threadId, [signal], {
      updatedAt: nowIso(),
    });
    sendJson(res, 200, { ok: true, signalId: signal.id });
    return;
  }

  if (pathname === "/api/provider-call/signals" && method === "GET") {
    const user = await requireAuth(req, res);
    if (!user) return;

    const threadId = String(url.searchParams.get("threadId") || "").trim();
    const since = Number(url.searchParams.get("since") || 0);

    if (!threadId) {
      sendJson(res, 400, { error: "Thread ID kerak." });
      return;
    }

    const thread = await storage.findProviderThreadById(threadId);
    if (!thread || !canAccessProviderThread(user, thread)) {
      sendJson(res, 404, { error: "Provider chat topilmadi." });
      return;
    }

    const signals = (thread.callSignals || []).filter(
      (signal) => signal.ts > since && signal.senderId !== user.id
    );
    sendJson(res, 200, {
      signals,
      now: Date.now(),
    });
    return;
  }

  if (pathname === "/api/upload-image" && method === "POST") {
    const user = await requireAuth(req, res);
    if (!user) return;

    if (!APP_STATE.cloudinaryReady) {
      sendJson(res, 400, {
        error:
          "Cloudinary sozlanmagan. Rasm yuklash uchun CLOUDINARY_* env qiymatlarini ulang.",
      });
      return;
    }

    const body = await readJsonBody(req);
    const dataUrl = String(body.dataUrl || "");
    const fileName = String(body.fileName || "upload.jpg");
    const assistantId = String(body.assistantId || "").trim();

    if (!dataUrl.startsWith("data:image/")) {
      sendJson(res, 400, { error: "Faqat rasm formatidagi data URL qabul qilinadi." });
      return;
    }

    const assistant =
      assistantMap.get(assistantId) ||
      (assistantId === "service-chat" ? { slug: "service-chat" } : { slug: "shared" });
    const upload = await uploadImageToCloudinary({
      dataUrl,
      fileName,
      folder: `${process.env.CLOUDINARY_FOLDER || "aishelf"}/${assistant.slug}`,
      userId: user.id,
    });

    sendJson(res, 200, {
      imageUrl: upload.secure_url,
      imagePublicId: upload.public_id,
      width: upload.width,
      height: upload.height,
    });
    return;
  }

  if (pathname === "/api/conversations" && method === "GET") {
    const user = await requireAuth(req, res);
    if (!user) return;

    const assistantId = url.searchParams.get("assistantId");
    const conversations = (await storage.listUserConversations(user.id))
      .filter((conversation) => !assistantId || conversation.assistantId === assistantId)
      .map(toConversationSummary);

    sendJson(res, 200, { conversations });
    return;
  }

  if (pathname === "/api/conversation" && method === "GET") {
    const user = await requireAuth(req, res);
    if (!user) return;

    const conversationId = String(url.searchParams.get("id") || "").trim();
    if (!conversationId) {
      sendJson(res, 400, { error: "Conversation ID kerak." });
      return;
    }

    const conversation = await storage.findConversationById(conversationId);
    if (!conversation || (conversation.userId !== user.id && user.role !== "admin")) {
      sendJson(res, 404, { error: "Suhbat topilmadi." });
      return;
    }

    sendJson(res, 200, { conversation });
    return;
  }

  if (pathname === "/api/chat/send" && method === "POST") {
    const user = await requireAuth(req, res);
    if (!user) return;

    const body = await readJsonBody(req);
    const assistantId = String(body.assistantId || "").trim();
    const conversationId = String(body.conversationId || "").trim();
    const messageText = String(body.message || "").trim();
    const imageUrl = String(body.imageUrl || "").trim();
    const imagePublicId = String(body.imagePublicId || "").trim();
    const assistant = assistantMap.get(assistantId);

    if (!assistant || !assistant.enabled) {
      sendJson(res, 400, { error: "Bu AI hozircha faol emas." });
      return;
    }

    if (!messageText && !imageUrl) {
      sendJson(res, 400, { error: "Xabar yoki rasm yuboring." });
      return;
    }

    let conversation = conversationId
      ? await storage.findConversationById(conversationId)
      : null;

    if (conversation && conversation.userId !== user.id) {
      sendJson(res, 403, { error: "Bu suhbat sizga tegishli emas." });
      return;
    }

    if (!conversation) {
      conversation = createConversationShell(user, assistant);
      await storage.createConversation(conversation);
    }

    const userMessage = createMessage({
      role: "user",
      text: messageText || "Rasmni tahlil qilib bering.",
      imageUrl,
      imagePublicId,
      flags: deriveMessageFlags(messageText),
    });

    conversation.messages.push(userMessage);
    conversation = await storage.appendMessages(
      conversation.id,
      [userMessage],
      buildConversationMetadata(conversation)
    );

    const handoff = detectHandoff(assistant, messageText);
    let assistantMessage;

    if (handoff) {
      assistantMessage = createMessage({
        role: "assistant",
        text: handoff.message,
        flags: ["handoff"],
        handoff: {
          assistantId: handoff.target.id,
          label: `${handoff.target.name} ga o'tish`,
          page: handoff.target.page,
          reason: handoff.reason,
        },
      });
    } else {
      const replyText = await generateHallaymReply({
        assistant,
        conversation,
        user,
        imageUrl,
      });

      assistantMessage = createMessage({
        role: "assistant",
        text: replyText,
        flags: deriveMessageFlags(replyText),
      });
    }

    conversation.messages.push(assistantMessage);
    conversation = await storage.appendMessages(
      conversation.id,
      [assistantMessage],
      buildConversationMetadata(conversation)
    );

    sendJson(res, 200, {
      conversationId: conversation.id,
      assistantMessage,
      handoff: assistantMessage.handoff || null,
      conversation,
    });
    return;
  }

  if (pathname === "/api/admin/summary" && method === "GET") {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const users = await storage.listUsers();
    const conversations = await storage.listAllConversations();
    sendJson(res, 200, {
      summary: buildAdminSummary(users, conversations),
      admin: sanitizeUser(admin),
    });
    return;
  }

  if (pathname === "/api/admin/users" && method === "GET") {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const users = await storage.listUsers();
    const conversations = await storage.listAllConversations();
    const userStatsMap = new Map();

    for (const conversation of conversations) {
      const current = userStatsMap.get(conversation.userId) || {
        conversationCount: 0,
        messageCount: 0,
        lastConversationAt: "",
      };
      current.conversationCount += 1;
      current.messageCount += conversation.messages.length;
      current.lastConversationAt = maxIso(current.lastConversationAt, conversation.updatedAt);
      userStatsMap.set(conversation.userId, current);
    }

    sendJson(res, 200, {
      users: users.map((user) => ({
        ...sanitizeUser(user),
        stats: userStatsMap.get(user.id) || {
          conversationCount: 0,
          messageCount: 0,
          lastConversationAt: "",
        },
      })),
    });
    return;
  }

  if (pathname === "/api/admin/user-status" && method === "POST") {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const body = await readJsonBody(req);
    const userId = String(body.userId || "").trim();
    const isActive = Boolean(body.isActive);
    const target = await storage.findUserById(userId);

    if (!target) {
      sendJson(res, 404, { error: "Foydalanuvchi topilmadi." });
      return;
    }

    if (target.role === "admin" && !isActive) {
      sendJson(res, 400, { error: "Admin foydalanuvchini bloklab bo'lmaydi." });
      return;
    }

    await storage.updateUser(userId, { isActive, updatedAt: nowIso() });
    sendJson(res, 200, {
      message: isActive ? "Foydalanuvchi faollashtirildi." : "Foydalanuvchi bloklandi.",
      user: sanitizeUser(await storage.findUserById(userId)),
    });
    return;
  }

  if (pathname === "/api/admin/conversations" && method === "GET") {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const assistantId = String(url.searchParams.get("assistantId") || "").trim();
    const userId = String(url.searchParams.get("userId") || "").trim();
    const search = String(url.searchParams.get("search") || "").trim().toLowerCase();

    const conversations = await storage.listAllConversations({
      assistantId,
      userId,
      search,
    });
    const users = await storage.listUsers();
    const userMap = new Map(users.map((user) => [user.id, user]));

    sendJson(res, 200, {
      conversations: conversations.map((conversation) => ({
        ...toConversationSummary(conversation),
        user: userMap.get(conversation.userId)
          ? sanitizeUser(userMap.get(conversation.userId))
          : null,
      })),
    });
    return;
  }

  sendJson(res, 404, { error: "API endpoint topilmadi." });
}

function createConversationShell(user, assistant) {
  const now = nowIso();
  return {
    id: crypto.randomUUID(),
    userId: user.id,
    assistantId: assistant.id,
    assistantName: assistant.name,
    title: `${assistant.shortName} session`,
    createdAt: now,
    updatedAt: now,
    lastMessageAt: now,
    lastMessagePreview: "",
    messageCount: 0,
    flaggedCount: 0,
    flags: [],
    messages: [],
  };
}

function createMessage({
  role,
  text,
  imageUrl = "",
  imagePublicId = "",
  flags = [],
  handoff = null,
}) {
  return {
    id: crypto.randomUUID(),
    role,
    text,
    imageUrl,
    imagePublicId,
    flags,
    handoff,
    createdAt: nowIso(),
  };
}

function buildConversationMetadata(conversation) {
  const titleCandidate =
    conversation.messages.find((message) => message.role === "user" && message.text)?.text || "";
  const title = cleanTitle(titleCandidate) || conversation.title;
  const lastMessage = conversation.messages[conversation.messages.length - 1];
  const flags = Array.from(
    new Set(conversation.messages.flatMap((message) => message.flags || []).filter(Boolean))
  );

  return {
    title,
    updatedAt: nowIso(),
    lastMessageAt: lastMessage?.createdAt || nowIso(),
    lastMessagePreview: truncate(lastMessage?.text || "", 160),
    messageCount: conversation.messages.length,
    flaggedCount: conversation.messages.filter(
      (message) => (message.flags || []).length > 0
    ).length,
    flags,
  };
}

function toConversationSummary(conversation) {
  return {
    id: conversation.id,
    userId: conversation.userId,
    assistantId: conversation.assistantId,
    assistantName: conversation.assistantName,
    title: conversation.title,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    lastMessageAt: conversation.lastMessageAt,
    lastMessagePreview: conversation.lastMessagePreview,
    messageCount: conversation.messageCount,
    flaggedCount: conversation.flaggedCount,
    flags: conversation.flags || [],
  };
}

function buildUserStats(conversations) {
  const byAssistant = {};
  for (const conversation of conversations) {
    byAssistant[conversation.assistantId] =
      (byAssistant[conversation.assistantId] || 0) + 1;
  }

  return {
    conversationCount: conversations.length,
    messageCount: conversations.reduce((total, item) => total + item.messages.length, 0),
    flaggedConversationCount: conversations.filter((item) => item.flaggedCount > 0).length,
    byAssistant,
  };
}

function buildAdminSummary(users, conversations) {
  const assistantBreakdown = {};
  for (const conversation of conversations) {
    assistantBreakdown[conversation.assistantId] =
      (assistantBreakdown[conversation.assistantId] || 0) + 1;
  }

  return {
    totalUsers: users.length,
    activeUsers: users.filter((user) => user.isActive).length,
    admins: users.filter((user) => user.role === "admin").length,
    totalConversations: conversations.length,
    totalMessages: conversations.reduce((total, item) => total + item.messages.length, 0),
    flaggedConversations: conversations.filter((item) => item.flaggedCount > 0).length,
    assistantBreakdown,
    recentConversations: conversations.slice(0, 8).map(toConversationSummary),
  };
}

function createProviderThreadMessage({
  senderId,
  senderRole,
  text,
  imageUrl = "",
  imagePublicId = "",
}) {
  return {
    id: crypto.randomUUID(),
    senderId,
    senderRole,
    text,
    imageUrl,
    imagePublicId,
    createdAt: nowIso(),
  };
}

function toProviderThreadSummary(thread, related = {}) {
  const requester = related.requester ? sanitizeUser(related.requester) : null;
  const provider = related.provider ? sanitizeUser(related.provider) : null;

  return {
    id: thread.id,
    userId: thread.userId,
    providerId: thread.providerId,
    providerType: thread.providerType,
    providerTypeLabel: getProviderTypeLabel(thread.providerType),
    title: thread.title,
    status: thread.status,
    sourceAssistantId: thread.sourceAssistantId || "",
    recommendation: thread.recommendation || null,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    lastMessageAt: thread.lastMessageAt,
    lastMessagePreview: thread.lastMessagePreview,
    messageCount: thread.messageCount || (thread.messages || []).length,
    requester,
    provider,
  };
}

function canAccessProviderThread(user, thread) {
  return (
    user.role === "admin" ||
    thread.userId === user.id ||
    thread.providerId === user.id
  );
}

function normalizeProviderType(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return providerTypeMap.has(normalized) ? normalized : "";
}

function getProviderTypeLabel(providerType) {
  return providerTypeMap.get(providerType)?.name || "Mutaxassis";
}

function providerTypeFromAssistantId(assistantId) {
  return PROVIDER_TYPES.find((item) => item.assistantId === assistantId)?.id || "";
}

function haversineKm(lat1, lng1, lat2, lng2) {
  const toRadians = (value) => (value * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Number((earthRadiusKm * c).toFixed(1));
}

function buildIceServers() {
  if (!APP_STATE.videoReady) return [];

  const username =
    process.env.EXPRESSTURN_USERNAME || process.env.TURN_USERNAME || "";
  const credential =
    process.env.EXPRESSTURN_PASSWORD || process.env.TURN_PASSWORD || "";
  const rawTurnUrls = String(process.env.TURN_URL || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  if (rawTurnUrls.length > 0) {
    return [
      {
        urls: rawTurnUrls,
        username,
        credential,
      },
    ];
  }

  const hosts = String(process.env.EXPRESSTURN_HOST || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const port = Number(process.env.EXPRESSTURN_PORT || 3478);
  const turnsPort = Number(process.env.EXPRESSTURN_TURNS_PORT || 443);
  const includeTurns = String(process.env.EXPRESSTURN_ENABLE_TURNS || "true") !== "false";

  const iceServers = [];
  for (const host of hosts) {
    iceServers.push({ urls: [`stun:${host}:${port}`] });
    iceServers.push({
      urls: [`turn:${host}:${port}?transport=udp`, `turn:${host}:${port}?transport=tcp`],
      username,
      credential,
    });
    if (includeTurns) {
      iceServers.push({
        urls: [`turns:${host}:${turnsPort}?transport=tcp`],
        username,
        credential,
      });
    }
  }

  return iceServers;
}

function detectHandoff(assistant, rawText) {
  const text = String(rawText || "").trim();
  if (!text) return null;

  const scores = scoreDomains(text);
  const threshold = 2;

  if (scores.highRisk > 0) {
    return {
      reason: "high-risk",
      target: assistantMap.get("private-ai"),
      message:
        "Bu mavzu yuqori xavf toifasiga yaqin. Men bu yerda chuqur ko'rsatma bera olmayman. Zarurat bo'lsa, mahalliy tez yordam yoki ishonchli mutaxassisga murojaat qiling.",
    };
  }

  if (
    assistant.specialty === "medical" &&
    scores.legal >= threshold &&
    scores.legal > scores.medical
  ) {
    const target = assistantMap.get("lawyer-ai");
    return {
      reason: "legal-in-medical",
      target,
      message: `Bu savol ko'proq huquqiy yo'nalishga kiradi. Men Doctor AI sifatida bu masalada chuqur javob bermayman. Quyidagi tugma orqali ${target.name} ga o'tishingiz mumkin.`,
    };
  }

  if (
    assistant.specialty === "legal" &&
    scores.medical >= threshold &&
    scores.medical > scores.legal
  ) {
    const target = assistantMap.get("doctor-ai");
    return {
      reason: "medical-in-legal",
      target,
      message: `Bu savol tibbiy yo'nalishga yaqin. Men Lawyer AI sifatida bunday holatda aniq maslahat bermayman. Quyidagi tugma orqali ${target.name} ga o'ting.`,
    };
  }

  if (assistant.specialty === "agriculture") {
    if (scores.legal >= threshold && scores.legal >= scores.agriculture) {
      const target = assistantMap.get("lawyer-ai");
      return {
        reason: "legal-in-agro",
        target,
        message: `Savolingiz huquqiy tomonga og'ib ketdi. Agro AI bu yerda to'liq javob bermaydi. ${target.name} bilan davom etish tavsiya qilinadi.`,
      };
    }
    if (scores.medical >= threshold && scores.medical >= scores.agriculture) {
      const target = assistantMap.get("doctor-ai");
      return {
        reason: "medical-in-agro",
        target,
        message: `Savolingiz tibbiy yo'nalishga yaqinlashdi. Agro AI o'rniga ${target.name} bu holatda to'g'riroq yordam beradi.`,
      };
    }
  }

  if (assistant.specialty === "private") {
    if (scores.legal >= threshold && scores.legal > scores.private) {
      const target = assistantMap.get("lawyer-ai");
      return {
        reason: "legal-in-private",
        target,
        message: `Bu mavzu huquqiy tavsifda. Men Private AI sifatida bunday masalani chuqur hal qilmayman. ${target.name} ga o'tishingiz mumkin.`,
      };
    }
    if (scores.medical >= threshold && scores.medical > scores.private) {
      const target = assistantMap.get("doctor-ai");
      return {
        reason: "medical-in-private",
        target,
        message: `Bu savol tibbiy yo'nalishda. Men Private AI sifatida bu yerda faqat umumiy yo'l ko'rsata olaman, to'g'ri davom uchun ${target.name} ga o'ting.`,
      };
    }
  }

  return null;
}

function scoreDomains(text) {
  const normalized = normalizeText(text);
  const scores = {};

  for (const [domain, keywords] of Object.entries(DOMAIN_KEYWORDS)) {
    scores[domain] = keywords.reduce(
      (total, keyword) => total + (normalized.includes(normalizeText(keyword)) ? 1 : 0),
      0
    );
  }

  return scores;
}

function deriveMessageFlags(text) {
  const normalized = normalizeText(text);
  const flags = [];

  if (
    DOMAIN_KEYWORDS.highRisk.some((keyword) =>
      normalized.includes(normalizeText(keyword))
    )
  ) {
    flags.push("high-risk");
  }
  if (
    DOMAIN_KEYWORDS.legal.some((keyword) => normalized.includes(normalizeText(keyword)))
  ) {
    flags.push("legal");
  }
  if (
    DOMAIN_KEYWORDS.medical.some((keyword) => normalized.includes(normalizeText(keyword)))
  ) {
    flags.push("medical");
  }

  return Array.from(new Set(flags));
}

async function generateHallaymReply({
  assistant,
  conversation,
  user,
  imageUrl,
}) {
  if (!APP_STATE.hallaymReady) {
    return createLocalFallbackReply({ assistant, user, imageUrl });
  }

  const hallaymKey = process.env.HALLAYM_API_KEY || process.env.GROQ_API_KEY;

  const recentMessages = conversation.messages.slice(-10);
  const hasVisionInput = recentMessages.some((item) => item.imageUrl) || Boolean(imageUrl);
  const messages = [
    {
      role: "system",
      content: assistant.systemPrompt,
    },
    ...recentMessages.map((item) => {
      if (item.imageUrl) {
        return {
          role: item.role === "assistant" ? "assistant" : "user",
          content: [
            {
              type: "text",
              text: item.text || "Foydalanuvchi rasm yubordi.",
            },
            {
              type: "image_url",
              image_url: {
                url: item.imageUrl,
              },
            },
          ],
        };
      }

      return {
        role: item.role === "assistant" ? "assistant" : "user",
        content: item.text || "",
      };
    }),
  ];

  const model = hasVisionInput
    ? process.env.HALLAYM_VISION_MODEL ||
      "meta-llama/llama-4-scout-17b-16e-instruct"
    : process.env.HALLAYM_TEXT_MODEL || "llama-3.3-70b-versatile";

  const payload = {
    model,
    messages,
    temperature: 0.4,
    max_completion_tokens: 1024,
  };

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${hallaymKey}`,
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json();
  if (!response.ok) {
    const detail =
      data?.error?.message || data?.message || "HALLAYM AI javob bera olmadi.";
    throw new Error(detail);
  }

  const text = extractChatCompletionText(data);
  return (
    text ||
    "Kechirasiz, hozircha aniq javobni shakllantira olmadim. Savolni biroz qisqartirib qayta yuboring."
  );
}

function createLocalFallbackReply({ assistant, user, imageUrl }) {
  const imageLine = imageUrl
    ? "Rasm qabul qilindi, ammo vizual tahlil uchun Cloud AI kaliti ham kerak bo'ladi. "
    : "";

  const hints = {
    "agro-ai":
      "Savolni ekin turi, yer holati, iqlim va muammoning davomiyligi bilan yozsangiz tavsiya aniqroq bo'ladi.",
    "doctor-ai":
      "Simptom davomiyligi, yosh, mavjud dori va qaysi paytda kuchayishini yozsangiz foydali bo'ladi. Favqulodda holatda darhol shifokorga murojaat qiling.",
    "lawyer-ai":
      "Hujjat turi, sana, tomonlar va nizoning aynan qaysi bosqichda ekanini ko'rsatsangiz tahlil yaxshilanadi.",
    "private-ai":
      "Maqsad, muddat va asosiy cheklovlarni yozsangiz aniqroq strategiya tuzish mumkin.",
  };

  return `${imageLine}${assistant.name} hozir demo rejimida ishlayapti. To'liq AI javobi uchun serverga \`HALLAYM_API_KEY\` (yoki \`GROQ_API_KEY\`) ulang. ${
    user.name ? `${user.name}, ` : ""
  }${hints[assistant.id] || ""}`.trim();
}

function extractChatCompletionText(data) {
  const content = data?.choices?.[0]?.message?.content;

  if (typeof content === "string") {
    return content.trim();
  }

  if (Array.isArray(content)) {
    return content
      .map((item) => item?.text || "")
      .join("\n")
      .trim();
  }

  return "";
}

async function uploadImageToCloudinary({ dataUrl, fileName, folder, userId }) {
  const endpoint = `https://api.cloudinary.com/v1_1/${process.env.CLOUDINARY_CLOUD_NAME}/image/upload`;
  const form = new FormData();
  form.append("file", dataUrl);
  form.append("folder", folder);
  form.append(
    "public_id",
    `${userId}-${Date.now()}-${
      slugify(fileName.replace(/\.[^.]+$/, "")) || "image"
    }`
  );
  form.append("context", `alt=${APP_NAME} upload`);

  const headers = {};
  if (
    process.env.CLOUDINARY_UPLOAD_PRESET &&
    !(process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET)
  ) {
    form.append("upload_preset", process.env.CLOUDINARY_UPLOAD_PRESET);
  } else {
    const auth = Buffer.from(
      `${process.env.CLOUDINARY_API_KEY}:${process.env.CLOUDINARY_API_SECRET}`
    ).toString("base64");
    headers.Authorization = `Basic ${auth}`;
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: form,
  });
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data?.error?.message || "Cloudinary upload xatosi.");
  }

  return data;
}

async function ensureAdminAccount() {
  const adminEmail = (process.env.ADMIN_EMAIL || "admin@aishelf.local")
    .trim()
    .toLowerCase();
  const adminPassword = process.env.ADMIN_PASSWORD || "Admin123!";
  const existing = await storage.findUserByEmail(adminEmail);

  if (existing) {
    return;
  }

  const admin = {
    id: crypto.randomUUID(),
    name: "Ai's Shelf Admin",
    email: adminEmail,
    emailLower: adminEmail,
    passwordHash: hashPassword(adminPassword),
    role: "admin",
    isActive: true,
    company: "Moderation",
    bio: "Ethical monitoring and user management.",
    createdAt: nowIso(),
    updatedAt: nowIso(),
    lastSeenAt: nowIso(),
  };

  await storage.createUser(admin);
  const source =
    process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD ? "env" : "default";
  console.log(
    `[Ai's Shelf] Admin account ready (${source}): ${adminEmail} / ${adminPassword}`
  );
}

function createSession(res, userId) {
  const token = crypto.randomBytes(24).toString("hex");
  sessions.set(token, {
    userId,
    expiresAt: Date.now() + SESSION_TTL_MS,
  });
  setCookie(res, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
}

function destroySession(req, res) {
  const cookies = parseCookies(req);
  const token = cookies[SESSION_COOKIE];
  if (token) sessions.delete(token);
  setCookie(res, SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
    maxAge: 0,
  });
}

async function getAuthenticatedUser(req) {
  const cookies = parseCookies(req);
  const token = cookies[SESSION_COOKIE];
  if (!token) return null;

  const session = sessions.get(token);
  if (!session) return null;
  if (session.expiresAt < Date.now()) {
    sessions.delete(token);
    return null;
  }

  const user = await storage.findUserById(session.userId);
  if (!user || !user.isActive) {
    sessions.delete(token);
    return null;
  }

  session.expiresAt = Date.now() + SESSION_TTL_MS;
  return user;
}

async function requireAuth(req, res) {
  const user = await getAuthenticatedUser(req);
  if (!user) {
    sendJson(res, 401, { error: "Avval tizimga kiring." });
    return null;
  }
  return user;
}

async function requireAdmin(req, res) {
  const user = await requireAuth(req, res);
  if (!user) return null;
  if (user.role !== "admin") {
    sendJson(res, 403, { error: "Admin ruxsati talab qilinadi." });
    return null;
  }
  return user;
}

function createMemoryAdapter() {
  return {
    async findUserByEmail(emailLower) {
      return clone(memoryStore.users.find((user) => user.emailLower === emailLower) || null);
    },
    async findUserById(id) {
      return clone(memoryStore.users.find((user) => user.id === id) || null);
    },
    async createUser(user) {
      memoryStore.users.push(clone(user));
      return clone(user);
    },
    async updateUser(id, updates) {
      const user = memoryStore.users.find((item) => item.id === id);
      if (!user) return null;
      Object.assign(user, clone(updates), { updatedAt: nowIso() });
      return clone(user);
    },
    async listUsers() {
      return clone([...memoryStore.users].sort(sortByCreatedDesc));
    },
    async listProviders(filters = {}) {
      let users = memoryStore.users.filter(
        (user) =>
          user.role === "provider" &&
          user.isActive &&
          user.availableForRecommendations !== false
      );
      if (filters.providerType) {
        users = users.filter((user) => user.providerType === filters.providerType);
      }
      if (filters.excludeUserId) {
        users = users.filter((user) => user.id !== filters.excludeUserId);
      }
      return clone(users.sort(sortByCreatedDesc));
    },
    async createConversation(conversation) {
      memoryStore.conversations.push(clone(conversation));
      return clone(conversation);
    },
    async findConversationById(id) {
      return clone(
        memoryStore.conversations.find((conversation) => conversation.id === id) || null
      );
    },
    async listUserConversations(userId) {
      return clone(
        memoryStore.conversations
          .filter((conversation) => conversation.userId === userId)
          .sort(sortByUpdatedDesc)
      );
    },
    async listAllConversations(filters = {}) {
      let conversations = [...memoryStore.conversations];
      if (filters.userId) {
        conversations = conversations.filter((item) => item.userId === filters.userId);
      }
      if (filters.assistantId) {
        conversations = conversations.filter((item) => item.assistantId === filters.assistantId);
      }
      if (filters.search) {
        const search = filters.search.toLowerCase();
        conversations = conversations.filter((item) =>
          JSON.stringify(item).toLowerCase().includes(search)
        );
      }
      conversations.sort(sortByUpdatedDesc);
      return clone(conversations);
    },
    async appendMessages(conversationId, newMessages, metadata) {
      const conversation = memoryStore.conversations.find(
        (item) => item.id === conversationId
      );
      if (!conversation) return null;
      conversation.messages.push(...clone(newMessages));
      Object.assign(conversation, clone(metadata));
      return clone(conversation);
    },
    async createProviderThread(thread) {
      memoryStore.providerThreads.push(clone(thread));
      return clone(thread);
    },
    async findProviderThreadById(id) {
      return clone(memoryStore.providerThreads.find((thread) => thread.id === id) || null);
    },
    async listProviderThreadsForUser(user) {
      let threads = [...memoryStore.providerThreads];
      if (user.role === "provider") {
        threads = threads.filter((thread) => thread.providerId === user.id);
      } else if (user.role !== "admin") {
        threads = threads.filter((thread) => thread.userId === user.id);
      }
      threads.sort(sortByUpdatedDesc);
      return clone(threads);
    },
    async appendProviderThreadMessages(threadId, newMessages, metadata) {
      const thread = memoryStore.providerThreads.find((item) => item.id === threadId);
      if (!thread) return null;
      thread.messages.push(...clone(newMessages));
      Object.assign(thread, clone(metadata));
      return clone(thread);
    },
    async appendProviderThreadSignals(threadId, newSignals, metadata) {
      const thread = memoryStore.providerThreads.find((item) => item.id === threadId);
      if (!thread) return null;
      thread.callSignals = [...(thread.callSignals || []), ...clone(newSignals)].slice(-120);
      Object.assign(thread, clone(metadata));
      return clone(thread);
    },
    async getSiteSettings() {
      if (!memoryStore.siteSettings) {
        memoryStore.siteSettings = clone(DEFAULT_SITE_SETTINGS);
      }
      return clone(memoryStore.siteSettings);
    },
    async updateSiteSettings(settings) {
      memoryStore.siteSettings = normalizeSiteSettings(settings);
      return clone(memoryStore.siteSettings);
    },
  };
}

function createMongoAdapter() {
  const uri = process.env.MONGODB_URI;
  const dbName =
    process.env.MONGODB_DATABASE || extractDbNameFromMongoUri(uri) || "ais";
  const client = new MongoClient(uri);

  let collectionsPromise;

  async function getCollections() {
    if (!collectionsPromise) {
      collectionsPromise = (async () => {
        await client.connect();
        const db = client.db(dbName);
        const users = db.collection("users");
        const conversations = db.collection("conversations");
        const providerThreads = db.collection("providerThreads");
        const siteSettings = db.collection("siteSettings");

        try {
          await Promise.all([
            users.createIndex({ id: 1 }, { unique: true }),
            users.createIndex({ emailLower: 1 }, { unique: true }),
            users.createIndex({ role: 1, providerType: 1, availableForRecommendations: 1 }),
            conversations.createIndex({ id: 1 }, { unique: true }),
            conversations.createIndex({ userId: 1, updatedAt: -1 }),
            conversations.createIndex({ assistantId: 1, updatedAt: -1 }),
            providerThreads.createIndex({ id: 1 }, { unique: true }),
            providerThreads.createIndex({ userId: 1, updatedAt: -1 }),
            providerThreads.createIndex({ providerId: 1, updatedAt: -1 }),
            siteSettings.createIndex({ key: 1 }, { unique: true }),
          ]);
        } catch (error) {
          console.warn("[Ai's Shelf] Mongo index warning:", error.message);
        }

        return { users, conversations, providerThreads, siteSettings };
      })();
    }

    return collectionsPromise;
  }

  const noInternalId = { projection: { _id: 0 } };

  return {
    async ping() {
      await client.connect();
      await client.db(dbName).command({ ping: 1 });
      return true;
    },
    async findUserByEmail(emailLower) {
      const { users } = await getCollections();
      return users.findOne({ emailLower }, noInternalId);
    },
    async findUserById(id) {
      const { users } = await getCollections();
      return users.findOne({ id }, noInternalId);
    },
    async createUser(user) {
      const { users } = await getCollections();
      await users.insertOne(user);
      return user;
    },
    async updateUser(id, updates) {
      const { users } = await getCollections();
      await users.updateOne(
        { id },
        {
          $set: updates,
        }
      );
      return this.findUserById(id);
    },
    async listUsers() {
      const { users } = await getCollections();
      return users.find({}, noInternalId).sort({ createdAt: -1 }).limit(500).toArray();
    },
    async listProviders(filters = {}) {
      const { users } = await getCollections();
      const query = {
        role: "provider",
        isActive: true,
        availableForRecommendations: { $ne: false },
      };
      if (filters.providerType) query.providerType = filters.providerType;
      if (filters.excludeUserId) query.id = { $ne: filters.excludeUserId };
      return users.find(query, noInternalId).sort({ createdAt: -1 }).limit(500).toArray();
    },
    async createConversation(conversation) {
      const { conversations } = await getCollections();
      await conversations.insertOne(conversation);
      return conversation;
    },
    async findConversationById(id) {
      const { conversations } = await getCollections();
      return conversations.findOne({ id }, noInternalId);
    },
    async listUserConversations(userId) {
      const { conversations } = await getCollections();
      return conversations
        .find({ userId }, noInternalId)
        .sort({ updatedAt: -1 })
        .limit(300)
        .toArray();
    },
    async listAllConversations(filters = {}) {
      const { conversations } = await getCollections();
      const filter = {};
      if (filters.userId) filter.userId = filters.userId;
      if (filters.assistantId) filter.assistantId = filters.assistantId;

      let documents = await conversations
        .find(filter, noInternalId)
        .sort({ updatedAt: -1 })
        .limit(500)
        .toArray();

      if (filters.search) {
        const search = filters.search.toLowerCase();
        documents = documents.filter((item) =>
          JSON.stringify(item).toLowerCase().includes(search)
        );
      }

      return documents;
    },
    async appendMessages(conversationId, newMessages, metadata) {
      const { conversations } = await getCollections();
      await conversations.updateOne(
        { id: conversationId },
        {
          $push: {
            messages: {
              $each: newMessages,
            },
          },
          $set: metadata,
        }
      );
      return this.findConversationById(conversationId);
    },
    async createProviderThread(thread) {
      const { providerThreads } = await getCollections();
      await providerThreads.insertOne(thread);
      return thread;
    },
    async findProviderThreadById(id) {
      const { providerThreads } = await getCollections();
      return providerThreads.findOne({ id }, noInternalId);
    },
    async listProviderThreadsForUser(user) {
      const { providerThreads } = await getCollections();
      const filter =
        user.role === "admin"
          ? {}
          : user.role === "provider"
            ? { providerId: user.id }
            : { userId: user.id };
      return providerThreads
        .find(filter, noInternalId)
        .sort({ updatedAt: -1 })
        .limit(300)
        .toArray();
    },
    async appendProviderThreadMessages(threadId, newMessages, metadata) {
      const { providerThreads } = await getCollections();
      await providerThreads.updateOne(
        { id: threadId },
        {
          $push: {
            messages: {
              $each: newMessages,
            },
          },
          $set: metadata,
        }
      );
      return this.findProviderThreadById(threadId);
    },
    async appendProviderThreadSignals(threadId, newSignals, metadata) {
      const { providerThreads } = await getCollections();
      await providerThreads.updateOne(
        { id: threadId },
        {
          $push: {
            callSignals: {
              $each: newSignals,
              $slice: -120,
            },
          },
          $set: metadata,
        }
      );
      return this.findProviderThreadById(threadId);
    },
    async getSiteSettings() {
      const { siteSettings } = await getCollections();
      const document = await siteSettings.findOne(
        { key: "default" },
        { projection: { _id: 0, key: 0, settings: 1 } }
      );
      return document?.settings ? normalizeSiteSettings(document.settings) : clone(DEFAULT_SITE_SETTINGS);
    },
    async updateSiteSettings(settings) {
      const { siteSettings } = await getCollections();
      const normalized = normalizeSiteSettings(settings);
      await siteSettings.updateOne(
        { key: "default" },
        {
          $set: {
            key: "default",
            settings: normalized,
          },
        },
        { upsert: true }
      );
      return normalized;
    },
  };
}

async function readJsonBody(req) {
  const chunks = [];
  let total = 0;

  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) {
      throw new Error("Request body juda katta.");
    }
    chunks.push(chunk);
  }

  if (!chunks.length) return {};

  const raw = Buffer.concat(chunks).toString("utf8");
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error("JSON body noto'g'ri formatda.");
  }
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
  });
  res.end(JSON.stringify(payload));
}

function sendHtml(res, html, statusCode = 200) {
  res.writeHead(statusCode, {
    "Content-Type": "text/html; charset=utf-8",
  });
  res.end(html);
}

async function sendStaticFile(req, res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
  };

  let content = await fs.promises.readFile(filePath);

  if (ext === ".html") {
    const settings = await storage.getSiteSettings();
    const headInjection = [
      settings.brand.faviconUrl
        ? `<link rel="icon" href="${escapeAttribute(settings.brand.faviconUrl)}" />`
        : "",
      '<script src="/api/site-kit.js" defer></script>',
    ]
      .filter(Boolean)
      .join("");

    let html = content.toString("utf8");
    if (html.includes("</head>")) {
      html = html.replace("</head>", `${headInjection}</head>`);
    } else {
      html = `${headInjection}${html}`;
    }
    content = Buffer.from(html, "utf8");
  }

  res.writeHead(200, {
    "Content-Type": mimeTypes[ext] || "application/octet-stream",
  });
  res.end(content);
}

function setSecurityHeaders(res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=*, microphone=()");
}

function setCookie(res, name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  if (options.maxAge !== undefined) parts.push(`Max-Age=${options.maxAge}`);
  if (options.httpOnly) parts.push("HttpOnly");
  if (options.sameSite) parts.push(`SameSite=${options.sameSite}`);
  if (options.path) parts.push(`Path=${options.path}`);
  if (options.secure) parts.push("Secure");
  const existing = res.getHeader("Set-Cookie");
  const cookies = Array.isArray(existing) ? existing : existing ? [existing] : [];
  cookies.push(parts.join("; "));
  res.setHeader("Set-Cookie", cookies);
}

function parseCookies(req) {
  const raw = req.headers.cookie || "";
  const cookies = {};
  raw.split(";").forEach((entry) => {
    const [key, ...rest] = entry.trim().split("=");
    if (!key) return;
    cookies[key] = decodeURIComponent(rest.join("="));
  });
  return cookies;
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, storedHash) {
  const [salt, hash] = String(storedHash || "").split(":");
  if (!salt || !hash) return false;
  const compare = crypto.scryptSync(password, salt, 64).toString("hex");
  return crypto.timingSafeEqual(
    Buffer.from(hash, "hex"),
    Buffer.from(compare, "hex")
  );
}

function sanitizeUser(user) {
  if (!user) return null;
  const cloneUser = clone(user);
  delete cloneUser.passwordHash;
  delete cloneUser.emailLower;
  delete cloneUser._id;
  return cloneUser;
}

function cleanupSessions() {
  const now = Date.now();
  for (const [token, session] of sessions.entries()) {
    if (session.expiresAt < now) {
      sessions.delete(token);
    }
  }
}

function nowIso() {
  return new Date().toISOString();
}

function maxIso(a, b) {
  if (!a) return b;
  if (!b) return a;
  return new Date(a) > new Date(b) ? a : b;
}

function truncate(value, length) {
  return String(value || "").length > length
    ? `${String(value).slice(0, length - 1)}...`
    : String(value || "");
}

function cleanTitle(text) {
  return truncate(String(text || "").replace(/\s+/g, " ").trim(), 48);
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function extractDbNameFromMongoUri(uri) {
  const match = String(uri || "").match(/^[^/]+\/\/[^/]+\/([^?]+)/);
  return match?.[1] ? decodeURIComponent(match[1]) : "";
}

function hasRealEnv(value) {
  const normalized = String(value || "").trim();
  return Boolean(normalized) && !normalized.startsWith("PASTE_");
}

function sanitizeText(value, maxLength = 160) {
  return String(value || "").trim().slice(0, maxLength);
}

function sanitizeColor(value, fallback) {
  const normalized = String(value || "").trim();
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(normalized) ? normalized : fallback;
}

function sanitizeAsset(value) {
  const normalized = String(value || "").trim();
  if (!normalized) return "";
  if (normalized.startsWith("data:image/")) {
    return normalized.slice(0, 5_000_000);
  }
  if (/^https?:\/\//i.test(normalized) || normalized.startsWith("/")) {
    return normalized.slice(0, 4000);
  }
  return "";
}

function deepMerge(base, updates) {
  if (Array.isArray(base) || Array.isArray(updates)) {
    return clone(updates ?? base);
  }
  const output = { ...(base || {}) };
  for (const [key, value] of Object.entries(updates || {})) {
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      base &&
      typeof base[key] === "object" &&
      !Array.isArray(base[key])
    ) {
      output[key] = deepMerge(base[key], value);
    } else {
      output[key] = clone(value);
    }
  }
  return output;
}

function normalizeSiteSettings(input = {}) {
  const merged = deepMerge(DEFAULT_SITE_SETTINGS, input);
  return {
    updatedAt: sanitizeText(merged.updatedAt, 48) || nowIso(),
    brand: {
      siteName: sanitizeText(merged.brand?.siteName || APP_NAME, 80) || APP_NAME,
      shortName: sanitizeText(merged.brand?.shortName || "AS", 8) || "AS",
      tagline: sanitizeText(merged.brand?.tagline || "", 140),
      logoUrl: sanitizeAsset(merged.brand?.logoUrl),
      faviconUrl: sanitizeAsset(merged.brand?.faviconUrl),
      primaryColor: sanitizeColor(merged.brand?.primaryColor, "#2a8a7d"),
      secondaryColor: sanitizeColor(merged.brand?.secondaryColor, "#102033"),
      goldColor: sanitizeColor(merged.brand?.goldColor, "#c88639"),
    },
    landing: {
      heroBadge: sanitizeText(merged.landing?.heroBadge, 90),
      heroTitle: sanitizeText(merged.landing?.heroTitle, 180),
      heroDescription: sanitizeText(merged.landing?.heroDescription, 520),
      heroPrimaryLabel: sanitizeText(merged.landing?.heroPrimaryLabel, 40) || "Platformani ochish",
      heroSecondaryLabel: sanitizeText(merged.landing?.heroSecondaryLabel, 40) || "Dashboard",
      sectionTitle: sanitizeText(merged.landing?.sectionTitle, 120),
      sectionDescription: sanitizeText(merged.landing?.sectionDescription, 320),
      heroImages: {
        agro: sanitizeAsset(merged.landing?.heroImages?.agro),
        doctor: sanitizeAsset(merged.landing?.heroImages?.doctor),
        lawyer: sanitizeAsset(merged.landing?.heroImages?.lawyer),
        private: sanitizeAsset(merged.landing?.heroImages?.private),
      },
    },
    chat: {
      aiWelcome: sanitizeText(merged.chat?.aiWelcome, 140),
      serviceWelcome: sanitizeText(merged.chat?.serviceWelcome, 140),
      videoLabel: sanitizeText(merged.chat?.videoLabel, 80),
    },
    assistantBranding: {
      "agro-ai": normalizeAssistantBranding(
        merged.assistantBranding?.["agro-ai"],
        DEFAULT_SITE_SETTINGS.assistantBranding["agro-ai"]
      ),
      "doctor-ai": normalizeAssistantBranding(
        merged.assistantBranding?.["doctor-ai"],
        DEFAULT_SITE_SETTINGS.assistantBranding["doctor-ai"]
      ),
      "lawyer-ai": normalizeAssistantBranding(
        merged.assistantBranding?.["lawyer-ai"],
        DEFAULT_SITE_SETTINGS.assistantBranding["lawyer-ai"]
      ),
      "private-ai": normalizeAssistantBranding(
        merged.assistantBranding?.["private-ai"],
        DEFAULT_SITE_SETTINGS.assistantBranding["private-ai"]
      ),
      "service-chat": normalizeAssistantBranding(
        merged.assistantBranding?.["service-chat"],
        DEFAULT_SITE_SETTINGS.assistantBranding["service-chat"]
      ),
    },
  };
}

function normalizeAssistantBranding(input = {}, fallback = {}) {
  return {
    name: sanitizeText(input?.name || fallback.name || "AI", 48),
    shortName: sanitizeText(input?.shortName || fallback.shortName || "AI", 4),
    logoUrl: sanitizeAsset(input?.logoUrl),
    accent: sanitizeColor(input?.accent, fallback.accent || "#2a8a7d"),
  };
}

function escapeAttribute(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function renderSiteKitScript() {
  return `(() => {
  if (window.__AIS_SITEKIT__) return;
  window.__AIS_SITEKIT__ = true;

  const THEME_KEY = "aishelf-theme";
  const state = {
    settings: null,
    user: null,
    styleEl: null,
  };

  const assistantId =
    document.body?.dataset?.assistantId || (location.pathname === "/chat.html" ? "service-chat" : "");

  const escapeHtml = (value) =>
    String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");

  const getTheme = () => {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === "day" || saved === "night") return saved;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "night" : "day";
  };

  const setFavicon = (url) => {
    if (!url) return;
    let link = document.querySelector('link[rel="icon"]');
    if (!link) {
      link = document.createElement("link");
      link.rel = "icon";
      document.head.appendChild(link);
    }
    link.href = url;
  };

  const renderMark = (element, logoUrl, fallback) => {
    if (!element) return;
    if (logoUrl) {
      element.innerHTML = '<img alt="logo" src="' + escapeHtml(logoUrl) + '" style="width:100%;height:100%;object-fit:cover;border-radius:inherit;" />';
    } else {
      element.textContent = fallback || "AS";
    }
  };

  const applyBranding = () => {
    const settings = state.settings;
    if (!settings) return;

    document.querySelectorAll(".brand-mark,.mark").forEach((node) => {
      renderMark(node, settings.brand.logoUrl, settings.brand.shortName || "AS");
    });

    document.querySelectorAll("[data-site-brand-name]").forEach((node) => {
      node.textContent = settings.brand.siteName;
    });

    document.querySelectorAll("[data-site-tagline]").forEach((node) => {
      node.textContent = settings.brand.tagline;
    });

    if (document.getElementById("landingHeroBadge")) {
      document.getElementById("landingHeroBadge").textContent = settings.landing.heroBadge;
    }
    if (document.getElementById("landingHeroTitle")) {
      document.getElementById("landingHeroTitle").textContent = settings.landing.heroTitle;
    }
    if (document.getElementById("landingHeroDescription")) {
      document.getElementById("landingHeroDescription").textContent = settings.landing.heroDescription;
    }
    if (document.getElementById("landingSectionTitle")) {
      document.getElementById("landingSectionTitle").textContent = settings.landing.sectionTitle;
    }
    if (document.getElementById("landingSectionDescription")) {
      document.getElementById("landingSectionDescription").textContent = settings.landing.sectionDescription;
    }

    const imageMap = {
      landingHeroImageAgro: settings.landing.heroImages.agro,
      landingHeroImageDoctor: settings.landing.heroImages.doctor,
      landingHeroImageLawyer: settings.landing.heroImages.lawyer,
      landingHeroImagePrivate: settings.landing.heroImages.private,
    };

    Object.entries(imageMap).forEach(([id, src]) => {
      const node = document.getElementById(id);
      if (node && src) node.src = src;
    });

    if (assistantId && settings.assistantBranding[assistantId]) {
      const branding = settings.assistantBranding[assistantId];
      document.documentElement.style.setProperty("--assistant-accent", branding.accent || settings.brand.primaryColor);
      document.querySelectorAll("[data-assistant-logo]").forEach((node) => {
        renderMark(node, branding.logoUrl, branding.shortName || branding.name?.slice(0, 2));
      });
      document.querySelectorAll("[data-assistant-name]").forEach((node) => {
        node.textContent = branding.name;
      });
      const chatEmpty = document.querySelector("[data-chat-empty]");
      if (chatEmpty) {
        chatEmpty.textContent =
          assistantId === "service-chat" ? settings.chat.serviceWelcome : settings.chat.aiWelcome;
      }
      const videoLabel = document.getElementById("siteVideoLabel");
      if (videoLabel) {
        videoLabel.textContent = settings.chat.videoLabel;
      }
    }

    setFavicon(settings.brand.faviconUrl);
  };

  const ensureRuntimeStyle = () => {
    if (!state.styleEl) {
      state.styleEl = document.createElement("style");
      state.styleEl.id = "ais-runtime-style";
      document.head.appendChild(state.styleEl);
    }
    return state.styleEl;
  };

  const applyThemePalette = () => {
    const settings = state.settings;
    if (!settings) return;
    const theme = getTheme();
    document.documentElement.dataset.theme = theme;
    const base = settings.brand;
    const isNight = theme === "night";
    ensureRuntimeStyle().textContent = [
      ":root{",
      "--brand-primary:" + base.primaryColor + ";",
      "--brand-secondary:" + base.secondaryColor + ";",
      "--brand-gold:" + base.goldColor + ";",
      "}",
      "html[data-theme='night'] body{background:radial-gradient(circle at top left, color-mix(in srgb, " + base.primaryColor + " 22%, transparent), transparent 22%),radial-gradient(circle at top right, color-mix(in srgb, " + base.goldColor + " 18%, transparent), transparent 18%),linear-gradient(180deg,#09111d 0%,#10182a 100%);}",
      "html[data-theme='day'] body{background:radial-gradient(circle at top left, color-mix(in srgb, " + base.primaryColor + " 16%, transparent), transparent 22%),radial-gradient(circle at top right, color-mix(in srgb, " + base.goldColor + " 14%, transparent), transparent 18%),linear-gradient(180deg,#f7f2ea 0%,#fffdf9 100%);}",
      ".brand-mark,.mark{background:linear-gradient(135deg," + base.secondaryColor + "," + base.primaryColor + ") !important;}",
      ".button.primary,button.primary{background:linear-gradient(135deg," + base.secondaryColor + "," + base.primaryColor + ") !important;}",
      ".badge{background:color-mix(in srgb," + base.goldColor + " 16%, transparent) !important;}",
      ".success{color:" + (isNight ? "#7ce7bc" : "#176853") + " !important;}",
      ".error{color:" + (isNight ? "#ff8c79" : "#b34a3b") + " !important;}",
      "#aisCmsFab{background:linear-gradient(135deg," + base.secondaryColor + "," + base.primaryColor + ") !important;}",
    ].join("");
  };

  const fileToDataUrl = (file) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

  const ensureAdminUi = () => {
    if (state.user?.role !== "admin" || document.getElementById("aisCmsFab")) return;

    const style = document.createElement("style");
    style.textContent = \`
      #aisCmsFab{position:fixed;right:18px;bottom:18px;z-index:80;border:0;border-radius:999px;padding:14px 18px;color:#fff;font:inherit;font-weight:800;cursor:pointer;box-shadow:0 24px 50px rgba(0,0,0,.22)}
      #aisCmsPanel{position:fixed;top:18px;right:18px;width:min(420px,calc(100vw - 24px));max-height:calc(100vh - 36px);overflow:auto;z-index:90;padding:18px;border-radius:24px;border:1px solid rgba(16,32,51,.12);background:rgba(255,255,255,.96);box-shadow:0 32px 80px rgba(0,0,0,.18);display:none;backdrop-filter:blur(16px)}
      html[data-theme='night'] #aisCmsPanel{background:rgba(12,19,32,.96);border-color:rgba(255,255,255,.12);color:#eef6ff}
      #aisCmsPanel h3{margin:0 0 6px;font:700 1.1rem "Space Grotesk",sans-serif}
      #aisCmsPanel .cms-grid{display:grid;gap:14px}
      #aisCmsPanel .cms-group{padding:14px;border-radius:18px;background:rgba(16,32,51,.04);border:1px solid rgba(16,32,51,.08)}
      html[data-theme='night'] #aisCmsPanel .cms-group{background:rgba(255,255,255,.04);border-color:rgba(255,255,255,.08)}
      #aisCmsPanel label{display:grid;gap:6px;margin-bottom:10px;font-size:13px;font-weight:700}
      #aisCmsPanel input,#aisCmsPanel textarea{width:100%;border:1px solid rgba(16,32,51,.12);border-radius:14px;padding:10px 12px;font:inherit;background:#fff;color:#102033}
      html[data-theme='night'] #aisCmsPanel input,html[data-theme='night'] #aisCmsPanel textarea{background:#0f1726;color:#eef6ff;border-color:rgba(255,255,255,.14)}
      #aisCmsPanel textarea{min-height:92px;resize:vertical}
      #aisCmsPanel .cms-actions{display:flex;gap:10px;flex-wrap:wrap}
      #aisCmsPanel .cms-button{border:0;border-radius:999px;padding:11px 14px;font:inherit;font-weight:800;cursor:pointer}
      #aisCmsPanel .cms-primary{color:#fff}
      #aisCmsPanel .cms-secondary{background:rgba(16,32,51,.06);color:inherit;border:1px solid rgba(16,32,51,.08)}
      #aisCmsPanel .cms-note{font-size:12px;line-height:1.6;opacity:.78}
    \`;
    document.head.appendChild(style);

    const fab = document.createElement("button");
    fab.id = "aisCmsFab";
    fab.type = "button";
    fab.textContent = "Site edit";

    const panel = document.createElement("aside");
    panel.id = "aisCmsPanel";
    panel.innerHTML = \`
      <div class="cms-grid">
        <div class="cms-actions" style="justify-content:space-between;align-items:center;">
          <div>
            <h3>Site editor</h3>
            <div class="cms-note">Admin sifatida logo, favicon, landing matnlari va AI logolarini shu yerdan saqlaysiz.</div>
          </div>
          <button class="cms-button cms-secondary" type="button" id="aisCmsClose">Yopish</button>
        </div>
        <div class="cms-group">
          <h3>Brand</h3>
          <label>Site nomi<input name="brand.siteName" /></label>
          <label>Qisqa nom<input name="brand.shortName" /></label>
          <label>Tagline<input name="brand.tagline" /></label>
          <label>Primary color<input type="color" name="brand.primaryColor" /></label>
          <label>Secondary color<input type="color" name="brand.secondaryColor" /></label>
          <label>Gold color<input type="color" name="brand.goldColor" /></label>
          <label>Logo URL / Data URL<input name="brand.logoUrl" /></label>
          <div class="cms-actions"><input type="file" accept="image/*" id="aisLogoPicker" /></div>
          <label>Favicon URL / Data URL<input name="brand.faviconUrl" /></label>
          <div class="cms-actions"><input type="file" accept="image/*" id="aisFaviconPicker" /></div>
        </div>
        <div class="cms-group">
          <h3>Landing</h3>
          <label>Hero badge<input name="landing.heroBadge" /></label>
          <label>Hero title<textarea name="landing.heroTitle"></textarea></label>
          <label>Hero description<textarea name="landing.heroDescription"></textarea></label>
          <label>Section title<input name="landing.sectionTitle" /></label>
          <label>Section description<textarea name="landing.sectionDescription"></textarea></label>
          <label>Agro image<input name="landing.heroImages.agro" /></label>
          <input type="file" accept="image/*" id="landingAgroPicker" />
          <label>Doctor image<input name="landing.heroImages.doctor" /></label>
          <input type="file" accept="image/*" id="landingDoctorPicker" />
          <label>Lawyer image<input name="landing.heroImages.lawyer" /></label>
          <input type="file" accept="image/*" id="landingLawyerPicker" />
          <label>Private image<input name="landing.heroImages.private" /></label>
          <input type="file" accept="image/*" id="landingPrivatePicker" />
        </div>
        <div class="cms-group">
          <h3>Assistant logos</h3>
          <label>Agro AI logo<input name="assistantBranding.agro-ai.logoUrl" /></label>
          <input type="file" accept="image/*" id="agroLogoPicker" />
          <label>Doctor AI logo<input name="assistantBranding.doctor-ai.logoUrl" /></label>
          <input type="file" accept="image/*" id="doctorLogoPicker" />
          <label>Lawyer AI logo<input name="assistantBranding.lawyer-ai.logoUrl" /></label>
          <input type="file" accept="image/*" id="lawyerLogoPicker" />
          <label>Private AI logo<input name="assistantBranding.private-ai.logoUrl" /></label>
          <input type="file" accept="image/*" id="privateLogoPicker" />
          <label>Service chat logo<input name="assistantBranding.service-chat.logoUrl" /></label>
          <input type="file" accept="image/*" id="serviceLogoPicker" />
        </div>
        <div class="cms-actions">
          <button class="cms-button cms-primary" id="aisCmsSave" type="button">Saqlash</button>
          <div id="aisCmsStatus" class="cms-note"></div>
        </div>
      </div>
    \`;

    document.body.appendChild(fab);
    document.body.appendChild(panel);

    const fillForm = () => {
      const settings = state.settings;
      if (!settings) return;
      panel.querySelector('[name="brand.siteName"]').value = settings.brand.siteName || "";
      panel.querySelector('[name="brand.shortName"]').value = settings.brand.shortName || "";
      panel.querySelector('[name="brand.tagline"]').value = settings.brand.tagline || "";
      panel.querySelector('[name="brand.primaryColor"]').value = settings.brand.primaryColor || "#2a8a7d";
      panel.querySelector('[name="brand.secondaryColor"]').value = settings.brand.secondaryColor || "#102033";
      panel.querySelector('[name="brand.goldColor"]').value = settings.brand.goldColor || "#c88639";
      panel.querySelector('[name="brand.logoUrl"]').value = settings.brand.logoUrl || "";
      panel.querySelector('[name="brand.faviconUrl"]').value = settings.brand.faviconUrl || "";
      panel.querySelector('[name="landing.heroBadge"]').value = settings.landing.heroBadge || "";
      panel.querySelector('[name="landing.heroTitle"]').value = settings.landing.heroTitle || "";
      panel.querySelector('[name="landing.heroDescription"]').value = settings.landing.heroDescription || "";
      panel.querySelector('[name="landing.sectionTitle"]').value = settings.landing.sectionTitle || "";
      panel.querySelector('[name="landing.sectionDescription"]').value = settings.landing.sectionDescription || "";
      panel.querySelector('[name="landing.heroImages.agro"]').value = settings.landing.heroImages.agro || "";
      panel.querySelector('[name="landing.heroImages.doctor"]').value = settings.landing.heroImages.doctor || "";
      panel.querySelector('[name="landing.heroImages.lawyer"]').value = settings.landing.heroImages.lawyer || "";
      panel.querySelector('[name="landing.heroImages.private"]').value = settings.landing.heroImages.private || "";
      panel.querySelector('[name="assistantBranding.agro-ai.logoUrl"]').value = settings.assistantBranding["agro-ai"].logoUrl || "";
      panel.querySelector('[name="assistantBranding.doctor-ai.logoUrl"]').value = settings.assistantBranding["doctor-ai"].logoUrl || "";
      panel.querySelector('[name="assistantBranding.lawyer-ai.logoUrl"]').value = settings.assistantBranding["lawyer-ai"].logoUrl || "";
      panel.querySelector('[name="assistantBranding.private-ai.logoUrl"]').value = settings.assistantBranding["private-ai"].logoUrl || "";
      panel.querySelector('[name="assistantBranding.service-chat.logoUrl"]').value = settings.assistantBranding["service-chat"].logoUrl || "";
    };

    const bindFileInput = (inputId, targetName) => {
      const picker = panel.querySelector("#" + inputId);
      const target = panel.querySelector('[name="' + targetName + '"]');
      picker.addEventListener("change", async () => {
        const file = picker.files && picker.files[0];
        if (!file || !target) return;
        target.value = await fileToDataUrl(file);
      });
    };

    [
      ["aisLogoPicker", "brand.logoUrl"],
      ["aisFaviconPicker", "brand.faviconUrl"],
      ["landingAgroPicker", "landing.heroImages.agro"],
      ["landingDoctorPicker", "landing.heroImages.doctor"],
      ["landingLawyerPicker", "landing.heroImages.lawyer"],
      ["landingPrivatePicker", "landing.heroImages.private"],
      ["agroLogoPicker", "assistantBranding.agro-ai.logoUrl"],
      ["doctorLogoPicker", "assistantBranding.doctor-ai.logoUrl"],
      ["lawyerLogoPicker", "assistantBranding.lawyer-ai.logoUrl"],
      ["privateLogoPicker", "assistantBranding.private-ai.logoUrl"],
      ["serviceLogoPicker", "assistantBranding.service-chat.logoUrl"],
    ].forEach(([pickerId, targetName]) => bindFileInput(pickerId, targetName));

    fab.addEventListener("click", () => {
      fillForm();
      panel.style.display = panel.style.display === "block" ? "none" : "block";
    });
    panel.querySelector("#aisCmsClose").addEventListener("click", () => {
      panel.style.display = "none";
    });

    panel.querySelector("#aisCmsSave").addEventListener("click", async () => {
      const status = panel.querySelector("#aisCmsStatus");
      const next = JSON.parse(JSON.stringify(state.settings));
      next.brand.siteName = panel.querySelector('[name="brand.siteName"]').value;
      next.brand.shortName = panel.querySelector('[name="brand.shortName"]').value;
      next.brand.tagline = panel.querySelector('[name="brand.tagline"]').value;
      next.brand.primaryColor = panel.querySelector('[name="brand.primaryColor"]').value;
      next.brand.secondaryColor = panel.querySelector('[name="brand.secondaryColor"]').value;
      next.brand.goldColor = panel.querySelector('[name="brand.goldColor"]').value;
      next.brand.logoUrl = panel.querySelector('[name="brand.logoUrl"]').value;
      next.brand.faviconUrl = panel.querySelector('[name="brand.faviconUrl"]').value;
      next.landing.heroBadge = panel.querySelector('[name="landing.heroBadge"]').value;
      next.landing.heroTitle = panel.querySelector('[name="landing.heroTitle"]').value;
      next.landing.heroDescription = panel.querySelector('[name="landing.heroDescription"]').value;
      next.landing.sectionTitle = panel.querySelector('[name="landing.sectionTitle"]').value;
      next.landing.sectionDescription = panel.querySelector('[name="landing.sectionDescription"]').value;
      next.landing.heroImages.agro = panel.querySelector('[name="landing.heroImages.agro"]').value;
      next.landing.heroImages.doctor = panel.querySelector('[name="landing.heroImages.doctor"]').value;
      next.landing.heroImages.lawyer = panel.querySelector('[name="landing.heroImages.lawyer"]').value;
      next.landing.heroImages.private = panel.querySelector('[name="landing.heroImages.private"]').value;
      next.assistantBranding["agro-ai"].logoUrl = panel.querySelector('[name="assistantBranding.agro-ai.logoUrl"]').value;
      next.assistantBranding["doctor-ai"].logoUrl = panel.querySelector('[name="assistantBranding.doctor-ai.logoUrl"]').value;
      next.assistantBranding["lawyer-ai"].logoUrl = panel.querySelector('[name="assistantBranding.lawyer-ai.logoUrl"]').value;
      next.assistantBranding["private-ai"].logoUrl = panel.querySelector('[name="assistantBranding.private-ai.logoUrl"]').value;
      next.assistantBranding["service-chat"].logoUrl = panel.querySelector('[name="assistantBranding.service-chat.logoUrl"]').value;

      status.textContent = "Saqlanmoqda...";
      try {
        const response = await fetch("/api/site-settings", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ settings: next }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Saqlab bo'lmadi.");
        state.settings = data.settings;
        applyThemePalette();
        applyBranding();
        fillForm();
        status.textContent = "Saqlandi. Endi barcha sahifalarda bir xil ko'rinadi.";
      } catch (error) {
        status.textContent = error.message;
      }
    });
  };

  const boot = async () => {
    try {
      const [authRes, siteRes] = await Promise.all([
        fetch("/api/auth/me"),
        fetch("/api/site-settings"),
      ]);
      const auth = await authRes.json();
      const site = await siteRes.json();
      state.user = auth.user || null;
      state.settings = site.settings || null;
      if (!state.settings) return;
      applyThemePalette();
      applyBranding();
      ensureAdminUi();
    } catch (error) {
      console.error("Site kit xatosi:", error);
    }
  };

  boot();
})();`;
}

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function sortByUpdatedDesc(a, b) {
  return new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0);
}

function sortByCreatedDesc(a, b) {
  return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
}

function renderComingSoon(pathname) {
  const label = pathname.includes("slides") ? "Slides AI" : "Website AI";
  return `<!DOCTYPE html>
<html lang="uz">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${label} | ${APP_NAME}</title>
  <style>
    :root { color-scheme: dark; }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      background:
        radial-gradient(circle at top, rgba(146, 184, 255, 0.24), transparent 40%),
        linear-gradient(160deg, #08111f, #0f1b2d 55%, #080d18);
      color: #eff4ff;
      font-family: ui-sans-serif, system-ui, sans-serif;
    }
    main {
      width: min(680px, calc(100vw - 32px));
      border: 1px solid rgba(255,255,255,.12);
      border-radius: 28px;
      padding: 32px;
      background: rgba(9, 16, 29, 0.8);
      box-shadow: 0 30px 80px rgba(0,0,0,.35);
    }
    a {
      color: #96d0ff;
      text-decoration: none;
      font-weight: 700;
    }
  </style>
</head>
<body>
  <main>
    <p>Ai's Shelf</p>
    <h1>${label} hozircha alohida bosqichda ishlab chiqiladi.</h1>
    <p>Bu modulni keyinroq chuqurroq, alohida oqim bilan quramiz. Hozir faol yo'nalishlar: Agro AI, Doctor AI, Lawyer AI va Private AI.</p>
    <a href="/dashboard.html">Dashboardga qaytish</a>
  </main>
</body>
</html>`;
}

function renderNotFound() {
  return `<!DOCTYPE html>
<html lang="uz">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Sahifa topilmadi | ${APP_NAME}</title>
  <style>
    body { margin:0; min-height:100vh; display:grid; place-items:center; background:#08111b; color:#f5f7ff; font-family: ui-sans-serif, system-ui, sans-serif; }
    main { text-align:center; width:min(560px, calc(100vw - 32px)); }
    a { color:#7ce7ff; text-decoration:none; font-weight:700; }
  </style>
</head>
<body>
  <main>
    <h1>Bu sahifa topilmadi.</h1>
    <p>Ai's Shelf ichidagi yo'nalishlardan birini tanlab davom eting.</p>
    <a href="/">Bosh sahifaga qaytish</a>
  </main>
</body>
</html>`;
}

function loadEnvFile() {
  const envPath = path.join(__dirname, ".env");
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, "utf8");

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) continue;
    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}
