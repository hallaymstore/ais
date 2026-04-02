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
  storageMode: process.env.MONGODB_URI ? "mongodb-uri" : "memory",
  hallaymReady: Boolean(process.env.HALLAYM_API_KEY || process.env.GROQ_API_KEY),
  cloudinaryReady: Boolean(
    process.env.CLOUDINARY_CLOUD_NAME &&
      ((process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET) ||
        process.env.CLOUDINARY_UPLOAD_PRESET)
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

const assistantMap = new Map(ASSISTANTS.map((assistant) => [assistant.id, assistant]));

const memoryStore = {
  users: [],
  conversations: [],
};

const storage =
  APP_STATE.storageMode === "mongodb-uri"
    ? createMongoAdapter()
    : createMemoryAdapter();

const server = http.createServer(async (req, res) => {
  try {
    setSecurityHeaders(res);

    if (req.url === "/favicon.ico") {
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
      await sendStaticFile(res, path.join(PUBLIC_DIR, "index.html"));
      return;
    }

    const filePath = path.join(PUBLIC_DIR, pathname.replace(/^\/+/, ""));
    if (!filePath.startsWith(PUBLIC_DIR)) {
      sendJson(res, 403, { error: "Ruxsat yo'q." });
      return;
    }

    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      await sendStaticFile(res, filePath);
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
  await ensureAdminAccount();
  setInterval(cleanupSessions, 1000 * 60 * 10).unref();
}

async function routeApi(req, res, url, pathname, method) {
  if (pathname === "/api/config" && method === "GET") {
    sendJson(res, 200, {
      appName: APP_NAME,
      aiEngineName: AI_ENGINE_NAME,
      storageMode: APP_STATE.storageMode,
      hallaymReady: APP_STATE.hallaymReady,
      cloudinaryReady: APP_STATE.cloudinaryReady,
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

  if (pathname === "/api/auth/register" && method === "POST") {
    const body = await readJsonBody(req);
    const name = String(body.name || "").trim();
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");

    if (name.length < 2 || !isValidEmail(email) || password.length < 6) {
      sendJson(res, 400, {
        error: "Ism, email va kamida 6 belgili parol kerak.",
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
      role: "user",
      isActive: true,
      company: "",
      bio: "",
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
    sendJson(res, 200, {
      user: sanitizeUser(user),
      stats: buildUserStats(conversations),
      recentConversations: conversations.slice(0, 5).map(toConversationSummary),
    });
    return;
  }

  if (pathname === "/api/profile" && method === "PATCH") {
    const user = await requireAuth(req, res);
    if (!user) return;

    const body = await readJsonBody(req);
    const updates = {
      name: String(body.name || user.name).trim().slice(0, 80),
      company: String(body.company || "").trim().slice(0, 120),
      bio: String(body.bio || "").trim().slice(0, 400),
      updatedAt: nowIso(),
    };

    if (updates.name.length < 2) {
      sendJson(res, 400, { error: "Ism juda qisqa." });
      return;
    }

    await storage.updateUser(user.id, updates);
    sendJson(res, 200, {
      message: "Profil yangilandi.",
      user: sanitizeUser(await storage.findUserById(user.id)),
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

    const assistant = assistantMap.get(assistantId) || { slug: "shared" };
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

  const input = conversation.messages.slice(-10).map((item) => {
    if (item.role === "assistant") {
      return {
        role: "assistant",
        content: item.text,
      };
    }

    if (item.imageUrl) {
      return {
        role: "user",
        content: [
          {
            type: "input_text",
            text: item.text || "Foydalanuvchi rasm yubordi.",
          },
          {
            type: "input_image",
            detail: "auto",
            image_url: item.imageUrl,
          },
        ],
      };
    }

    return {
      role: "user",
      content: item.text,
    };
  });

  const model = imageUrl
    ? process.env.HALLAYM_VISION_MODEL ||
      "meta-llama/llama-4-scout-17b-16e-instruct"
    : process.env.HALLAYM_TEXT_MODEL || "llama-3.3-70b-versatile";

  const payload = {
    model,
    instructions: assistant.systemPrompt,
    input,
  };

  const response = await fetch("https://api.groq.com/openai/v1/responses", {
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

  const text = extractResponseText(data);
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

function extractResponseText(data) {
  if (typeof data?.output_text === "string" && data.output_text.trim()) {
    return data.output_text.trim();
  }

  if (Array.isArray(data?.output)) {
    const chunks = [];
    for (const item of data.output) {
      if (Array.isArray(item?.content)) {
        for (const contentItem of item.content) {
          if (contentItem?.text) chunks.push(contentItem.text);
          if (contentItem?.content?.[0]?.text) chunks.push(contentItem.content[0].text);
        }
      }
    }
    return chunks.join("\n").trim();
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

        try {
          await Promise.all([
            users.createIndex({ id: 1 }, { unique: true }),
            users.createIndex({ emailLower: 1 }, { unique: true }),
            conversations.createIndex({ id: 1 }, { unique: true }),
            conversations.createIndex({ userId: 1, updatedAt: -1 }),
            conversations.createIndex({ assistantId: 1, updatedAt: -1 }),
          ]);
        } catch (error) {
          console.warn("[Ai's Shelf] Mongo index warning:", error.message);
        }

        return { users, conversations };
      })();
    }

    return collectionsPromise;
  }

  const noInternalId = { projection: { _id: 0 } };

  return {
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

async function sendStaticFile(res, filePath) {
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

  const content = await fs.promises.readFile(filePath);
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
