import React, { useState, useEffect } from 'react';
import { 
  PhoneCall, 
  Key, 
  CheckCircle2, 
  ExternalLink, 
  RefreshCw, 
  ShieldCheck, 
  X, 
  AlertCircle,
  Hash,
  Activity,
  Headphones,
  Sliders,
  Copy,
  Plus
} from 'lucide-react';

interface QuoModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export interface QuoPhoneNumber {
  id: string;
  name: string;
  number: string;
  status: 'active' | 'forwarding' | 'ai_receptionist';
  totalCallsToday: number;
}

export const QuoModal: React.FC<QuoModalProps> = ({ isOpen, onClose }) => {
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [phoneNumbers, setPhoneNumbers] = useState<QuoPhoneNumber[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [syncNotice, setSyncNotice] = useState<string | null>(null);
  const [copiedWebhook, setCopiedWebhook] = useState(false);

  const webhookUrl = `${window.location.origin}/api/quo/webhook`;

  const fetchQuoStatus = () => {
    fetch('/api/quo/config')
      .then((r) => r.json())
      .then((data) => {
        if (data) {
          setIsConnected(data.isConnected);
          if (data.phoneNumbers) {
            setPhoneNumbers(data.phoneNumbers);
          }
        }
      })
      .catch(() => {});
  };

  useEffect(() => {
    if (isOpen) {
      fetchQuoStatus();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSaveApiKey = async () => {
    if (!apiKeyInput.trim()) {
      setSyncNotice('Please enter your Quo (OpenPhone) API key.');
      return;
    }

    setIsLoading(true);
    setSyncNotice(null);

    try {
      const res = await fetch('/api/quo/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: apiKeyInput.trim() }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setIsConnected(true);
        setPhoneNumbers(data.phoneNumbers || []);
        setSyncNotice(`Connected to Quo! Loaded ${data.phoneNumbers?.length || 5} phone numbers.`);
      } else {
        setSyncNotice(data.error || 'Failed to connect Quo API. Please verify the key.');
      }
    } catch {
      setSyncNotice('Network error saving Quo API key.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopyWebhook = () => {
    navigator.clipboard.writeText(webhookUrl).then(() => {
      setCopiedWebhook(true);
      setTimeout(() => setCopiedWebhook(false), 3000);
      setSyncNotice('Copied Quo Webhook URL! Add this in Quo Webhooks settings.');
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-sm animate-fadeIn"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-3xl bg-white border border-slate-200 rounded-2xl shadow-2xl overflow-hidden text-slate-900 font-sans max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-violet-50 text-violet-600 border border-violet-200">
              <PhoneCall className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-bold text-sm text-slate-900 flex items-center gap-2">
                <span>Quo (OpenPhone) 5-Line Phone System</span>
                {isConnected ? (
                  <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-semibold border border-emerald-200 flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                    <span>5 Lines Connected</span>
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[10px] font-semibold border border-amber-200">
                    Awaiting API Key
                  </span>
                )}
              </h2>
              <p className="text-xs text-slate-500">
                Inbound Call Tracking &amp; Sona Voice AI Transcription Intake
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-200/50 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-4 sm:p-5 flex-1 overflow-y-auto bg-slate-50/50 space-y-4">
          {syncNotice && (
            <div className="p-3 bg-violet-50 border border-violet-200 rounded-xl text-violet-950 text-xs flex items-center justify-between shadow-2xs">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-violet-600 flex-shrink-0" />
                <span>{syncNotice}</span>
              </div>
              <button onClick={() => setSyncNotice(null)} className="text-violet-700 hover:text-violet-950 font-bold">×</button>
            </div>
          )}

          {/* API Key Box */}
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                <Key className="w-4 h-4 text-violet-600" />
                <span>Quo Public API Key (Workspace-Scoped)</span>
              </span>
              <a
                href="https://my.openphone.com/settings/api"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] text-blue-600 hover:underline flex items-center gap-1 font-semibold"
              >
                <span>Quo API Settings</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              Generate your raw workspace API key in <strong>Quo (OpenPhone) Settings → API</strong>. The key authenticates all 5 assigned phone lines without needing individual logins.
            </p>

            <div className="flex gap-2">
              <input
                type="password"
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                placeholder="Paste your Quo API Key (e.g. quo_live_...)"
                className="flex-1 px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-xs font-mono text-slate-900 focus:outline-none focus:border-violet-500"
              />
              <button
                onClick={handleSaveApiKey}
                disabled={isLoading}
                className="px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-xs font-bold transition-all disabled:opacity-50"
              >
                {isLoading ? 'Verifying...' : 'Connect Lines'}
              </button>
            </div>
          </div>

          {/* Webhook Configuration */}
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                <Activity className="w-4 h-4 text-emerald-600" />
                <span>Inbound Call Webhook (For Auto-Dispatch Tickets)</span>
              </span>
              <button
                onClick={handleCopyWebhook}
                className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-md text-[11px] font-semibold flex items-center gap-1 transition-colors"
              >
                <Copy className="w-3 h-3" />
                <span>{copiedWebhook ? 'Copied!' : 'Copy Webhook URL'}</span>
              </button>
            </div>
            <div className="font-mono text-xs text-slate-800 bg-slate-50 p-2 rounded-lg border border-slate-200 break-all select-all">
              {webhookUrl}
            </div>
            <p className="text-[11px] text-slate-500">
              When a call finishes on any line, Quo triggers this webhook with the post-call transcript and caller phone number. The dispatch engine automatically extracts customer info and creates a booking.
            </p>
          </div>

          {/* The 5 Phone Lines */}
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                <Hash className="w-4 h-4 text-slate-700" />
                <span>Connected Phone Numbers ({phoneNumbers.length})</span>
              </span>
              <span className="text-[10px] text-slate-500 font-mono">Routing: Edmonton Area Code (780)</span>
            </div>

            <div className="space-y-2">
              {phoneNumbers.map((line, idx) => (
                <div
                  key={line.id}
                  className="p-3 bg-slate-50 rounded-xl border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-7 h-7 rounded-lg bg-violet-100 text-violet-700 flex items-center justify-center font-bold text-xs">
                      {idx + 1}
                    </div>
                    <div>
                      <div className="text-xs font-bold text-slate-900 flex items-center gap-2">
                        <span>{line.name}</span>
                        <span className="font-mono text-slate-600 bg-white px-1.5 py-0.5 rounded border border-slate-200">
                          {line.number}
                        </span>
                      </div>
                      <div className="text-[10px] text-slate-500 mt-0.5">
                        Assigned: {idx % 2 === 0 ? 'Van 1 (Elena & Marco)' : 'Van 2 (Aiden & Maya)'} • AI Sona Intake Active
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 self-end sm:self-center">
                    <span className="px-2 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full text-[10px] font-semibold flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                      <span>{line.totalCallsToday} Calls Today</span>
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between text-xs text-slate-500">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span>Quo Voice Pipeline Ready</span>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-800 rounded-lg text-xs font-bold transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
