"use client";

import { useState, useTransition } from "react";
import {
  approveVoucherAction,
  postVoucherAction,
} from "@/lib/actions/vouchers";
import { Button } from "@/components/ui/primitives";

export function OpeningBalanceActions({
  voucherId,
  status,
  canApprove,
  canPost,
}: {
  voucherId: string;
  status: string;
  canApprove: boolean;
  canPost: boolean;
}) {
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const approve = () => {
    startTransition(async () => {
      setMessage(null);
      const result = await approveVoucherAction(voucherId);
      setMessage(result.ok ? "Approved" : result.error);
    });
  };

  const post = () => {
    startTransition(async () => {
      setMessage(null);
      const result = await postVoucherAction(voucherId);
      setMessage(result.ok ? `Posted: ${result.data.voucherNumber}` : result.error);
    });
  };

  if ((status !== "draft" && status !== "submitted" && status !== "approved") || (!canApprove && !canPost)) {
    return null;
  }

  return (
    <div className="flex flex-col items-start gap-1.5">
      <div className="flex gap-2">
        {(status === "draft" || status === "submitted") && canApprove ? (
          <Button type="button" variant="secondary" disabled={pending} onClick={approve}>
            Approve
          </Button>
        ) : null}
        {status === "approved" && canPost ? (
          <Button type="button" disabled={pending} onClick={post}>
            Post
          </Button>
        ) : null}
      </div>
      {message ? <span className="text-xs text-[var(--muted)]">{message}</span> : null}
    </div>
  );
}
