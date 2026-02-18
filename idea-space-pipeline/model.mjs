import { axisOrder, taxonomyV1 } from './taxonomy.mjs';

function zeros(n) {
  return Array.from({ length: n }, () => 0);
}

function zeroMatrix(n) {
  return Array.from({ length: n }, () => zeros(n));
}

export function buildFeatureIndex(taxonomy = taxonomyV1) {
  const axes = axisOrder.map((axis) => ({ axis, values: taxonomy.axes[axis] }));
  let offset = 0;
  const byAxisValue = {};

  for (const entry of axes) {
    byAxisValue[entry.axis] = {};
    for (const value of entry.values) {
      byAxisValue[entry.axis][value] = offset;
      offset += 1;
    }
  }

  return {
    dims: offset,
    axes,
    byAxisValue,
  };
}

export function featurizeTuple(tuple, index) {
  const x = zeros(index.dims);
  for (let i = 0; i < tuple.length; i += 1) {
    const axis = axisOrder[i];
    const value = tuple[i];
    const pos = index.byAxisValue[axis]?.[value];
    if (pos !== undefined) {
      x[pos] = 1;
    }
  }
  return x;
}

function dot(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i += 1) s += a[i] * b[i];
  return s;
}

function solveLinearSystem(matrix, rhs) {
  const n = matrix.length;
  const a = matrix.map((row) => [...row]);
  const b = [...rhs];

  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < n; row += 1) {
      if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    }

    if (Math.abs(a[pivot][col]) < 1e-10) continue;

    if (pivot !== col) {
      [a[col], a[pivot]] = [a[pivot], a[col]];
      [b[col], b[pivot]] = [b[pivot], b[col]];
    }

    const pivotVal = a[col][col];
    for (let j = col; j < n; j += 1) a[col][j] /= pivotVal;
    b[col] /= pivotVal;

    for (let row = 0; row < n; row += 1) {
      if (row === col) continue;
      const factor = a[row][col];
      if (Math.abs(factor) < 1e-12) continue;
      for (let j = col; j < n; j += 1) a[row][j] -= factor * a[col][j];
      b[row] -= factor * b[col];
    }
  }

  return b;
}

function invertMatrix(matrix) {
  const n = matrix.length;
  const a = matrix.map((row, r) =>
    row.concat(Array.from({ length: n }, (_, c) => (r === c ? 1 : 0))),
  );

  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < n; row += 1) {
      if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    }

    if (Math.abs(a[pivot][col]) < 1e-10) {
      throw new Error('Matrix is singular and cannot be inverted.');
    }

    if (pivot !== col) {
      [a[col], a[pivot]] = [a[pivot], a[col]];
    }

    const pivotVal = a[col][col];
    for (let j = 0; j < 2 * n; j += 1) a[col][j] /= pivotVal;

    for (let row = 0; row < n; row += 1) {
      if (row === col) continue;
      const factor = a[row][col];
      if (Math.abs(factor) < 1e-12) continue;
      for (let j = 0; j < 2 * n; j += 1) a[row][j] -= factor * a[col][j];
    }
  }

  return a.map((row) => row.slice(n));
}

export function trainRidgeModel({ rows, taxonomy = taxonomyV1, alpha = 2.0 }) {
  const index = buildFeatureIndex(taxonomy);
  const d = index.dims + 1;

  if (!rows.length) {
    return {
      modelType: 'ridge_ucb_v1',
      featureIndex: index,
      alpha,
      nObs: 0,
      intercept: 0,
      weights: zeros(index.dims),
      aInv: zeroMatrix(d),
      sigma2: 1,
      metrics: { mse: null },
    };
  }

  const xtx = zeroMatrix(d);
  const xty = zeros(d);

  for (const row of rows) {
    const xNoBias = featurizeTuple(row.tuple, index);
    const x = [1, ...xNoBias];
    const y = row.rewardPerToken;

    for (let i = 0; i < d; i += 1) {
      xty[i] += x[i] * y;
      for (let j = 0; j < d; j += 1) {
        xtx[i][j] += x[i] * x[j];
      }
    }
  }

  for (let i = 0; i < d; i += 1) {
    xtx[i][i] += alpha;
  }

  const beta = solveLinearSystem(xtx, xty);
  const intercept = beta[0];
  const weights = beta.slice(1);

  let sse = 0;
  for (const row of rows) {
    const pred = intercept + dot(weights, featurizeTuple(row.tuple, index));
    const err = row.rewardPerToken - pred;
    sse += err * err;
  }

  const sigma2 = Math.max(sse / Math.max(1, rows.length - d), 1e-6);
  const aInv = invertMatrix(xtx);
  const mse = sse / rows.length;

  return {
    modelType: 'ridge_ucb_v1',
    featureIndex: index,
    alpha,
    nObs: rows.length,
    intercept,
    weights,
    aInv,
    sigma2,
    metrics: { mse },
  };
}

export function predictWithUcb(model, tuple, beta = 1.0) {
  const xNoBias = featurizeTuple(tuple, model.featureIndex);
  const x = [1, ...xNoBias];

  const mean = model.intercept + dot(model.weights, xNoBias);

  const aInvx = zeros(x.length);
  for (let i = 0; i < x.length; i += 1) {
    let sum = 0;
    for (let j = 0; j < x.length; j += 1) {
      sum += model.aInv[i][j] * x[j];
    }
    aInvx[i] = sum;
  }

  const variance = Math.max(model.sigma2 * dot(x, aInvx), 1e-8);
  const uncertainty = Math.sqrt(variance);
  const ucb = mean + beta * uncertainty;

  return { mean, uncertainty, ucb };
}

export function serializeModel(model) {
  return {
    modelType: model.modelType,
    alpha: model.alpha,
    nObs: model.nObs,
    intercept: model.intercept,
    weights: model.weights,
    aInv: model.aInv,
    sigma2: model.sigma2,
    metrics: model.metrics,
    featureIndex: model.featureIndex,
  };
}

export function deserializeModel(blob) {
  return {
    modelType: blob.modelType,
    alpha: blob.alpha,
    nObs: blob.nObs,
    intercept: blob.intercept,
    weights: blob.weights,
    aInv: blob.aInv,
    sigma2: blob.sigma2,
    metrics: blob.metrics || {},
    featureIndex: blob.featureIndex,
  };
}
