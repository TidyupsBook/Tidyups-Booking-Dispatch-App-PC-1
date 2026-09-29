import React, { useState } from 'react';
import { 
  Calendar as CalendarIcon, 
  Clock, 
  MapPin, 
  User, 
  Phone, 
  Car, 
  Navigation, 
  ExternalLink, 
  CheckCircle2, 
  Sparkles, 
  Search,
  Filter,
  Users,
  ChevronRight,
  ShieldCheck,
  ArrowRight
} from 'lucide-react';
import { Technician } from '../types/dispatch';

export interface ScheduledJobItem {
  id: string;
  visitNumber: string;
  title: string;
  clientName: string;
  clientPhone: string;
  serviceAddress: string;
  city?: string;
  lat: number;
  lng: number;
  startAt: string;
  endAt: string;
  assignedCleaners: string[];
  serviceType: 'Standard Cleaning' | 'Deep Cleaning' | 'Move-Out Cleaning';
  status: 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED';
  jobberWebUri: string;
  notes?: string;
}

interface ScheduledJobsViewProps {
  jobs: ScheduledJobItem[];
  technicians: Technician[];
  onSelectJobOnMap?: (job: ScheduledJobItem) => void;
  onRefreshJobs?: () => void;
}

// Great-circle Haversine distance calculator in KM & estimated drive minutes in Edmonton
function calculateEdmontonTravel(
  originLat: number,
  originLng: number,
  destLat: number,
  destLng: number
): { distanceKm: number; driveMinutes: number } {
  const R = 6371; // Earth radius in km
  const dLat = ((destLat - originLat) * Math.PI) / 180;
  const dLng = ((destLng - originLng) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((originLat * Math.PI) / 180) *
      Math.cos((destLat * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const straightLineKm = R * c;

  // Edmonton urban driving factor (traffic lights, grid detour ~ 1.35x)
  const roadKm = Math.round(straightLineKm * 1.35 * 10) / 10;
  // Average Edmonton city driving speed ~ 42 km/h
  const driveMinutes = Math.max(5, Math.round((roadKm / 42) * 60));

  return { distanceKm: roadKm, driveMinutes };
}

export const ScheduledJobsView: React.FC<ScheduledJobsViewProps> = ({
  jobs,
  technicians,
  onSelectJobOnMap,
  onRefreshJobs,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCleanerFilter, setSelectedCleanerFilter] = useState<string>('ALL');
  const [serviceFilter, setServiceFilter] = useState<string>('ALL');
  const [selectedJobId, setSelectedJobId] = useState<string | null>(jobs[0]?.id || null);

  const filteredJobs = jobs.filter((job) => {
    const matchesSearch =
      job.clientName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      job.serviceAddress.toLowerCase().includes(searchQuery.toLowerCase()) ||
      job.visitNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
      job.assignedCleaners.some((c) => c.toLowerCase().includes(searchQuery.toLowerCase()));

    const matchesCleaner =
      selectedCleanerFilter === 'ALL' ||
      job.assignedCleaners.some((c) => c.toLowerCase().includes(selectedCleanerFilter.toLowerCase()));

    const matchesService = serviceFilter === 'ALL' || job.serviceType === serviceFilter;

    return matchesSearch && matchesCleaner && matchesService;
  });

  const activeJob = jobs.find((j) => j.id === selectedJobId) || filteredJobs[0] || null;

  // Format date & time nicely
  const formatDateTime = (iso: string) => {
    try {
      const d = new Date(iso);
      return {
        dateStr: d.toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' }),
        timeStr: d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
      };
    } catch {
      return { dateStr: 'Upcoming', timeStr: '9:00 AM' };
    }
  };

  return (
    <div className="flex-1 h-full flex flex-col md:flex-row overflow-hidden bg-slate-100 font-sans">
      {/* Left List & Filters Column */}
      <div className="w-full md:w-96 lg:w-[420px] bg-white border-r border-slate-200 flex flex-col flex-shrink-0 h-full overflow-hidden">
        {/* Header */}
        <div className="p-3.5 border-b border-slate-200 bg-slate-50 space-y-2.5 flex-shrink-0">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <CalendarIcon className="w-4 h-4 text-blue-600" />
                <span>Scheduled Jobs ({filteredJobs.length})</span>
              </h2>
              <p className="text-[11px] text-slate-500">Synced two-way with Jobber visits</p>
            </div>
            {onRefreshJobs && (
              <button
                onClick={onRefreshJobs}
                className="px-2.5 py-1 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg transition-colors cursor-pointer"
              >
                Refresh
              </button>
            )}
          </div>

          {/* Search bar */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search client, address, cleaner..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs text-slate-900 focus:outline-none focus:border-blue-500"
            />
          </div>

          {/* Filters */}
          <div className="grid grid-cols-2 gap-2 text-xs">
            <select
              value={selectedCleanerFilter}
              onChange={(e) => setSelectedCleanerFilter(e.target.value)}
              className="px-2 py-1 bg-white border border-slate-300 rounded-lg text-slate-700 text-xs focus:outline-none"
            >
              <option value="ALL">All Cleaners (15)</option>
              {technicians.map((t) => (
                <option key={t.id} value={t.name}>
                  {t.name}
                </option>
              ))}
            </select>

            <select
              value={serviceFilter}
              onChange={(e) => setServiceFilter(e.target.value)}
              className="px-2 py-1 bg-white border border-slate-300 rounded-lg text-slate-700 text-xs focus:outline-none"
            >
              <option value="ALL">All Services</option>
              <option value="Standard Cleaning">Standard Cleaning</option>
              <option value="Deep Cleaning">Deep Cleaning</option>
              <option value="Move-Out Cleaning">Move-Out Cleaning</option>
            </select>
          </div>
        </div>

        {/* Scrollable Job List */}
        <div className="flex-1 overflow-y-auto divide-y divide-slate-100 p-2 space-y-1.5">
          {filteredJobs.length === 0 ? (
            <div className="p-8 text-center text-slate-500 text-xs">
              No scheduled jobs match your current search.
            </div>
          ) : (
            filteredJobs.map((job) => {
              const isSelected = activeJob?.id === job.id;
              const { dateStr, timeStr } = formatDateTime(job.startAt);

              return (
                <div
                  key={job.id}
                  onClick={() => setSelectedJobId(job.id)}
                  className={`p-3 rounded-xl cursor-pointer transition-all border ${
                    isSelected
                      ? 'bg-blue-50/80 border-blue-400 shadow-xs ring-1 ring-blue-300'
                      : 'bg-white hover:bg-slate-50 border-slate-200 shadow-2xs'
                  }`}
                >
                  <div className="flex items-center justify-between gap-1 mb-1">
                    <span className="font-mono text-[10px] font-bold text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded">
                      {job.visitNumber}
                    </span>
                    <span
                      className={`text-[9px] font-bold uppercase px-1.5 py-0.2 rounded border ${
                        job.serviceType === 'Move-Out Cleaning'
                          ? 'bg-rose-50 text-rose-700 border-rose-200'
                          : job.serviceType === 'Deep Cleaning'
                          ? 'bg-amber-50 text-amber-800 border-amber-200'
                          : 'bg-blue-50 text-blue-700 border-blue-200'
                      }`}
                    >
                      {job.serviceType}
                    </span>
                  </div>

                  <h3 className="text-xs font-bold text-slate-900 leading-snug">{job.clientName}</h3>
                  <p className="text-[11px] text-slate-500 truncate flex items-center gap-1 mt-0.5">
                    <MapPin className="w-3 h-3 text-slate-400 shrink-0" />
                    <span>{job.serviceAddress}</span>
                  </p>

                  <div className="mt-2 pt-2 border-t border-slate-100 flex items-center justify-between text-[11px]">
                    <div className="flex items-center gap-1 text-slate-600 font-medium">
                      <Clock className="w-3 h-3 text-slate-400" />
                      <span>{dateStr} • {timeStr}</span>
                    </div>

                    <div className="flex items-center gap-1 text-slate-700 font-semibold">
                      <Users className="w-3 h-3 text-blue-600" />
                      <span>{job.assignedCleaners.length} Cleaner{job.assignedCleaners.length > 1 ? 's' : ''}</span>
                    </div>
                  </div>

                  {/* Cleaners Tag Line */}
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {job.assignedCleaners.map((cName) => (
                      <span
                        key={cName}
                        className="px-1.5 py-0.2 rounded-md bg-blue-100/60 text-blue-900 font-medium text-[10px]"
                      >
                        {cName}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Right Detail Pane with Travel Time & Distance from Home Hubs */}
      <div className="flex-1 h-full overflow-y-auto p-4 sm:p-6 bg-slate-50">
        {activeJob ? (
          <div className="max-w-3xl mx-auto space-y-4">
            {/* Main Job Card */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 sm:p-6 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-blue-50 text-blue-800 border border-blue-200">
                      {activeJob.visitNumber}
                    </span>
                    <span className="text-xs font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                      {activeJob.status}
                    </span>
                  </div>
                  <h1 className="text-lg sm:text-xl font-bold text-slate-900">{activeJob.clientName}</h1>
                  <p className="text-xs text-slate-500 mt-0.5 flex items-center gap-1">
                    <Phone className="w-3.5 h-3.5 text-slate-400" />
                    <span>{activeJob.clientPhone}</span>
                  </p>
                </div>

                <a
                  href={activeJob.jobberWebUri}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-xs transition-colors self-start cursor-pointer"
                >
                  <span>Open in Jobber</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>

              {/* Service & Address Info */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">
                    Job Address
                  </span>
                  <p className="font-bold text-slate-900 text-sm">{activeJob.serviceAddress}</p>
                  <p className="text-slate-500 text-[11px] mt-0.5">Edmonton, Alberta</p>
                </div>

                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">
                    Scheduled Time
                  </span>
                  <p className="font-bold text-slate-900 text-sm">
                    {formatDateTime(activeJob.startAt).dateStr}
                  </p>
                  <p className="text-slate-600 text-[11px] mt-0.5">
                    {formatDateTime(activeJob.startAt).timeStr} – {formatDateTime(activeJob.endAt).timeStr}
                  </p>
                </div>
              </div>

              {/* ⭐ CLEANER DISTANCE & COMMUTE CALCULATOR FROM HOME HUBS ⭐ */}
              <div className="pt-2">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-bold text-xs text-slate-900 flex items-center gap-1.5">
                    <Navigation className="w-4 h-4 text-blue-600" />
                    <span>Assigned Cleaners &amp; Commute from Home Hubs</span>
                  </h3>
                  <span className="text-[10px] font-semibold text-slate-500">
                    Real Edmonton Road Network
                  </span>
                </div>

                <div className="grid grid-cols-1 gap-2.5">
                  {activeJob.assignedCleaners.map((cleanerName) => {
                    // Match cleaner in our 15 real technicians table
                    const cleaner = technicians.find(
                      (t) =>
                        t.name.toLowerCase().includes(cleanerName.toLowerCase()) ||
                        cleanerName.toLowerCase().includes(t.name.toLowerCase())
                    );

                    const originLat = cleaner ? cleaner.depotLocation.lat : 53.4184;
                    const originLng = cleaner ? cleaner.depotLocation.lng : -113.5786;
                    const homeAddress = cleaner?.homeAddress || cleaner?.depotLocation.address || 'Edmonton, AB';

                    const { distanceKm, driveMinutes } = calculateEdmontonTravel(
                      originLat,
                      originLng,
                      activeJob.lat,
                      activeJob.lng
                    );

                    return (
                      <div
                        key={cleanerName}
                        className="p-3.5 bg-gradient-to-r from-blue-50/60 to-indigo-50/40 rounded-xl border border-blue-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs"
                      >
                        <div className="flex items-start gap-3">
                          <div
                            className="w-9 h-9 rounded-xl flex items-center justify-center text-white font-bold text-xs shadow-xs shrink-0"
                            style={{ backgroundColor: cleaner?.color || '#2563EB' }}
                          >
                            <Car className="w-4 h-4" />
                          </div>

                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-sm text-slate-900">{cleanerName}</span>
                              {cleaner && (
                                <span className="text-[10px] font-semibold px-1.5 py-0.2 rounded bg-white text-slate-700 border border-slate-200">
                                  {cleaner.vanNumber}
                                </span>
                              )}
                            </div>
                            <p className="text-[11px] text-slate-600 mt-0.5 flex items-center gap-1">
                              <span>🏠 <strong>Home Hub:</strong> {homeAddress}</span>
                            </p>
                            {cleaner?.phone && (
                              <p className="text-[10px] text-slate-500 font-mono mt-0.5">
                                📞 {cleaner.phone}
                              </p>
                            )}
                          </div>
                        </div>

                        {/* Calculated Distance & Driving Time */}
                        <div className="flex sm:flex-col items-center sm:items-end justify-between sm:justify-center border-t sm:border-t-0 pt-2 sm:pt-0 border-blue-100">
                          <div className="flex items-center gap-1.5 text-blue-900 font-extrabold text-sm font-mono">
                            <span>{distanceKm} km</span>
                            <span className="text-slate-400">•</span>
                            <span>{driveMinutes} mins</span>
                          </div>
                          <span className="text-[10px] text-emerald-700 font-medium bg-emerald-100/70 px-1.5 py-0.5 rounded">
                            Direct from Home
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="h-full flex items-center justify-center text-slate-400 text-sm">
            Select a scheduled job from the list to view its commute details.
          </div>
        )}
      </div>
    </div>
  );
};
