import React, { useState } from 'react';
import { 
  FileCheck, 
  ExternalLink, 
  Search, 
  DollarSign, 
  Calendar, 
  CheckCircle2, 
  Clock, 
  ArrowUpRight,
  Filter
} from 'lucide-react';
import { JobberQuote } from '../services/jobberSyncModules';

interface QuotesViewProps {
  quotes: JobberQuote[];
  onRefreshQuotes?: () => void;
}

export const QuotesView: React.FC<QuotesViewProps> = ({
  quotes,
  onRefreshQuotes,
}) => {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');

  const filteredQuotes = quotes.filter((q) => {
    const matchesSearch =
      q.clientName.toLowerCase().includes(search.toLowerCase()) ||
      q.quoteNumber.toLowerCase().includes(search.toLowerCase()) ||
      q.service.toLowerCase().includes(search.toLowerCase());

    const matchesStatus = statusFilter === 'ALL' || q.quoteStatus === statusFilter;

    return matchesSearch && matchesStatus;
  });

  const totalValue = filteredQuotes.reduce((acc, q) => acc + q.total, 0);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'APPROVED':
      case 'CONVERTED':
        return 'bg-emerald-50 text-emerald-700 border-emerald-200';
      case 'AWAITING_RESPONSE':
        return 'bg-amber-50 text-amber-800 border-amber-200';
      case 'CHANGES_REQUESTED':
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
            <FileCheck className="w-5 h-5 text-amber-600" />
            <span>Jobber Quotes Pipeline ({filteredQuotes.length})</span>
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Active quotes for Standard, Deep, and Move-Out cleans in Greater Edmonton
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="px-3 py-1.5 bg-amber-50 text-amber-900 border border-amber-200 rounded-xl font-mono text-xs font-bold">
            Total Pipeline: ${totalValue.toLocaleString()}
          </div>
          {onRefreshQuotes && (
            <button
              onClick={onRefreshQuotes}
              className="px-3 py-1.5 text-xs font-semibold text-amber-800 bg-amber-100 hover:bg-amber-200 rounded-xl transition-colors cursor-pointer"
            >
              Sync Quotes
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
            placeholder="Search by client or quote number..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 bg-white border border-slate-300 rounded-xl text-xs text-slate-900 focus:outline-none focus:border-amber-500 shadow-2xs"
          />
        </div>

        <div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs text-slate-700 focus:outline-none shadow-2xs"
          >
            <option value="ALL">All Statuses</option>
            <option value="APPROVED">Approved</option>
            <option value="AWAITING_RESPONSE">Awaiting Response</option>
            <option value="CONVERTED">Converted to Job</option>
            <option value="DRAFT">Draft</option>
          </select>
        </div>
      </div>

      {/* Quotes Cards Grid */}
      <div className="flex-1 overflow-y-auto">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {filteredQuotes.map((q) => (
            <div
              key={q.id}
              className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs hover:shadow-sm transition-all flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between gap-1 mb-2">
                  <span className="font-mono text-xs font-bold text-slate-600 bg-slate-100 px-2 py-0.5 rounded">
                    {q.quoteNumber}
                  </span>
                  <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded border ${getStatusBadge(q.quoteStatus)}`}>
                    {q.quoteStatus.replace('_', ' ')}
                  </span>
                </div>

                <h3 className="font-bold text-sm text-slate-900 leading-snug mb-1">{q.clientName}</h3>
                <p className="text-xs text-slate-500 mb-3">{q.service}</p>
              </div>

              <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
                <div>
                  <span className="text-[10px] text-slate-400 block">Total</span>
                  <span className="font-extrabold text-slate-900 text-sm font-mono">${q.total}</span>
                </div>

                {q.depositRequired > 0 && (
                  <div>
                    <span className="text-[10px] text-slate-400 block">Deposit</span>
                    <span className="font-semibold text-emerald-700 font-mono">${q.depositRequired}</span>
                  </div>
                )}

                <a
                  href={q.jobberWebUri}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-1.5 text-slate-500 hover:text-emerald-700 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
                  title="Open in Jobber"
                >
                  <ExternalLink className="w-4 h-4" />
                </a>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
