export type StatementBalanceRow = {
  txnDate: string;
  debitAmount: number;
  creditAmount: number;
  balanceAfter?: number;
};

export type StatementBalanceCheck = {
  rowIndex: number;
  sequence: number;
  statementBalance?: number;
  calculatedBalance?: number;
  difference?: number;
  valid: boolean;
  message?: string;
};

export type StatementBalanceValidation = {
  valid: boolean;
  direction: "oldest-first" | "newest-first";
  detectedOpening?: number;
  detectedClosing?: number;
  checks: StatementBalanceCheck[];
  errors: string[];
};

export function statementBalanceErrorMessage(
  validation: StatementBalanceValidation,
): string {
  const firstGap = validation.checks.find(
    (check) => !check.valid && check.difference !== undefined,
  );
  if (firstGap?.difference !== undefined) {
    const direction = firstGap.difference > 0 ? "credit" : "debit";
    return `Statement appears incomplete/filtered or its columns are incorrect. ${validation.errors.length} running-balance gap(s) found. First gap at statement row ${firstGap.sequence}: unexplained ${direction} ${Math.abs(firstGap.difference).toFixed(4)}. Upload the full, unfiltered bank statement containing every debit and credit transaction.`;
  }
  return `Statement running-balance check failed. ${validation.errors.slice(0, 3).join("; ")}. Upload a complete statement with running balance on every row.`;
}

const SCALE = 10000n;

function decimalUnits(value: number): bigint {
  if (!Number.isFinite(value)) throw new Error("Invalid statement amount");
  const fixed = value.toFixed(4);
  const negative = fixed.startsWith("-");
  const [whole, fraction = ""] = fixed.replace("-", "").split(".");
  const units = BigInt(whole) * SCALE + BigInt(fraction.padEnd(4, "0"));
  return negative ? -units : units;
}

function unitsNumber(value: bigint): number {
  return Number(value) / Number(SCALE);
}

function evaluate(
  rows: StatementBalanceRow[],
  chronologicalIndexes: number[],
  openingBalance?: number,
): Omit<StatementBalanceValidation, "direction"> {
  const checks: StatementBalanceCheck[] = rows.map((_, rowIndex) => ({
    rowIndex,
    sequence: rowIndex + 1,
    valid: false,
  }));
  const errors: string[] = [];
  let previousStatementBalance: bigint | undefined;
  let detectedOpening: bigint | undefined;

  for (const [position, rowIndex] of chronologicalIndexes.entries()) {
    const row = rows[rowIndex];
    if (row.balanceAfter === undefined) {
      const message = `Statement row ${rowIndex + 1}: running balance is missing`;
      checks[rowIndex] = { rowIndex, sequence: rowIndex + 1, valid: false, message };
      errors.push(message);
      previousStatementBalance = undefined;
      continue;
    }

    const statementBalance = decimalUnits(row.balanceAfter);
    const movement = decimalUnits(row.creditAmount) - decimalUnits(row.debitAmount);
    if (position === 0) {
      detectedOpening = statementBalance - movement;
    }

    const calculationBase =
      position === 0
        ? openingBalance === undefined
          ? detectedOpening
          : decimalUnits(openingBalance)
        : previousStatementBalance;
    if (calculationBase === undefined) {
      const message = `Statement row ${rowIndex + 1}: previous running balance is unavailable`;
      checks[rowIndex] = {
        rowIndex,
        sequence: rowIndex + 1,
        statementBalance: row.balanceAfter,
        valid: false,
        message,
      };
      errors.push(message);
      previousStatementBalance = statementBalance;
      continue;
    }

    const calculated = calculationBase + movement;
    const difference = statementBalance - calculated;
    const valid = difference === 0n;
    const message = valid
      ? undefined
      : `Statement row ${rowIndex + 1}: calculated balance ${unitsNumber(calculated).toFixed(4)} does not match ${unitsNumber(statementBalance).toFixed(4)} (difference ${unitsNumber(difference).toFixed(4)})`;
    checks[rowIndex] = {
      rowIndex,
      sequence: rowIndex + 1,
      statementBalance: unitsNumber(statementBalance),
      calculatedBalance: unitsNumber(calculated),
      difference: unitsNumber(difference),
      valid,
      message,
    };
    if (message) errors.push(message);
    previousStatementBalance = statementBalance;
  }

  const closingIndex = chronologicalIndexes.at(-1);
  return {
    valid: errors.length === 0,
    detectedOpening: detectedOpening === undefined ? undefined : unitsNumber(detectedOpening),
    detectedClosing:
      closingIndex === undefined ? undefined : rows[closingIndex].balanceAfter,
    checks,
    errors,
  };
}

export function validateStatementBalances(
  rows: StatementBalanceRow[],
  openingBalance?: number,
): StatementBalanceValidation {
  const ascending = rows.map((_, index) => index);
  const descending = [...ascending].reverse();
  const ascProbe = evaluate(rows, ascending);
  const descProbe = evaluate(rows, descending);
  const firstDate = rows[0]?.txnDate ?? "";
  const lastDate = rows.at(-1)?.txnDate ?? "";
  const useDescending =
    descProbe.errors.length < ascProbe.errors.length ||
    (descProbe.errors.length === ascProbe.errors.length && firstDate > lastDate);
  const direction = useDescending ? "newest-first" : "oldest-first";
  return {
    ...evaluate(rows, useDescending ? descending : ascending, openingBalance),
    direction,
  };
}

/**
 * PDF/XLSX parsers sometimes swap debit/credit or glue an amount into the
 * wrong column. When every row has a running balance, rewrite debit/credit
 * from consecutive balance deltas so the statement chain is consistent.
 * Returns the repaired rows only when validation improves or becomes clean.
 */
export function repairStatementAmountsFromBalances<T extends StatementBalanceRow>(
  rows: T[],
): T[] {
  if (rows.length < 2) return rows;
  if (rows.some((row) => row.balanceAfter === undefined)) return rows;

  const initial = validateStatementBalances(rows);
  if (initial.valid) return rows;

  const order =
    initial.direction === "newest-first"
      ? rows.map((_, index) => index).reverse()
      : rows.map((_, index) => index);

  const repaired = rows.map((row) => ({ ...row }));
  let previousBalance: number | undefined;

  for (const [position, rowIndex] of order.entries()) {
    const balance = repaired[rowIndex].balanceAfter;
    if (balance === undefined) {
      previousBalance = undefined;
      continue;
    }

    if (position === 0) {
      // Opening is derived from this row's movement; try a Dr/Cr flip when the
      // gap is exactly twice the parsed movement (classic column swap).
      const movement =
        repaired[rowIndex].creditAmount - repaired[rowIndex].debitAmount;
      const check = initial.checks[rowIndex];
      if (
        check &&
        !check.valid &&
        check.difference !== undefined &&
        Math.abs(Math.abs(check.difference) - Math.abs(2 * movement)) < 0.00015
      ) {
        const debit = repaired[rowIndex].debitAmount;
        repaired[rowIndex].debitAmount = repaired[rowIndex].creditAmount;
        repaired[rowIndex].creditAmount = debit;
      }
    } else if (previousBalance !== undefined) {
      const delta = Number((balance - previousBalance).toFixed(4));
      if (delta > 0) {
        repaired[rowIndex].creditAmount = delta;
        repaired[rowIndex].debitAmount = 0;
      } else if (delta < 0) {
        repaired[rowIndex].debitAmount = Number((-delta).toFixed(4));
        repaired[rowIndex].creditAmount = 0;
      } else {
        // No balance movement — not a real posting; drop below.
        repaired[rowIndex].debitAmount = 0;
        repaired[rowIndex].creditAmount = 0;
      }
    }

    previousBalance = balance;
  }

  const cleaned = repaired.filter(
    (row) => (row.debitAmount > 0) !== (row.creditAmount > 0),
  );
  if (cleaned.length < 2) return rows;

  const after = validateStatementBalances(cleaned);
  if (after.valid) return cleaned;
  if (after.errors.length < initial.errors.length) return cleaned;
  return rows;
}
