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
