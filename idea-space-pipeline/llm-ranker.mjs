import { GoogleGenerativeAI } from '@google/generative-ai';
import { jsonrepair } from 'jsonrepair';

const CLIPROXY_BASE = process.env.CLIPROXY_URL || 'http://127.0.0.1:8317';
const CLIPROXY_KEY = process.env.CLIPROXY_API_KEY || 'your-api-key-1';

function extractJson(text) {
  const codeBlock = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  const candidate = codeBlock ? codeBlock[1].trim() : text;
  const match = candidate.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('No JSON found in LLM ranker response.');
  return match[0];
}

function clamp01(x) {
  if (!Number.isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

async function rankViaCliproxy(prompt, model) {
  const res = await fetch(`${CLIPROXY_BASE}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${CLIPROXY_KEY}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      max_tokens: 4096,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'You are a strict ranking engine. Return JSON only. Do not include markdown or prose.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`CLIProxy ranker failed (${res.status}): ${body.slice(0, 200)}`);
  }

  const json = await res.json();
  const text = json.choices?.[0]?.message?.content;
  if (!text) throw new Error('Empty ranker response from CLIProxy.');
  return text;
}

async function rankViaGemini(prompt, model) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY missing for Gemini ranker fallback.');

  const genAI = new GoogleGenerativeAI(apiKey);
  const genModel = genAI.getGenerativeModel({
    model,
    generationConfig: {
      temperature: 0.1,
      responseMimeType: 'application/json',
      maxOutputTokens: 4096,
    },
  });

  const result = await genModel.generateContent(prompt);
  const text = result.response.text();
  if (!text) throw new Error('Empty ranker response from Gemini.');
  return text;
}

function normalizeRankings(raw, allowedKeys) {
  const byKey = new Map();

  const rows = Array.isArray(raw?.rankings) ? raw.rankings : [];
  for (const row of rows) {
    const key = typeof row?.key === 'string' ? row.key : null;
    if (!key || !allowedKeys.has(key)) continue;
    byKey.set(key, {
      score: clamp01(Number(row.score ?? 0)),
      confidence: clamp01(Number(row.confidence ?? 0.5)),
      reason: typeof row.reason === 'string' ? row.reason : '',
    });
  }

  return byKey;
}

export async function rankCandidatesWithLLM({ candidates, model, provider }) {
  const rows = candidates.map((candidate, idx) => ({
    idx: idx + 1,
    key: candidate.key,
    domain: candidate.record.domain,
    problem: candidate.record.problem,
    method: candidate.record.method,
    evidence: candidate.record.evidence,
    population: candidate.record.population,
    geography: candidate.record.geography,
    time_horizon: candidate.record.time_horizon,
    objective: candidate.record.objective,
  }));

  const prompt = [
    'Rank these research tuples for expected value-per-token in the next 24-72 hours.',
    'Score each candidate on expected novelty, actionability, evidence quality, and cost-efficiency.',
    'Return strict JSON with schema:',
    '{"rankings":[{"key":"...","score":0..1,"confidence":0..1,"reason":"short"}]}',
    'You must include every key exactly once.',
    'Candidates:',
    JSON.stringify(rows),
  ].join('\n\n');

  const selectedProvider = provider || (process.env.CLIPROXY_URL ? 'cliproxy' : 'gemini');
  const selectedModel =
    model || process.env.IDEA_RANKER_MODEL || (selectedProvider === 'cliproxy' ? 'gpt-5' : 'gemini-2.5-flash');

  const rawText =
    selectedProvider === 'cliproxy'
      ? await rankViaCliproxy(prompt, selectedModel)
      : await rankViaGemini(prompt, selectedModel);

  let parsed;
  const rawJson = extractJson(rawText);
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    parsed = JSON.parse(jsonrepair(rawJson));
  }
  const allowedKeys = new Set(candidates.map((c) => c.key));
  const byKey = normalizeRankings(parsed, allowedKeys);

  const ranked = candidates
    .map((candidate) => {
      const llm = byKey.get(candidate.key);
      if (!llm) {
        return {
          ...candidate,
          llm: {
            score: 0.2,
            confidence: 0.2,
            reason: 'Missing from LLM output; assigned conservative fallback score.',
            provider: selectedProvider,
            model: selectedModel,
          },
        };
      }

      return {
        ...candidate,
        llm: {
          ...llm,
          provider: selectedProvider,
          model: selectedModel,
        },
      };
    })
    .sort((a, b) => b.llm.score - a.llm.score);

  return {
    provider: selectedProvider,
    model: selectedModel,
    ranked,
  };
}
