import { createHash } from 'node:crypto';
import { axisOrder, taxonomyV1 } from './taxonomy.mjs';
import { validateTuple } from './constraints.mjs';

export function cartesianProduct(arrays) {
  return arrays.reduce(
    (acc, current) => {
      const next = [];
      for (const left of acc) {
        for (const right of current) {
          next.push([...left, right]);
        }
      }
      return next;
    },
    [[]],
  );
}

export function tupleToRecord(tuple) {
  return Object.fromEntries(axisOrder.map((axis, i) => [axis, tuple[i]]));
}

export function canonicalKey(tuple) {
  return axisOrder.map((axis, i) => `${axis}=${tuple[i]}`).join('|');
}

export function parseCanonicalKey(key) {
  const record = {};
  for (const part of key.split('|')) {
    const [axis, value] = part.split('=');
    if (!axis || value === undefined) {
      throw new Error(`Invalid canonical key fragment: ${part}`);
    }
    record[axis] = value;
  }
  const tuple = axisOrder.map((axis) => {
    if (!(axis in record)) {
      throw new Error(`Missing axis ${axis} in canonical key.`);
    }
    return record[axis];
  });
  return { record, tuple };
}

export function tupleId(tuple) {
  return createHash('sha1').update(canonicalKey(tuple)).digest('hex').slice(0, 16);
}

export function noveltyDistance(tupleA, tupleB) {
  let equal = 0;
  for (let i = 0; i < tupleA.length; i += 1) {
    if (tupleA[i] === tupleB[i]) equal += 1;
  }
  return 1 - equal / tupleA.length;
}

export function* iterateTuples(taxonomy = taxonomyV1) {
  const valuesByAxis = axisOrder.map((axis) => taxonomy.axes[axis]);
  const current = new Array(axisOrder.length);

  function* walk(depth) {
    if (depth === valuesByAxis.length) {
      yield [...current];
      return;
    }

    for (const value of valuesByAxis[depth]) {
      current[depth] = value;
      yield* walk(depth + 1);
    }
  }

  yield* walk(0);
}

export function scoreTuple(tuple, seenTupleKeys, scoreOptions = {}) {
  if (scoreOptions.customScorer) {
    const custom = scoreOptions.customScorer(tuple, seenTupleKeys);
    return {
      score: custom.score,
      isCovered: custom.isCovered,
      meta: custom.meta || {},
    };
  }

  const key = canonicalKey(tuple);
  const isCovered = seenTupleKeys.has(key);

  const otherPenalty = tuple.filter((value) => value === 'other').length * 0.08;
  const recencyBonus = ['6_months', '12_months'].includes(tuple[axisOrder.indexOf('time_horizon')])
    ? 0.12
    : 0;
  const objectiveBonus = tuple[axisOrder.indexOf('objective')] === 'gap_mapping' ? 0.1 : 0;

  const base = isCovered ? 0.05 : 1.0;
  const score = Math.max(0, base + recencyBonus + objectiveBonus - otherPenalty);

  return { score, isCovered, meta: {} };
}

function recalculateMMR(entry, selected, lambda) {
  const peers = selected.filter((item) => item.id !== entry.id);
  const maxSimilarity = peers.length
    ? Math.max(...peers.map((s) => 1 - noveltyDistance(entry.tuple, s.tuple)))
    : 0;
  return lambda * entry.score - (1 - lambda) * maxSimilarity;
}

export function selectDiverseTopKFromIterator(
  tupleIterator,
  seenTupleKeys,
  k = 20,
  lambda = 0.75,
  scoreOptions = {},
) {
  const selected = [];
  const stats = {
    totalCellsBeforeConstraints: 0,
    validCellsAfterConstraints: 0,
    invalidCells: 0,
  };

  for (const tuple of tupleIterator) {
    stats.totalCellsBeforeConstraints += 1;
    const validation = validateTuple(tuple);
    if (!validation.valid) {
      stats.invalidCells += 1;
      continue;
    }
    stats.validCellsAfterConstraints += 1;

    const { score, isCovered, meta } = scoreTuple(tuple, seenTupleKeys, scoreOptions);
    const entry = {
      tuple,
      score,
      isCovered,
      key: canonicalKey(tuple),
      id: tupleId(tuple),
      mmr: 0,
      meta,
    };
    entry.mmr = recalculateMMR(entry, selected, lambda);

    if (selected.length < k) {
      selected.push(entry);
      for (const item of selected) {
        item.mmr = recalculateMMR(item, selected, lambda);
      }
      continue;
    }

    let worstIndex = 0;
    for (let i = 1; i < selected.length; i += 1) {
      if (selected[i].mmr < selected[worstIndex].mmr) {
        worstIndex = i;
      }
    }

    if (entry.mmr > selected[worstIndex].mmr) {
      selected[worstIndex] = entry;
      for (const item of selected) {
        item.mmr = recalculateMMR(item, selected, lambda);
      }
    }
  }

  selected.sort((a, b) => b.mmr - a.mmr);
  return { selected, stats };
}

export function renderIdeaPrompt(record) {
  return [
    'Produce a comprehensive survey for this structured idea cell:',
    `Domain: ${record.domain}`,
    `Problem: ${record.problem}`,
    `Method: ${record.method}`,
    `Evidence: ${record.evidence}`,
    `Population: ${record.population}`,
    `Geography: ${record.geography}`,
    `Time horizon: ${record.time_horizon}`,
    `Objective: ${record.objective}`,
    'Include evidence quality, conflicting claims, and a prioritized gap map with next-step questions.',
  ].join('\n');
}

function titleCase(s) {
  return s
    .replace(/_/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(' ');
}

function evidenceCollectionGuidance(evidence) {
  const map = {
    papers: 'Collect recent peer-reviewed papers, benchmarks, and survey papers.',
    production_incidents:
      'Collect postmortems, incident reports, outage writeups, and reliability retrospectives.',
    regulations:
      'Collect primary regulatory text, guidance notes, and enforcement updates.',
    market_data: 'Collect market reports, demand/supply signals, pricing data, and adoption trends.',
    earnings_calls: 'Collect earnings transcripts, management commentary, and risk disclosures.',
    clinical_trials: 'Collect trial registries, trial outcomes, and protocol design summaries.',
    public_procurement: 'Collect RFPs, contract awards, procurement docs, and delivery performance notes.',
    benchmarks: 'Collect benchmark leaderboards, methodology cards, and reproduction reports.',
    other: 'Collect mixed primary evidence with explicit confidence grading.',
  };
  return map[evidence] || map.other;
}

export function buildIdeaBrief(record) {
  const title = `${titleCase(record.domain)} ${titleCase(record.problem)} in ${titleCase(record.geography)} (${titleCase(record.time_horizon)}): ${titleCase(record.method)} using ${titleCase(record.evidence)}`;
  const researchQuestion = `What are the highest-confidence ${record.problem.replace(/_/g, ' ')} gaps for ${record.population.replace(/_/g, ' ')} in ${record.domain.replace(/_/g, ' ')} across ${record.geography.toUpperCase()} over the next ${record.time_horizon.replace(/_/g, ' ')}, based on ${record.evidence.replace(/_/g, ' ')} and analyzed through ${record.method.replace(/_/g, ' ')}?`;

  const scope = {
    inScope: [
      `${record.domain.replace(/_/g, ' ')} initiatives affecting ${record.population.replace(/_/g, ' ')}`,
      `${record.geography.toUpperCase()} market and policy context`,
      `${record.time_horizon.replace(/_/g, ' ')} time-bounded developments`,
      `Evidence primarily from ${record.evidence.replace(/_/g, ' ')}`,
    ],
    outOfScope: [
      'Purely speculative claims without evidence',
      'Regions outside selected geography unless directly comparable',
      'Long-horizon predictions beyond selected time horizon',
      'Unverifiable anecdotes without source traceability',
    ],
  };

  const evidencePlan = [
    evidenceCollectionGuidance(record.evidence),
    'Triangulate conflicting claims and annotate confidence per claim.',
    'Prioritize sources with direct empirical or primary-text support.',
  ];

  return {
    title,
    researchQuestion,
    objective: record.objective.replace(/_/g, ' '),
    scope,
    evidencePlan,
    deepResearchPrompt: renderIdeaPrompt(record),
  };
}
