import { type ReactNode } from "react";

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-8 flex flex-col gap-4 border-b border-[var(--border)] pb-6 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="font-[family-name:var(--font-display)] text-3xl tracking-tight text-[var(--ink)]">
          {title}
        </h1>
        {description ? (
          <p className="mt-2 max-w-2xl text-sm text-[var(--muted)]">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[0_1px_0_rgba(20,30,24,0.04)] ${className}`}
    >
      {children}
    </div>
  );
}

export function Button({
  children,
  type = "button",
  variant = "primary",
  disabled,
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost";
}) {
  const styles =
    variant === "primary"
      ? "bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)]"
      : variant === "secondary"
        ? "border border-[var(--border)] bg-white text-[var(--ink)] hover:bg-[var(--surface-2)]"
        : "text-[var(--muted)] hover:text-[var(--ink)]";

  return (
    <button
      type={type}
      disabled={disabled}
      className={`inline-flex items-center justify-center rounded-md px-3.5 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${styles} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

export function Input({
  label,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className="block space-y-1.5 text-sm">
      <span className="font-medium text-[var(--ink)]">{label}</span>
      <input
        className="w-full rounded-md border border-[var(--border)] bg-white px-3 py-2 text-[var(--ink)] outline-none ring-[var(--accent)] focus:ring-2"
        {...props}
      />
    </label>
  );
}

export function Select({
  label,
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="block space-y-1.5 text-sm">
      <span className="font-medium text-[var(--ink)]">{label}</span>
      <select
        className="w-full rounded-md border border-[var(--border)] bg-white px-3 py-2 text-[var(--ink)] outline-none ring-[var(--accent)] focus:ring-2"
        {...props}
      >
        {children}
      </select>
    </label>
  );
}

export function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-dashed border-[var(--border)] bg-[var(--surface-2)] px-6 py-12 text-center text-sm text-[var(--muted)]">
      {message}
    </div>
  );
}

export function AccessDenied({ message = "You do not have permission to view this page." }: { message?: string }) {
  return (
    <div className="mx-auto max-w-xl rounded-lg border border-[var(--danger)] bg-[var(--surface)] p-8">
      <h1 className="text-2xl font-semibold text-[var(--danger)]">Access denied</h1>
      <p className="mt-3 text-sm text-[var(--muted)]">{message}</p>
    </div>
  );
}

export function PhaseUnavailable({ feature }: { feature: string }) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-8">
      <h1 className="font-[family-name:var(--font-display)] text-2xl text-[var(--ink)]">
        {feature}
      </h1>
      <p className="mt-3 max-w-xl text-sm text-[var(--muted)]">
        This feature is not available yet. It will be enabled in a later
        implementation phase. No placeholder or sample accounting figures are
        shown.
      </p>
    </div>
  );
}

export function DataTable({
  columns,
  rows,
  className = "",
  tableClassName = "",
  dense = false,
  stickyHeader = false,
}: {
  columns: string[];
  rows: ReactNode[][];
  className?: string;
  tableClassName?: string;
  dense?: boolean;
  stickyHeader?: boolean;
}) {
  if (rows.length === 0) {
    return <EmptyState message="No records yet." />;
  }

  return (
    <div className={`overflow-x-auto rounded-lg border border-[var(--border)] ${className}`}>
      <table className={`min-w-full text-left text-sm ${tableClassName}`}>
        <thead className={`bg-[var(--surface-2)] text-[var(--muted)] ${stickyHeader ? "sticky top-0 z-10" : ""}`}>
          <tr>
            {columns.map((col) => (
              <th key={col} className={`${dense ? "px-2 py-2" : "px-4 py-3"} font-medium`}>
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-t border-[var(--border)] bg-[var(--surface)]">
              {row.map((cell, j) => (
                <td key={j} className={`${dense ? "px-2 py-2" : "px-4 py-3"} text-[var(--ink)]`}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
