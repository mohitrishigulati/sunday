"use client";

import { Select } from "@/components/ui/primitives";
import { BUSY_ACCOUNT_GROUPS, PRIMARY_LEDGER_HEAD_CODES } from "@/lib/busy-account-groups";

export type AccountHead = {
  id?: string;
  code: string;
  name: string;
  nature?: string;
};

function sortHeads(heads: AccountHead[]) {
  const rank = (code: string) => {
    const index = PRIMARY_LEDGER_HEAD_CODES.indexOf(
      code as (typeof PRIMARY_LEDGER_HEAD_CODES)[number],
    );
    return index === -1 ? 100 + code.length : index;
  };
  return [...heads].sort(
    (a, b) => rank(a.code) - rank(b.code) || a.name.localeCompare(b.name),
  );
}

export function BusyHeadSelect({
  label,
  name,
  required,
  value,
  onChange,
  heads,
  useCodes,
  disabled,
  placeholder,
  defaultValue,
}: {
  label: string;
  name: string;
  required?: boolean;
  value?: string;
  onChange?: (value: string) => void;
  heads?: AccountHead[];
  useCodes?: boolean;
  disabled?: boolean;
  placeholder?: string;
  defaultValue?: string;
}) {
  const source = heads?.length
    ? heads
    : BUSY_ACCOUNT_GROUPS.map((group) => ({
        code: group.code,
        name: group.name,
        nature: group.nature,
      }));
  const ordered = sortHeads(source);
  const primary = ordered.filter((head) =>
    PRIMARY_LEDGER_HEAD_CODES.includes(
      head.code as (typeof PRIMARY_LEDGER_HEAD_CODES)[number],
    ),
  );
  const rest = ordered.filter(
    (head) =>
      !PRIMARY_LEDGER_HEAD_CODES.includes(
        head.code as (typeof PRIMARY_LEDGER_HEAD_CODES)[number],
      ),
  );
  const optionValue = (head: AccountHead) =>
    useCodes ? head.code : (head.id ?? head.code);

  return (
    <Select
      label={label}
      name={name}
      required={required}
      disabled={disabled}
      {...(onChange
        ? {
            value: value ?? "",
            onChange: (event) => onChange(event.target.value),
          }
        : defaultValue
          ? { defaultValue }
          : {})}
    >
      <option value="">{placeholder ?? "Select head"}</option>
      {primary.length ? (
        <optgroup label="Common — Cash / Bank / Current assets">
          {primary.map((head) => (
            <option key={optionValue(head)} value={optionValue(head)}>
              {head.name}
            </option>
          ))}
        </optgroup>
      ) : null}
      {rest.length ? (
        <optgroup label="All other heads">
          {rest.map((head) => (
            <option key={optionValue(head)} value={optionValue(head)}>
              {head.name}
              {head.nature ? ` (${head.nature})` : ""}
            </option>
          ))}
        </optgroup>
      ) : null}
    </Select>
  );
}
