import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface KnowledgeItem {
  id: string;
  url: string;
  title: string;
  content: string;
  wordCount: number;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const KNOWLEDGE_PATH = path.resolve(__dirname, '../data/knowledge.json');

let cachedKnowledge: KnowledgeItem[] | null = null;

export function getKnowledgeBase(): KnowledgeItem[] {
  if (cachedKnowledge) return cachedKnowledge;
  try {
    if (fs.existsSync(KNOWLEDGE_PATH)) {
      const raw = fs.readFileSync(KNOWLEDGE_PATH, 'utf8');
      cachedKnowledge = JSON.parse(raw) as KnowledgeItem[];
    } else {
      cachedKnowledge = [];
    }
  } catch {
    cachedKnowledge = [];
  }
  return cachedKnowledge;
}

/**
 * Common topic keywords mapped to specific document IDs
 */
const TOPIC_TRIGGERS: Record<string, string[]> = {
  'our-process': [
    'process',
    'step',
    'steps',
    '8 steps',
    '8-step',
    'step by step',
    'steps to resolution',
    'how the process works',
    'how does the process work',
    'the process',
    'our process',
    'court decree',
    'courtroom',
  ],
  'what-is-an-amicable-divorce': [
    'what is amicable',
    'what is an amicable divorce',
    'amicable approach',
    'philosophy',
    'amicable divorce network',
    'about amicable',
  ],
  'dispute-resolution': [
    'mediation',
    'mediator',
    'arbitration',
    'arbitrator',
    'private judge',
    'dispute resolution',
    'resolve dispute',
    'impasse',
  ],
  'mortgage-real-estate': [
    'mortgage',
    'house',
    'marital home',
    'home loan',
    'real estate',
    'selling the house',
    'keep the house',
    'refinance',
    'refi',
    'equity',
  ],
  'financial-advice': [
    'finances',
    'financial',
    'alimony',
    'spousal support',
    'division of assets',
    'assets and debts',
    'qdro',
    'pension',
    '401k',
    'bank accounts',
  ],
  'legal-help': [
    'lawyer',
    'attorney',
    'legal counsel',
    'court filing',
    'legal help',
    'representation',
  ],
  'co-parenting': [
    'child',
    'children',
    'kids',
    'parenting plan',
    'co-parenting',
    'co parenting',
    'custody',
    'legal custody',
    'physical custody',
    'visitation',
    'holiday schedule',
  ],
  'advice/legal-separation-vs-divorce': [
    'legal separation',
    'separation vs divorce',
    'difference between separation',
    'separation or divorce',
  ],
  'advice/should-i-divorce': [
    'should i divorce',
    'am i ready for divorce',
    'save our marriage',
    'fix our marriage',
  ],
  'mental-health-resources': ['therapy', 'counseling', 'mental health', 'therapist'],
  coaching: ['divorce coach', 'divorce coaching', 'coaching'],
  wellness: ['wellness', 'mindfulness', 'stress management'],
  'getting-started': ['getting started', 'how to begin', 'first steps'],
};

/**
 * Searches the knowledge base for snippets relevant to the visitor's typed text.
 * Returns up to 2 most relevant knowledge items, or empty array if none strongly match.
 */
export function findRelevantKnowledge(text: string, maxItems = 2): KnowledgeItem[] {
  const normalized = text.toLowerCase();
  const kb = getKnowledgeBase();
  if (kb.length === 0) return [];

  const scored: Array<{ item: KnowledgeItem; score: number }> = [];

  for (const item of kb) {
    let score = 0;
    const triggers = TOPIC_TRIGGERS[item.id] || [];

    for (const trigger of triggers) {
      if (normalized.includes(trigger)) {
        score += trigger.includes(' ') ? 5 : 2;
      }
    }

    if (score > 0) {
      scored.push({ item, score });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, maxItems).map((s) => s.item);
}
