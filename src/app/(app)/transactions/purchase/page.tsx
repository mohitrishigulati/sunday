import { BusinessWorkbench } from "@/components/business/business-workbench";
import { TransactionTypeNav } from "@/components/transactions/transaction-type-nav";

export default async function PurchaseTransactionPage() {
  return (
    <div className="space-y-6">
      <TransactionTypeNav active="purchase" />
      <BusinessWorkbench lockType="purchase" />
    </div>
  );
}
