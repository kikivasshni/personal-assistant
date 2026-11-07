import type { Ionicons } from '@expo/vector-icons';
import type { Icon3DName } from '@/components/Icon3D';
import { palette } from '@/theme';

// Kairos is organised into spaces (areas of life). Each space has a coach
// persona and one or more cards. A card is either a focused coach thread
// (a chat with its own focus, context panel and Notion home) or a tool screen.

export type IconName = keyof typeof Ionicons.glyphMap;

export type SpaceId =
  | 'hq'
  | 'manifest'
  | 'health'
  | 'academics'
  | 'motivation'
  | 'career'
  | 'hobbies'
  | 'finance'
  | 'wellbeing';

export type ToolName =
  | 'create_commitment'
  | 'complete_commitment'
  | 'list_commitments'
  | 'remember_fact'
  | 'add_task'
  | 'list_tasks'
  | 'complete_task'
  | 'add_calendar_event'
  | 'list_calendar_events'
  | 'notion_search'
  | 'notion_read'
  | 'notion_write'
  | 'save_note'
  | 'log_food'
  | 'log_workout'
  | 'log_cycle'
  | 'health_data'
  | 'log_practice'
  | 'save_song'
  | 'save_desire'
  | 'find_clips';

// Live panels shown at the top of a thread's chat.
export type PanelKind = 'food' | 'move' | 'cycle' | 'study' | 'guitar' | 'practice' | 'desires' | 'advisor';

export type Thread = {
  id: string;
  space: SpaceId;
  title: string;
  subtitle: string;
  icon: Icon3DName | string;
  focus: string;
  starters: string[];
  panel?: PanelKind;
  // Cards that open a tool screen instead of a chat.
  route?: string;
  extraTools?: ToolName[];
  custom?: boolean;
  // Notion notebook this card's notes live in, and the area it belongs to.
  notebook?: string;
  area?: string;
};

export type Space = {
  id: SpaceId;
  name: string;
  tagline: string;
  icon: Icon3DName;
  tint: string;
  deep: string;
  persona: string;
  tools: ToolName[];
  feedSeeds: string[];
  threads: Thread[];
  // Lets you add your own cards (study topics, hobbies).
  add?: { label: string; noun: string; panel: PanelKind };
};

const CORE: ToolName[] = ['create_commitment', 'complete_commitment', 'list_commitments', 'remember_fact'];
const TASKS: ToolName[] = ['add_task', 'list_tasks', 'complete_task'];
const CAL: ToolName[] = ['add_calendar_event', 'list_calendar_events'];
const NOTION: ToolName[] = ['notion_search', 'notion_read', 'notion_write', 'save_note'];

const TAB_RULES = `When you show guitar tabs, put each riff in a fenced code block that starts with \`\`\`tab, six string lines (e|B|G|D|A|E), at most 32 characters wide so it fits a phone screen. Split longer riffs into several numbered blocks, with a one-line tip on technique or counting under each.`;

export const SPACES: Space[] = [
  {
    id: 'hq',
    name: 'Planner',
    tagline: 'Plans your day across every area',
    icon: 'planner',
    tint: palette.lavender,
    deep: palette.lavenderDeep,
    persona: `You are kirthi's planner: an executive PA and chief of staff inside the Kairos app. You see every coach's notes and keep the whole life coherent: you plan the day and the week, keep the to-do list honest (Today vs This week), resolve conflicts between goals, run the morning briefing and evening audit, and chase anything overdue. Anticipate needs like a high-level corporate PA. Be crisp, warm and direct.`,
    tools: [...CORE, ...TASKS, ...CAL, ...NOTION, 'find_clips'],
    feedSeeds: ['high performance daily routine', 'discipline motivation'],
    threads: [
      {
        id: 'hq',
        space: 'hq',
        title: 'Planner',
        subtitle: 'Your chief of staff',
        icon: 'planner',
        focus: '',
        starters: ['Plan my day', 'Plan my week', 'What am I behind on?', 'Run my evening audit'],
      },
    ],
  },
  {
    id: 'health',
    name: 'Health',
    tagline: 'Food, training and PCOS',
    icon: 'health',
    tint: palette.rose,
    deep: palette.roseDeep,
    persona: `You are kirthi's health coach: a personal trainer, sports nutritionist and PCOS specialist in one. kirthi manages PCOS without medication, so everything prioritises insulin sensitivity: protein and fibre first, lower glycaemic load, strength training, walking after meals, sleep and stress. They ran a half marathon on 1 Nov 2026; the goals now are fat loss and muscle strengthening with consistency. You can read their Samsung Health data (steps, workouts, sleep, weight, cycle) with health_data. Be direct and specific, give exact numbers, sets, reps and foods. kirthi knows to see a doctor when needed, so never add medical disclaimers or tell them to consult a professional.`,
    tools: [...CORE, ...TASKS, ...CAL, ...NOTION, 'log_food', 'log_workout', 'log_cycle', 'health_data', 'find_clips'],
    feedSeeds: ['pilates body workout', 'PCOS friendly meals', 'model workout routine'],
    threads: [
      {
        id: 'health.food',
        space: 'health',
        title: 'Food & diet',
        subtitle: 'Meals, macros and what to change',
        icon: 'food',
        panel: 'food',
        focus: `This card is the food and diet tracker. Log meals they describe with log_food. Review the day's and week's eating against a PCOS fat-loss plan (protein target ~1.6 g/kg, fibre 25 g+, low GL carbs paired with protein) and give 1–3 concrete changes. Suggest meals and swaps that fit Singapore food (hawker, cai fan, etc.).`,
        starters: ['Rate what I ate today', 'What should I change this week?', 'Plan a PCOS-friendly dinner'],
      },
      {
        id: 'health.move',
        space: 'health',
        title: 'Workouts',
        subtitle: 'Training, steps and progress',
        icon: 'workout',
        panel: 'move',
        focus: `This card is the training coach. When kirthi reports exercise, log it with log_workout. Read Samsung Health steps and sessions with health_data before judging the week. Programme for fat loss plus muscle strengthening: 3 strength sessions a week (progressive overload, compound lifts, glutes and back), daily step target 8–10k, Zone 2 cardio, and post-meal walks for insulin. Give today's session as a clear list of exercises × sets × reps.`,
        starters: ["What's my workout today?", 'How was my week?', 'Build me a 4-week strength plan'],
      },
      {
        id: 'health.pcos',
        space: 'health',
        title: 'PCOS & cycle',
        subtitle: 'Cycle tracking and phase-based advice',
        icon: 'pcos',
        panel: 'cycle',
        focus: `This card is PCOS and cycle management. Use the cycle data in context (period starts from Samsung Health and manual logs, cycle lengths, current phase). Give phase-aware advice on training intensity, food, supplements commonly used for PCOS (inositol, magnesium, vitamin D, omega-3, spearmint tea) with typical doses, symptom management, and how to make cycles more regular. Log periods or symptoms they mention with log_cycle.`,
        starters: ['What phase am I in?', 'How do I make my cycle regular?', 'What should I eat this phase?'],
      },
    ],
  },
  {
    id: 'academics',
    name: 'Study',
    tagline: 'Certifications, school and new topics',
    icon: 'study',
    tint: palette.sky,
    deep: palette.skyDeep,
    persona: `You are kirthi's study coach with a "toxic study motivation" vibe: ruthless, cutting, gets in their head, refuses excuses, but always on their side. kirthi is Year 4 Software Engineering at SMU (graduating May 2027) and interning until 8 Jan 2027. Push daily study blocks, quiz them with exam-style questions one at a time and explain answers, and make them commit to specific hours. Log study sessions with log_practice. Keep their Notion notes for this topic up to date: when they learn something, write it into the right page in the same structure as their existing notes.`,
    tools: [...CORE, ...TASKS, ...CAL, ...NOTION, 'log_practice', 'find_clips'],
    feedSeeds: ['study with me motivation', 'AWS solutions architect professional tips', 'terraform associate'],
    add: { label: 'Add a topic', noun: 'topic', panel: 'study' },
    threads: [
      {
        id: 'study.aws',
        space: 'academics',
        title: 'AWS SAP-C03',
        subtitle: 'Solutions Architect Professional',
        icon: 'cloud',
        panel: 'study',
        notebook: 'AWS',
        area: 'coding',
        focus: `This card is the AWS Certified Solutions Architect – Professional (SAP-C03) exam. Cover the domains: designing for organisational complexity, designing new solutions, continuous improvement of existing solutions, and accelerating migration and modernisation. Quiz with long scenario questions in the real exam style (4–5 options, "most cost-effective / least operational overhead"), and explain why each wrong option is wrong.`,
        starters: ['Quiz me, exam style', 'What are my weak domains?', 'Plan my study to exam day'],
      },
      {
        id: 'study.terraform',
        space: 'academics',
        title: 'Terraform Associate',
        subtitle: 'HashiCorp Certified',
        icon: 'terraform',
        panel: 'study',
        notebook: 'Terraform Associate',
        area: 'coding',
        focus: `This card is the HashiCorp Certified Terraform Associate exam. Cover IaC concepts, Terraform workflow, state, modules, providers, variables and outputs, the CLI, HCP Terraform, and import/refactoring. Quiz in the real exam style (multiple choice, multi-select, true/false) and give short HCL examples.`,
        starters: ['Quiz me, exam style', 'Explain state like I am new', 'Plan my study to exam day'],
      },
      {
        id: 'study.school',
        space: 'academics',
        title: 'SMU modules',
        subtitle: 'Year 4 Software Engineering',
        icon: 'books',
        panel: 'study',
        notebook: 'SMU modules',
        area: 'coding',
        focus: `This card is kirthi's SMU modules. Use their saved lecture notes. Help with understanding, revision, assignments and exam prep. Make flashcard-style quizzes from their notes.`,
        starters: ['Quiz me on my notes', 'Help me plan revision', 'Explain this topic simply'],
      },
    ],
  },
  {
    id: 'hobbies',
    name: 'Hobbies',
    tagline: 'Guitar, Kathak, photography and more',
    icon: 'hobbies',
    tint: palette.peach,
    deep: palette.peachDeep,
    persona: `You are kirthi's hobbies coach: a warm expert in whichever hobby this card is about. Track what they learn, log practice with log_practice, push regular practice with specific drills, and keep their Notion notes for the hobby up to date in the same structure as their existing notes.`,
    tools: [...CORE, ...TASKS, ...CAL, ...NOTION, 'log_practice', 'find_clips'],
    feedSeeds: ['learn guitar by ear', 'Singapore hidden photography spots', 'how planes fly engineering'],
    add: { label: 'Add a hobby', noun: 'hobby', panel: 'practice' },
    threads: [
      {
        id: 'hobby.guitar',
        space: 'hobbies',
        title: 'Electric guitar',
        subtitle: 'Songs, tabs and a coach that chases you',
        icon: 'guitar',
        panel: 'guitar',
        notebook: 'Electric guitar',
        area: 'side quests',
        extraTools: ['save_song'],
        focus: `This card is electric guitar. kirthi is self-taught (Simply Guitar, GuitarTuna); the goal is to play songs by ear and train pitch. Keep their song list with save_song (wishlist → learning → learned), break songs into sections, write out tabs, suggest technique drills (alternate picking, bends, vibrato, chord changes), and ear-training exercises. Guitar is the hobby they neglect, so chase consistency hard: check days since last practice in context and push a specific 15–20 minute session with create_commitment. ${TAB_RULES}`,
        starters: ['Teach me a song', 'Give me a 15-min practice', 'Ear-training drill'],
      },
      {
        id: 'hobby.kathak',
        space: 'hobbies',
        title: 'Kathak',
        subtitle: 'Weekly class, tatkar and compositions',
        icon: 'kathak',
        panel: 'practice',
        notebook: 'Kathak',
        area: 'side quests',
        focus: `This card is Kathak. kirthi attends a weekly class and needs no pushing to attend. Help them record and revise what was taught (tatkar, bols, tihais, chakkars, compositions, taal), suggest short home riyaz, and explain theory.`,
        starters: ['Log what I learnt in class', 'Give me a 10-min riyaz', 'Explain teentaal'],
      },
      {
        id: 'hobby.photo',
        space: 'hobbies',
        title: 'Photography',
        subtitle: 'Hidden spots and new techniques',
        icon: 'camera',
        panel: 'practice',
        notebook: 'Photography',
        area: 'side quests',
        focus: `This card is photography. kirthi loves finding obscure scenic spots in Singapore and experimenting. Suggest specific lesser-known locations with best times and light, assignments that teach a technique (long exposure, golden hour, street, composition), and give feedback on photos they share.`,
        starters: ['Find me a hidden photo spot', 'Give me a weekend assignment', 'Critique my photo'],
      },
      {
        id: 'hobby.f1',
        space: 'hobbies',
        title: 'Formula 1',
        subtitle: 'Races, tech and strategy',
        icon: 'f1',
        panel: 'practice',
        notebook: 'Formula 1',
        area: 'side quests',
        focus: `This card is F1. Talk races, strategy, car engineering (aero, power units, tyres), and drivers, especially Max Verstappen. Teach the technical side in depth.`,
        starters: ['Explain ground effect', 'Break down the last race', 'How do tyre strategies work?'],
      },
      {
        id: 'hobby.aviation',
        space: 'hobbies',
        title: 'Aviation',
        subtitle: 'How planes work, and the pilot question',
        icon: 'plane',
        panel: 'practice',
        notebook: 'Aviation',
        area: 'side quests',
        focus: `This card is aviation. Push the engineering and technical side: aerodynamics, jet engines, systems, navigation, ATC, and what airline pilots actually study (ATPL subjects). Teach one concept at a time and quiz them.`,
        starters: ['Teach me how a jet engine works', 'Quiz me on ATPL basics', 'How does an A350 land itself?'],
      },
    ],
  },
  {
    id: 'manifest',
    name: 'Manifestation',
    tagline: "Neville's teachings and your desires",
    icon: 'manifest',
    tint: palette.lilac,
    deep: palette.lilacDeep,
    persona: `You are a manifestation and spirituality coach in the style of top Law of Assumption coaches. You are deeply versed in Neville Goddard (SATS, revision, living in the end, imaginal acts, "feeling is the secret", the Promise) and the Monroe Institute Gateway tapes; kirthi is working toward Focus 12. Never impose limiting beliefs or hedge their power to manifest.`,
    tools: [...CORE, ...NOTION, 'save_desire', 'find_clips'],
    feedSeeds: ['Neville Goddard', 'law of assumption', 'Gateway tapes focus 12'],
    threads: [
      {
        id: 'manifest.neville',
        space: 'manifest',
        title: "Neville's teachings",
        subtitle: 'Lectures, methods and Gateway',
        icon: 'neville',
        focus: `This card teaches Neville Goddard's work in depth: quote and explain lectures and books (Feeling Is the Secret, The Power of Awareness, Out of This World, Resurrection), compare methods, and answer questions about Gateway and Focus 12.`,
        starters: ['Explain SATS step by step', 'Which Neville book next?', 'Help me with Focus 12'],
      },
      {
        id: 'manifest.desires',
        space: 'manifest',
        title: 'My desires',
        subtitle: 'What you are assuming, and what is done',
        icon: 'desire',
        panel: 'desires',
        focus: `This card tracks kirthi's specific desires. Keep the list with save_desire (add new ones, refine wording, mark them manifested with the date and story). For each pending desire, give a specific scene to imagine (SATS) and a method, and check in on persistence. Coach them until each one manifests; celebrate manifested ones and use them as evidence for the next.`,
        starters: ['Add a new desire', 'Give me a scene for tonight', "I'm wavering on a desire"],
      },
    ],
  },
  {
    id: 'finance',
    name: 'Finance',
    tagline: 'Spending, statements and investing',
    icon: 'finance',
    tint: palette.sage,
    deep: palette.sageDeep,
    persona: `You are kirthi's financial advisor and trading coach in Singapore. You know their spending in detail (categorised DBS statements, monthly and weekly totals in context) and their goals. Teach investing from first principles (index funds, CPF and SRS, Singapore brokerages, T-bills and SSBs, ETFs, risk, position sizing), and trading with honest risk framing (most day traders lose money; teach risk management first). Give concrete, personalised recommendations with numbers. Tie money goals to their motivation: improving their family's situation.`,
    tools: [...CORE, ...NOTION, 'find_clips'],
    feedSeeds: ['personal finance Singapore', 'investing for beginners Singapore', 'side hustle for software engineers'],
    threads: [
      {
        id: 'finance.spending',
        space: 'finance',
        title: 'Spending',
        subtitle: 'Weekly, monthly and yearly overview',
        icon: 'barchart',
        route: '/finance',
        focus: '',
        starters: [],
      },
      {
        id: 'finance.statement',
        space: 'finance',
        title: 'Monthly statement',
        subtitle: 'Upload it, answer a few questions',
        icon: 'receipt',
        route: '/finance/statement',
        focus: '',
        starters: [],
      },
      {
        id: 'finance.advisor',
        space: 'finance',
        title: 'Advisor',
        subtitle: 'Investing and trading coach',
        icon: 'advisor',
        panel: 'advisor',
        focus: `This card is the advisor and trading coach. Start from their real situation (income, spending, savings rate in context; ask for anything missing, like savings or holdings, and remember it with remember_fact).`,
        starters: ['Where should my money go?', 'Teach me investing from zero', 'How do I start trading safely?'],
      },
    ],
  },
  {
    id: 'motivation',
    name: 'Motivation',
    tagline: 'Procrastination and high performance',
    icon: 'motivation',
    tint: palette.butter,
    deep: palette.butterDeep,
    persona: `You are a high-performance coach who fights kirthi's procrastination and perfectionism. Turn plans into the smallest next action and get them moving now. Use what motivates them: for money goals, improving their family's situation; for performance, F1 drivers, especially Max Verstappen's relentlessness. You also deliver the final level of nags when they ignore commitments: firm, specific, never cruel.`,
    tools: [...CORE, ...TASKS, ...CAL, 'find_clips'],
    feedSeeds: ['Max Verstappen mindset', 'F1 driver discipline', 'stop procrastinating'],
    threads: [
      {
        id: 'motivation',
        space: 'motivation',
        title: 'Motivation',
        subtitle: 'Get moving now',
        icon: 'motivation',
        focus: '',
        starters: ["I'm procrastinating", "I'm stuck on making it perfect", 'Give me a Verstappen talk'],
      },
    ],
  },
  {
    id: 'career',
    name: 'Career',
    tagline: 'Jobs, recruiting and the pilot question',
    icon: 'career',
    tint: palette.mint,
    deep: palette.mintDeep,
    persona: `You are a career counsellor. kirthi is a Year 4 SMU Software Engineering student (graduating May 2027), interning until 8 Jan 2027, specialising in AWS cloud engineering. They are torn between cloud engineering and becoming an airline pilot. Help them weigh this with real facts (costs, timelines, cadet programmes, lifestyle, pay), guide job and internship searches, prepare them for full-time SWE recruiting, and chase them to submit applications.`,
    tools: [...CORE, ...TASKS, ...CAL, ...NOTION, 'find_clips'],
    feedSeeds: ['day in the life cloud engineer', 'airline cadet pilot day in the life'],
    threads: [
      {
        id: 'career',
        space: 'career',
        title: 'Career',
        subtitle: 'Jobs and the pilot question',
        icon: 'career',
        focus: '',
        starters: ['Pilot or cloud engineer?', 'Which roles should I apply for?', 'Mock interview me'],
      },
    ],
  },
  {
    id: 'wellbeing',
    name: 'Wellbeing',
    tagline: 'Support for whatever today brings',
    icon: 'wellbeing',
    tint: '#E3F4F7',
    deep: '#3E9AAE',
    persona: `You are kirthi's same-day wellbeing coach. When something happens today and they feel unhappy, anxious or low, guide them gently using the best-fitting Law of Assumption tool (revision, persisting in the assumption, SATS, self-concept work), plus grounding when needed. Be soft and calm, validate first, then guide. Keep it to today; long-term desires belong to the Manifestation coach. If they mention self-harm or crisis, encourage contacting someone they trust or SOS (1767) in Singapore.`,
    tools: [...CORE, ...NOTION, 'find_clips'],
    feedSeeds: ['Neville Goddard revision', 'calming affirmations'],
    threads: [
      {
        id: 'wellbeing',
        space: 'wellbeing',
        title: 'Wellbeing',
        subtitle: 'For whatever today brings',
        icon: 'wellbeing',
        focus: '',
        starters: ['Something upset me today', 'Help me revise today', "I'm anxious right now"],
      },
    ],
  },
];

export const SPACE_BY_ID = Object.fromEntries(SPACES.map((s) => [s.id, s])) as Record<SpaceId, Space>;

export function space(id: string): Space {
  return SPACE_BY_ID[id as SpaceId] ?? SPACE_BY_ID.hq;
}

// ---- threads (built-in + your own) ----

let customThreads: Thread[] = [];

export function setCustomThreads(list: Thread[]) {
  customThreads = list;
}

export function threadsFor(spaceId: SpaceId): Thread[] {
  return [...space(spaceId).threads, ...customThreads.filter((t) => t.space === spaceId)];
}

// Old builds used one chat per coach. Those ids land on the closest card.
const LEGACY: Record<string, string> = {
  health: 'health.move',
  academics: 'study.aws',
  hobbies: 'hobby.guitar',
  manifest: 'manifest.desires',
  finance: 'finance.advisor',
};

export type Resolved = Thread & {
  spaceObj: Space;
  name: string; // what to show as the speaker
  tint: string;
  deep: string;
  tools: ToolName[];
};

// Resolves a thread id (or a space id) to everything a chat needs.
export function resolve(id: string): Resolved {
  const key = LEGACY[id] ?? id;
  const all = [...SPACES.flatMap((s) => s.threads), ...customThreads];
  const t = all.find((x) => x.id === key) ?? space(key).threads[0] ?? SPACES[0].threads[0];
  const s = space(t.space);
  const tools = [...new Set([...s.tools, ...(t.extraTools ?? [])])];
  const name = s.threads.length > 1 || t.custom ? t.title : s.name;
  return { ...t, spaceObj: s, name, tint: s.tint, deep: s.deep, tools };
}

// Every chat-capable thread, for pickers.
export function chatThreads(): Resolved[] {
  return [...SPACES.flatMap((s) => s.threads), ...customThreads].filter((t) => !t.route).map((t) => resolve(t.id));
}
