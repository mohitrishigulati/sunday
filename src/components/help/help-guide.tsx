import Link from "next/link";

const STEPS = [
  {
    title: "1. Company aur bank add karo",
    body: "Masters → Company Master, phir Bank Account Master. Har company ki apni books alag rehti hain.",
    href: "/masters/companies",
    link: "Company Master",
  },
  {
    title: "2. Party add karo",
    body: "Jis insaan ya firm ko paise diye ya unse paise aaye, use Party Master mein daalo. Header choose karo: Debtor (lene hain), Creditor (dene hain), ya Expense (charges / GST / rent).",
    href: "/masters/parties",
    link: "Party Master",
  },
  {
    title: "3. Roz ki entry",
    body: "Transactions menu se voucher type choose karo: Sale, Purchase, Receipt, Payment, Journal Entry. Cash Book / Bank Book registers ke liye hain.",
    href: "/transactions",
    link: "Transactions",
  },
  {
    title: "4. Bank statement upload karo",
    body: "Dashboard ya Upload Bank Statement pe PDF/Excel lagao. Har row pe Paid to / Received from select karo. Isse pata chalta hai paise kisko gaye, kisse aaye.",
    href: "/bank-import",
    link: "Upload statement",
  },
  {
    title: "5. Party ledger dekho",
    body: "Reports → Party Ledger. Company choose karo, phir Party dropdown se naam. Debit = aapne pay kiya. Credit = aapko receive hua.",
    href: "/reports?r=trial",
    link: "Display — Trial Balance",
  },
];

export function HelpGuide({ compact = false }: { compact?: boolean }) {
  const content = (
    <div className="space-y-4 text-sm leading-6 text-[var(--ink)]">
      <p>
        SundayMD aapki companies ki <strong>cash, bank aur parties</strong> ki
        kitaab hai. Pehle seedha kaam, baad mein reports.
      </p>
      <ol className="space-y-3">
        {STEPS.map((step) => (
          <li key={step.title} className="rounded-md border border-[var(--border)] bg-[var(--background)] p-3">
            <p className="font-semibold">{step.title}</p>
            <p className="mt-1 text-[var(--muted)]">{step.body}</p>
            <Link href={step.href} className="mt-2 inline-block text-[var(--accent)] hover:underline">
              Open {step.link}
            </Link>
          </li>
        ))}
      </ol>
      <p className="text-[var(--muted)]">
        Financial year India ka hai: <strong>1 April se 31 March</strong>. Nayi
        company aur bank statement import pe yeh year khud ban jata hai.
      </p>
    </div>
  );

  if (compact) {
    return (
      <details className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
        <summary className="cursor-pointer text-sm font-semibold text-[var(--accent)]">
          Help — SundayMD kaise use karein?
        </summary>
        <div className="mt-4">{content}</div>
      </details>
    );
  }

  return content;
}
