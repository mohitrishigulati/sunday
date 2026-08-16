/** Indian financial year: 1 April to 31 March. */

export type IndianFinancialYear = {
  code: string;
  startDate: string;
  endDate: string;
};

function isoDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function indianFinancialYearForDate(value: string | Date = new Date()): IndianFinancialYear {
  const date =
    value instanceof Date
      ? value
      : new Date(`${value.slice(0, 10)}T00:00:00`);
  const calendarYear = date.getFullYear();
  const month = date.getMonth() + 1;
  const startYear = month >= 4 ? calendarYear : calendarYear - 1;
  return {
    code: `${startYear}-${String(startYear + 1).slice(-2)}`,
    startDate: isoDate(startYear, 4, 1),
    endDate: isoDate(startYear + 1, 3, 31),
  };
}

export function indianFinancialYearsCovering(fromDate: string, toDate: string): IndianFinancialYear[] {
  const start = indianFinancialYearForDate(fromDate);
  const end = indianFinancialYearForDate(toDate);
  const years: IndianFinancialYear[] = [start];
  let startYear = Number(start.startDate.slice(0, 4));
  const lastStartYear = Number(end.startDate.slice(0, 4));
  while (startYear < lastStartYear) {
    startYear += 1;
    years.push(indianFinancialYearForDate(`${startYear}-04-01`));
  }
  return years;
}

export function aprilMarchYearLabel(year: {
  code: string;
  start_date?: string;
  end_date?: string;
  startDate?: string;
  endDate?: string;
}): string {
  const start = year.startDate ?? year.start_date;
  const end = year.endDate ?? year.end_date;
  if (start && end) {
    return `${year.code} (1 Apr ${start.slice(0, 4)} – 31 Mar ${end.slice(0, 4)})`;
  }
  return `${year.code} (April–March)`;
}
