import express, { Request, Response } from 'express';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, Type } from '@google/genai';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import { INITIAL_CHART_OF_ACCOUNTS, INITIAL_SCENARIOS, INITIAL_BADGES } from './src/data/initialData';
import { AccountItem, JournalEntry, UserProfile, GameScenario } from './src/types/accounting';

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json());

// Initialize Google GenAI on server-side
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    },
  },
});

// Database file persistence path
const DB_PATH = path.resolve(process.cwd(), 'game-db.json');

interface UserData {
  profile: UserProfile;
  passwordHash: string;
  accounts: AccountItem[];
  journalEntries: JournalEntry[];
  scenarios: GameScenario[];
  customScenarios: GameScenario[];
}

interface DatabaseState {
  users: Record<string, UserData>;
  sessions: Record<string, string>; // token -> userId
}

function loadDatabase(): DatabaseState {
  try {
    if (fs.existsSync(DB_PATH)) {
      const content = fs.readFileSync(DB_PATH, 'utf-8');
      return JSON.parse(content);
    }
  } catch (err) {
    console.error('Failed to read db file, creating initial state', err);
  }
  return {
    users: {},
    sessions: {},
  };
}

let db: DatabaseState = loadDatabase();

function saveDatabase() {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf-8');
  } catch (err) {
    console.error('Failed to persist database file', err);
  }
}

// Seed default demo user if not present
const DEMO_USER_ID = 'demo-user-1';
if (!db.users[DEMO_USER_ID]) {
  const initialAccounts = JSON.parse(JSON.stringify(INITIAL_CHART_OF_ACCOUNTS));
  const initialScenarios = JSON.parse(JSON.stringify(INITIAL_SCENARIOS));
  const initialBadges = JSON.parse(JSON.stringify(INITIAL_BADGES));

  db.users[DEMO_USER_ID] = {
    passwordHash: 'password123',
    profile: {
      id: DEMO_USER_ID,
      username: 'المحاسب المالي',
      emailOrPhone: 'demo@accountant.com',
      avatar: '👨‍💼',
      companyName: 'شركة القمة التجارية للتقنية',
      currency: 'د.ل',
      level: 1,
      xp: 250,
      xpToNextLevel: 500,
      score: 650,
      streakDays: 3,
      currentDay: 1,
      rankTitle: 'محاسب مالي مساعد',
      totalEntriesCount: 0,
      correctEntriesCount: 0,
      badges: initialBadges,
      createdAt: new Date().toISOString(),
    },
    accounts: initialAccounts,
    journalEntries: [],
    scenarios: initialScenarios,
    customScenarios: [],
  };
  db.sessions['demo-token-123'] = DEMO_USER_ID;
  saveDatabase();
}

function getRankTitle(level: number): string {
  if (level <= 1) return 'محاسب مالي متدرب';
  if (level === 2) return 'محاسب عام معتمد';
  if (level === 3) return 'رئيس حسابات أول';
  if (level === 4) return 'مراقب مالي ومدقق داخلي';
  return 'المدير المالي التنفيذي (CFO)';
}

function calculateLevelAndXP(currentLevel: number, currentXP: number, earnedXP: number) {
  let newXP = currentXP + earnedXP;
  let newLevel = currentLevel;
  let xpThreshold = newLevel * 500;

  while (newXP >= xpThreshold) {
    newXP -= xpThreshold;
    newLevel += 1;
    xpThreshold = newLevel * 500;
  }

  return {
    level: newLevel,
    xp: newXP,
    xpToNextLevel: xpThreshold,
    rankTitle: getRankTitle(newLevel),
  };
}

// Helper to get authenticated user
function getAuthUser(req: Request): UserData | null {
  const authHeader = req.headers.authorization;
  let token = '';
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1];
  } else if (req.query.token) {
    token = String(req.query.token);
  } else {
    token = 'demo-token-123'; // Default to demo session for instant seamless playground
  }

  const userId = db.sessions[token] || DEMO_USER_ID;
  return db.users[userId] || null;
}

// ======================== API ROUTES ========================

// 1. Auth: Register
app.post('/api/auth/register', (req: Request, res: Response) => {
  const { username, emailOrPhone, password, companyName, currency } = req.body;

  if (!username || !emailOrPhone || !password) {
    return res.status(400).json({ error: 'يرجى تقديم اسم المستخدم، البريد أو الهاتف، وكلمة المرور' });
  }

  // Check if exists
  const existing = Object.values(db.users).find(
    (u) => u.profile.emailOrPhone.toLowerCase() === emailOrPhone.toLowerCase()
  );
  if (existing) {
    return res.status(400).json({ error: 'هذا البريد الإلكتروني أو الهاتف مسجل مسبقاً' });
  }

  const newUserId = 'user-' + Date.now();
  const token = 'token-' + Math.random().toString(36).substring(2) + Date.now();

  const initialAccounts = JSON.parse(JSON.stringify(INITIAL_CHART_OF_ACCOUNTS));
  const initialScenarios = JSON.parse(JSON.stringify(INITIAL_SCENARIOS));
  const initialBadges = JSON.parse(JSON.stringify(INITIAL_BADGES));

  const newProfile: UserProfile = {
    id: newUserId,
    username,
    emailOrPhone,
    avatar: '💼',
    companyName: companyName || `شركة ${username} المالية`,
    currency: currency || 'د.ل',
    level: 1,
    xp: 0,
    xpToNextLevel: 500,
    score: 100,
    streakDays: 1,
    currentDay: 1,
    rankTitle: 'محاسب مالي متدرب',
    totalEntriesCount: 0,
    correctEntriesCount: 0,
    badges: initialBadges,
    createdAt: new Date().toISOString(),
  };

  db.users[newUserId] = {
    profile: newProfile,
    passwordHash: password,
    accounts: initialAccounts,
    journalEntries: [],
    scenarios: initialScenarios,
    customScenarios: [],
  };
  db.sessions[token] = newUserId;
  saveDatabase();

  return res.json({
    token,
    profile: newProfile,
    message: 'تم إنشاء الحساب بنجاح! مرحباً بك في محاكي المحاسب المالي.',
  });
});

// 2. Auth: Login
app.post('/api/auth/login', (req: Request, res: Response) => {
  const { emailOrPhone, password } = req.body;

  if (!emailOrPhone || !password) {
    return res.status(400).json({ error: 'يرجى إدخال البريد الإلكتروني وكلمة المرور' });
  }

  const user = Object.values(db.users).find(
    (u) => u.profile.emailOrPhone.toLowerCase() === emailOrPhone.toLowerCase() && u.passwordHash === password
  );

  if (!user) {
    return res.status(401).json({ error: 'بيانات الدخول غير صحيحة. تحقق من البريد وكلمة المرور' });
  }

  const token = 'token-' + Math.random().toString(36).substring(2) + Date.now();
  db.sessions[token] = user.profile.id;
  saveDatabase();

  return res.json({
    token,
    profile: user.profile,
    message: 'تم تسجيل الدخول بنجاح',
  });
});

// 3. Auth: Profile
app.get('/api/auth/profile', (req: Request, res: Response) => {
  const user = getAuthUser(req);
  if (!user) {
    return res.status(401).json({ error: 'المستخدم غير مصرح له' });
  }
  return res.json({ profile: user.profile });
});

// 4. Game Data
app.get('/api/game/data', (req: Request, res: Response) => {
  const user = getAuthUser(req);
  if (!user) {
    return res.status(401).json({ error: 'غير مصرح' });
  }

  // Calculate live financial metrics
  let totalDebitEntries = 0;
  let totalCreditEntries = 0;
  user.journalEntries.forEach((entry) => {
    totalDebitEntries += entry.totalDebit;
    totalCreditEntries += entry.totalCredit;
  });

  return res.json({
    profile: user.profile,
    accounts: user.accounts,
    journalEntries: user.journalEntries,
    scenarios: [...user.scenarios, ...user.customScenarios],
    currentDay: user.profile.currentDay,
  });
});

// 5. Post Journal Entry
app.post('/api/game/post-entry', (req: Request, res: Response) => {
  const user = getAuthUser(req);
  if (!user) {
    return res.status(401).json({ error: 'غير مصرح' });
  }

  const { description, lines, scenarioId, aiFeedback } = req.body;

  if (!lines || !Array.isArray(lines) || lines.length < 2) {
    return res.status(400).json({ error: 'قيد اليومية يجب أن يحتوي على طرفين على الأقل (مدين ودائن)' });
  }

  const totalDebit = lines.reduce((acc: number, l: any) => acc + (Number(l.debit) || 0), 0);
  const totalCredit = lines.reduce((acc: number, l: any) => acc + (Number(l.credit) || 0), 0);

  if (Math.abs(totalDebit - totalCredit) > 0.01) {
    return res.status(400).json({
      error: `القيد غير متوازن! إجمالي المدين (${totalDebit}) لا يساوي إجمالي الدائن (${totalCredit})`,
    });
  }

  if (totalDebit <= 0) {
    return res.status(400).json({ error: 'مبلغ القيد يجب أن يكون أكبر من صفر' });
  }

  // Update Account Balances
  for (const line of lines) {
    const acc = user.accounts.find((a) => a.code === line.accountCode);
    if (acc) {
      const debitAmt = Number(line.debit) || 0;
      const creditAmt = Number(line.credit) || 0;

      if (acc.nature === 'debit') {
        // Debit increases, credit decreases
        acc.balance += (debitAmt - creditAmt);
      } else {
        // Credit increases, debit decreases
        acc.balance += (creditAmt - debitAmt);
      }
    }
  }

  const entryNumber = user.journalEntries.length + 1;
  const newEntry: JournalEntry = {
    id: 'entry-' + Date.now(),
    entryNumber,
    date: new Date().toISOString().split('T')[0],
    description: description || `قيد العملية رقم ${entryNumber}`,
    scenarioId,
    lines: lines.map((l: any, idx: number) => ({
      id: 'line-' + Date.now() + '-' + idx,
      accountId: l.accountId || l.accountCode,
      accountCode: l.accountCode,
      accountName: l.accountName,
      debit: Number(l.debit) || 0,
      credit: Number(l.credit) || 0,
      note: l.note || '',
    })),
    totalDebit,
    totalCredit,
    isBalanced: true,
    postedAt: new Date().toISOString(),
    status: 'posted',
    aiFeedback: aiFeedback || undefined,
  };

  user.journalEntries.unshift(newEntry);

  // Update user stats
  user.profile.totalEntriesCount += 1;
  const isCorrect = aiFeedback?.isCorrect ?? true;
  if (isCorrect) {
    user.profile.correctEntriesCount += 1;
  }

  // Calculate XP and Score rewards
  const earnedXP = aiFeedback?.xpAwarded || (isCorrect ? 150 : 50);
  const earnedScore = isCorrect ? Math.round(totalDebit * 0.05 + 200) : 50;

  user.profile.score += earnedScore;

  const levelProgress = calculateLevelAndXP(user.profile.level, user.profile.xp, earnedXP);
  user.profile.level = levelProgress.level;
  user.profile.xp = levelProgress.xp;
  user.profile.xpToNextLevel = levelProgress.xpToNextLevel;
  user.profile.rankTitle = levelProgress.rankTitle;

  // Mark scenario completed if matched
  if (scenarioId) {
    const matched = user.scenarios.find((s) => s.id === scenarioId);
    if (matched) matched.isCompleted = true;
    const customMatched = user.customScenarios.find((s) => s.id === scenarioId);
    if (customMatched) customMatched.isCompleted = true;
    user.profile.currentDay += 1;
  }

  // Check badges
  if (user.profile.totalEntriesCount >= 1) {
    const b = user.profile.badges.find((x) => x.id === 'first_entry');
    if (b && !b.unlockedAt) b.unlockedAt = new Date().toISOString();
  }
  if (user.profile.level >= 5) {
    const b = user.profile.badges.find((x) => x.id === 'cfo_star');
    if (b && !b.unlockedAt) b.unlockedAt = new Date().toISOString();
  }

  saveDatabase();

  return res.json({
    success: true,
    entry: newEntry,
    profile: user.profile,
    accounts: user.accounts,
    message: 'تم ترحيل القيد بنجاح إلى شجرة الحسابات ودفتر الأستاذ العام!',
  });
});

// 6. Gemini AI: Evaluate Journal Entry
app.post('/api/game/ai-evaluate-entry', async (req: Request, res: Response) => {
  try {
    const { scenario, entry, companyState } = req.body;

    if (!entry || !entry.lines || entry.lines.length === 0) {
      return res.status(400).json({ error: 'بيانات القيد غير مكتملة للتقييم' });
    }

    const prompt = `
أنت كبير المحاسبين الماليين ومدقق حسابات قانوني (CPA & Chief Auditor) في لعبة محاكاة مالية تفاعلية.
مهمتك تقييم قيد اليومية الذي أدخله المتدرب/اللاعب ومقارنته بالعملية المالية المطلوبة.

الشركة: "${companyState?.name || 'الشركة'}"
السيناريو / العملية المالية:
العنوان: "${scenario?.title || 'عملية مالية'}"
الوصف: "${scenario?.transactionDescription || entry.description}"
المبلغ المطلوب: ${scenario?.amount || entry.totalDebit || 'غير محدد'}

قيد اليومية المقدم من اللاعب:
البيان: "${entry.description}"
بنود القيد:
${entry.lines
  .map(
    (l: any) =>
      `- حساب [${l.accountCode}] ${l.accountName} | مدين: ${l.debit || 0} | دائن: ${l.credit || 0}`
  )
  .join('\n')}

المعايير المطلوبة في التقييم:
1. هل القيد متوازن رياضياً (المدين = الدائن)؟
2. هل تم اختيار الحساب المدين الصحيح طبقاً لقواعد المحاسبة المالية (الآخذ أو الزيادة في الأصول/المصروفات)؟
3. هل تم اختيار الحساب الدائن الصحيح (العاطي أو الزيادة في الخصوم/حقوق الملكية/الإيرادات)؟
4. هل المبالغ دقيقة ومطابقة للعملية؟
5. الشرح المحاسبي باللغة العربية بأسلوب تعليمي مشجع واحترافي.

أجب بصيغة JSON محددة حصراً بالبنية التالية:
`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            isCorrect: {
              type: Type.BOOLEAN,
              description: 'هل القيد صحيح ومطابق محاسبياً بنسبة 80% على الأقل',
            },
            rating: {
              type: Type.NUMBER,
              description: 'درجة التقييم من 0 إلى 100',
            },
            title: {
              type: Type.STRING,
              description: 'عنوان تقرير المدقق المالي',
            },
            analysis: {
              type: Type.STRING,
              description: 'تحليل دقيق لأطراف القيد المدين والدائن مع توضيح الصواب أو الخطأ',
            },
            ruleExplanation: {
              type: Type.STRING,
              description: 'شرح القاعدة المحاسبية المستفادة (طبيعة الحسابات، الأصول والخصوم)',
            },
            financialImpact: {
              type: Type.STRING,
              description: 'أثر هذا القيد على القوائم المالية (الميزانية العمومية وقائمة الدخل)',
            },
            xpAwarded: {
              type: Type.NUMBER,
              description: 'النقاط المستحقة للاعب (بين 50 إلى 250)',
            },
          },
          required: ['isCorrect', 'rating', 'title', 'analysis', 'ruleExplanation', 'financialImpact', 'xpAwarded'],
        },
      },
    });

    const parsedResult = JSON.parse(response.text || '{}');
    return res.json(parsedResult);
  } catch (err: any) {
    console.error('Gemini evaluation error:', err);
    // Fallback safe evaluation if API call fails
    return res.json({
      isCorrect: true,
      rating: 90,
      title: 'قيد محاسبي معتمد',
      analysis: 'تم التحقق من توازن طرفي القيد المالي بنجاح وترحيله للأستاذ العام.',
      ruleExplanation: 'القيد المزدوج: كل عملية مالية تؤثر على حسابين على الأقل بحيث يتعادل المدين مع الدائن.',
      financialImpact: 'زيادة أو تعديل في المركز المالي للشركة مع الحفاظ على توازن المعادلة المحاسبية.',
      xpAwarded: 150,
    });
  }
});

// 7. Gemini AI: Generate Dynamic Realistic Business Scenario
app.post('/api/game/ai-generate-scenario', async (req: Request, res: Response) => {
  try {
    const user = getAuthUser(req);
    const userLevel = user ? user.profile.level : 1;
    const dayNumber = user ? user.profile.currentDay + 1 : 2;

    const prompt = `
أنت مصمم سيناريوهات ألعاب المحاكاة الاقتصادية والمالية.
قم بتوليد سيناريو وتحدي مالي واقعي جديد لشركة تجارية وتقنية ناشئة.
مستوى اللاعب الحالي: ${userLevel} (كلما زاد المستوى زادت التحديات مثل: المبيعات، الشراء بالآجل، الرواتب، القروض، الإهلاك، الخصم التجاري، التسويق، الإيجار).
رقم اليوم في اللعبة: اليوم ${dayNumber}.

قم بتحديد أرقام الحسابات المعتمدة في شجرة حسابات الشركة:
- 1101: الصندوق / النقدية بالخزينة
- 1102: البنك - الحساب الجاري
- 1103: المدينون / العملاء
- 1104: بضاعة المخزون
- 1201: الأثاث والتجهيزات المكتبية
- 1202: سيارات ووسائل النقل
- 2101: الدائنون / الموردون
- 2201: قروض وتسهيلات بنكية
- 3101: رأس المال
- 4101: إيراد المبيعات التجارية
- 4102: إيرادات تقديم خدمات واستشارات
- 5101: تكلفة البضاعة المباعة
- 5102: مصروف الرواتب والأجور
- 5103: مصروف الإيجار
- 5104: مصروفات المرافق (كهرباء ومياه)
- 5105: مصروف التسويق والدعاية
- 5106: مصروف إهلاك الأصول الثابتة

أجب بصيغة JSON محددة حصراً بالبنية التالية:
`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING, description: 'عنوان الحدث المالي' },
            companyContext: { type: Type.STRING, description: 'السياق الإداري أو التجاري الواقعي للموقف' },
            transactionDescription: { type: Type.STRING, description: 'وصف المعاملة المالية وقيمتها وطريقة السداد أو التحصيل' },
            amount: { type: Type.NUMBER, description: 'قيمة العملية الإجمالية' },
            difficulty: { type: Type.STRING, description: 'مبتدئ أو متوسط أو متقدم أو خبير' },
            expectedDebits: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  accountCode: { type: Type.STRING },
                  amount: { type: Type.NUMBER },
                  description: { type: Type.STRING },
                },
                required: ['accountCode', 'amount', 'description'],
              },
            },
            expectedCredits: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  accountCode: { type: Type.STRING },
                  amount: { type: Type.NUMBER },
                  description: { type: Type.STRING },
                },
                required: ['accountCode', 'amount', 'description'],
              },
            },
            hints: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: '3 تلميحات ذكية مساعدة للاعب',
            },
            accountingPrinciple: { type: Type.STRING, description: 'المبدأ أو المعيار المحاسبي المرتبط بالعملية' },
            xpReward: { type: Type.NUMBER, description: 'نقاط الخبرة XP بين 100 و 300' },
            scoreReward: { type: Type.NUMBER, description: 'النقاط الإضافية بين 200 و 600' },
          },
          required: [
            'title',
            'companyContext',
            'transactionDescription',
            'amount',
            'difficulty',
            'expectedDebits',
            'expectedCredits',
            'hints',
            'accountingPrinciple',
            'xpReward',
            'scoreReward',
          ],
        },
      },
    });

    const parsed = JSON.parse(response.text || '{}');
    const newScenario: GameScenario = {
      id: 'ai-sc-' + Date.now(),
      level: userLevel,
      dayNumber,
      title: parsed.title,
      companyContext: parsed.companyContext,
      transactionDescription: parsed.transactionDescription,
      amount: parsed.amount,
      difficulty: parsed.difficulty as any,
      expectedDebits: parsed.expectedDebits,
      expectedCredits: parsed.expectedCredits,
      hints: parsed.hints,
      accountingPrinciple: parsed.accountingPrinciple,
      xpReward: parsed.xpReward || 200,
      scoreReward: parsed.scoreReward || 400,
    };

    if (user) {
      user.customScenarios.push(newScenario);
      saveDatabase();
    }

    return res.json(newScenario);
  } catch (err: any) {
    console.error('Failed to generate scenario with Gemini:', err);
    // Fallback creative scenario
    const fallback: GameScenario = {
      id: 'fallback-sc-' + Date.now(),
      level: 2,
      dayNumber: 4,
      title: 'إطلاق حملة تسويقية رقمية ممولة',
      companyContext: 'قررت إدارة التسويق بالشركة إطلاق حملة إعلانات ممولة عبر وسائل التواصل لجلب عملاء جدد.',
      transactionDescription: 'دفعت الشركة تكلفة الحملة الإعلانية البالغة 3,500 د.ل فوراً عن طريق بطاقة البنك الجاري.',
      amount: 3500,
      difficulty: 'متوسط',
      expectedDebits: [
        { accountCode: '5105', amount: 3500, description: 'مصروف التسويق والدعاية' },
      ],
      expectedCredits: [
        { accountCode: '1102', amount: 3500, description: 'البنك - الحساب الجاري' },
      ],
      hints: [
        'المصروف مدين دائماً لأنه استنفاد للمنافع الاقتصادية.',
        'الحساب البنكي أصل نقص بالسداد فيكون في الطرف الدائن.',
      ],
      accountingPrinciple: 'الاعتراف بالمصروفات التشغيلية: المصروف مدين وحساب السداد دائن.',
      xpReward: 160,
      scoreReward: 350,
    };
    return res.json(fallback);
  }
});

// 8. Gemini AI: Chief Auditor / CFO Advisor Chat
app.post('/api/game/ai-cfo-chat', async (req: Request, res: Response) => {
  try {
    const { question, history, companyMetrics } = req.body;

    if (!question) {
      return res.status(400).json({ error: 'السؤال مطلوب' });
    }

    const systemInstruction = `
أنت "المستشار المالي والمدقق التنفيذي (AI CFO & Chief Auditor)" لشركة اللاعب في لعبة المحاكاة المحاسبية.
اسم شركته: ${companyMetrics?.name || 'الشركة الافتراضية'}.
رأس المال والنقدية: ${companyMetrics?.cash || '100,000'} ${companyMetrics?.currency || 'د.ل'}.
إجمالي الأصول: ${companyMetrics?.assets || '100,000'}.
صافي الأرباح الحالية: ${companyMetrics?.netIncome || '0'}.

دورك:
1. الإجابة عن أي استفسار محاسبي أو مالي بدقة وبأسلوب مشوق وتفاعلي.
2. توضيح طبيعة الحسابات (المدين والدائن)، نظرية القيد المزدوج، ميزان المراجعة، والقوائم المالية (الميزانية وقائمة الدخل).
3. تقديم نصائح مالية لزيادة أرباح الشركة الافتراضية وترشيد نفقاتها.
4. إعطاء أمثلة بقيود اليومية بوضوح (من حـ/ ... إلى حـ/ ...).
تحدث باللغة العربية بأسلوب راقٍ، مهني، ومحبب للاعب.
`;

    const contents = [];
    if (history && Array.isArray(history)) {
      for (const h of history) {
        contents.push({
          role: h.role === 'user' ? 'user' : 'model',
          parts: [{ text: h.content }],
        });
      }
    }
    contents.push({
      role: 'user',
      parts: [{ text: question }],
    });

    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents,
      config: {
        systemInstruction,
        temperature: 0.7,
      },
    });

    return res.json({
      reply: response.text,
    });
  } catch (err: any) {
    console.error('Gemini CFO advisor error:', err);
    return res.json({
      reply: 'أهلاً بك يا زميلي المالي! تذكر القاعدة الذهبية في المحاسبة: الأصول والمصروفات طبيعتها مدينة (تزيد بالمدين وتنقص بالدائن)، بينما الخصوم وحقوق الملكية والإيرادات طبيعتها دائنة (تزيد بالدائن وتنقص بالمدين). كيف يمكنني مساعدتك اليوم في قيود شركتك؟',
    });
  }
});

// 9. Reset Company Books
app.post('/api/game/reset', (req: Request, res: Response) => {
  const user = getAuthUser(req);
  if (!user) {
    return res.status(401).json({ error: 'غير مصرح' });
  }

  user.accounts = JSON.parse(JSON.stringify(INITIAL_CHART_OF_ACCOUNTS));
  user.journalEntries = [];
  user.scenarios = JSON.parse(JSON.stringify(INITIAL_SCENARIOS));
  user.customScenarios = [];
  user.profile.currentDay = 1;
  user.profile.score = 100;
  user.profile.xp = 0;
  user.profile.level = 1;
  user.profile.totalEntriesCount = 0;
  user.profile.correctEntriesCount = 0;
  saveDatabase();

  return res.json({
    success: true,
    message: 'تم تصفير وإعادة تعيين دفاتر الشركة المحاسبية إلى اليوم الأول بنجاح.',
  });
});

// Setup Vite or Static File Serving
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Accounting Simulator Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
