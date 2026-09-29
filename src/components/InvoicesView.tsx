import React, { useState } from 'react';
import { 
  Receipt, 
  ExternalLink, 
  Search, 
  DollarSign, 
  Calendar, 
  CheckCircle2, 
  Clock, 
  AlertCircle,
  Filter
} from 'lucide-react';
import { JobberInvoice } from '../services/jobberSyncModules';

interface InvoicesViewProps {
  invoices: JobberInvoice[];
  onRefreshInvoices?: () => void;
}

export const InvoicesView: React.FC<InvoicesViewProps> = ({
  invoices,
  onRefreshInvoices,
}) => {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');

  const filteredInvoices = invoices.filter((inv) => {
    const matchesSearch =
      inv.clientName.toLowerCase().includes(search.toLowerCase()) ||
      inv.invoiceNumber.toLowerCase().includes(search.toLowerCase());

    const matchesStatus = statusFilter === 'ALL' || inv.invoiceStatus === statusFilter;

    return matchesSearch && matchesStatus;
  });

  const totalPaid = filteredInvoices
    .filter((i) => i.invoiceStatus === 'PAID')
    .reduce((acc, i) => acc + i.total, 0);

  const totalOutstanding = filteredInvoices
    .filter((i) => i.invoiceStatus === 'AWAITING_PAYMENT')
    .reduce((acc, i) => acc + (i.balance || i.total), 0);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'PAID':
        return 'bg-emerald-50 text-emerald-700 border-emerald-200';
      case 'AWAITING_PAYMENT':
        return 'bg-amber-50 text-amber-800 border-amber-200';
      case 'BAD_DEBT':
        return 'bg-rose-50 text-rose-700 border-rose-200';
      default:
        return 'bg-slate-100 text-slate-700 border-slate-200';
    }
  };

  return (
    <div className="flex-1 h-full flex flex-col overflow-hidden bg-slate-50 font-sans p-4 sm:p-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4 bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs">
        <div>
          <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <Receipt className="w-5 h-5 text-emerald-600" />
            <span>Jobber Invoices &amp; Payments ({filteredInvoices.length})</span>
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Real-time billing, payments, and balances directly from your Jobber ledger
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="px-3 py-1.5 bg-emerald-50 text-emerald-900 border border-emerald-200 rounded-xl font-mono text-xs font-bold">
            Collected: ${totalPaid.toLocaleString()}
          </div>
          <div className="px-3 py-1.5 bg-amber-50 text-amber-900 border border-amber-200 rounded-xl font-mono text-xs font-bold">
            Due: ${totalOutstanding.toLocaleString()}
          </div>
          {onRefreshInvoices && (
            <button
              onClick={onRefreshInvoices}
              className="px-3 py-1.5 text-xs font-semibold text-emerald-800 bg-emerald-100 hover:bg-emerald-200 rounded-xl transition-colors cursor-pointer"
            >
              Sync Billing
            </button>
          )}
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        <div className="sm:col-span-2 relative">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search by client or invoice number..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 bg-white border border-slate-300 rounded-xl text-xs text-slate-900 focus:outline-none focus:border-emerald-500 shadow-2xs"
          />
        </div>

        <div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs text-slate-700 focus:outline-none shadow-2xs"
          >
            <option value="ALL">All Statuses</option>
            <option value="PAID">Paid in Full</option>
            <option value="AWAITING_PAYMENT">Awaiting Payment</option>
            <option value="DRAFT">Draft</option>
          </select>
        </div>
      </div>

      {/* Invoices List / Table */}
      <div className="flex-1 overflow-y-auto bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold">
              <th className="p-3">Invoice #</th>
              <th className="p-3">Client</th>
              <th className="p-3">Status</th>
              <th className="p-3">Issued Date</th>
              <th className="p-3">Due Date</th>
              <th className="p-3 text-right">Total</th>
              <th className="p-3 text-right">Balance Due</th>
              <th className="p-3 text-center">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredInvoices.map((inv) => (
              <tr key={inv.id} className="hover:bg-slate-50/80 transition-colors">
                <td className="p-3 font-mono font-bold text-slate-700">{inv.invoiceNumber}</td>
                <td className="p-3 font-bold text-slate-900">{inv.clientName}</td>
                <td className="p-3">
                  <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded border ${getStatusBadge(inv.invoiceStatus)}`}>
                    {inv.invoiceStatus.replace('_', ' ')}
                  </span>
                </td>
                <td className="p-3 text-slate-500 font-mono">{inv.issuedDate}</td>
                <td className="p-3 text-slate-500 font-mono">{inv.dueDate}</td>
                <td className="p-3 text-right font-mono font-bold text-slate-900">${inv.total}</td>
                <td className="p-3 text-right font-mono font-bold">
                  {inv.balance > 0 ? (
                    <span className="text-amber-700 font-bold">${inv.balance}</span>
                  ) : (
                    <span className="text-emerald-700">$0 (Paid)</span>
                  )}
                </td>
                <td className="p-3 text-center">
                  <a
                    href={inv.jobberWebUri}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-1.5 inline-flex items-center text-slate-500 hover:text-emerald-700 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
                    title="Open in Jobber"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
