import React, { useState, useEffect, useCallback, useRef } from 'react';
import { APIProvider } from '@vis.gl/react-google-maps';
import { 
  Technician, 
  ServiceTicket, 
  UrgencyLevel, 
  AIRecommendation 
} from './types/dispatch';
import { INITIAL_TECHNICIANS, INITIAL_TICKETS } from './data/cleaningData';
import { computeTechnicianRoute } from './services/routesApi';
import { TerritoryMap } from './components/TerritoryMap';
import { DispatchKanban } from './components/DispatchKanban';
import { AiDispatchModal } from './components/AiDispatchModal';
import { DailyManifestModal } from './components/DailyManifestModal';
import { NewTicketModal } from './components/NewTicketModal';
import { JobberSyncModal } from './components/JobberSyncModal';
import { PublicBookingModal } from './components/PublicBookingModal';
import { QuoModal } from './components/QuoModal';
import { FleetSimulationBar } from './components/FleetSimulationBar';
import { useFleetSimulation } from './hooks/useFleetSimulation';
import { ScheduledJobsView, ScheduledJobItem } from './components/ScheduledJobsView';
import { QuotesView } from './components/QuotesView';
import { InvoicesView } from './components/InvoicesView';
import { JobberQuote, JobberInvoice } from './services/jobberSyncModules';
import { 
  Truck, 
  Flame, 
  Clock, 
  Wrench, 
  Sparkles, 
  Route, 
  Fuel, 
  Plus, 
  Layers, 
  RefreshCw,
  Zap,
  Play,
  CheckCircle2,
  MapPin,
  Maximize2,
  Minimize2,
  PanelRightClose,
  PanelRightOpen,
  ChevronUp,
  ChevronDown,
  Database,
  PhoneCall,
  Globe,
  Calendar,
  FileCheck,
  Receipt,
  Map as MapIcon
} from 'lucide-react';

export function App() {
  const [apiKey, setApiKey] = useState<string>(
    import.meta.env.VITE_GOOGLE_MAPS_API_KEY || ''
  );
  const [mapsAuthError, setMapsAuthError] = useState<boolean>(false);
  const [refererErrorUrl, setRefererErrorUrl] = useState<string | null>(null);
  const [quotaExceeded, setQuotaExceeded] = useState<boolean>(false);
  const [technicians, setTechnicians] = useState<Technician[]>(INITIAL_TECHNICIANS);
  const [tickets, setTickets] = useState<ServiceTicket[]>(INITIAL_TICKETS);
  const [selectedTechId, setSelectedTechId] = useState<string | null>('cleaner-1');
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [urgencyFilter, setUrgencyFilter] = useState<'ALL' | UrgencyLevel>('ALL');
  const [mobileView, setMobileView] = useState<'map' | 'board'>('map');
  const [kanbanActiveTab, setKanbanActiveTab] = useState<'BOARD' | 'UNASSIGNED'>('BOARD');
  const [isJobberModalOpen, setIsJobberModalOpen] = useState<boolean>(false);
  const [isPublicBookingModalOpen, setIsPublicBookingModalOpen] = useState<boolean>(false);
  const [isQuoModalOpen, setIsQuoModalOpen] = useState<boolean>(false);

  // Dedicated Top Bar Navigation Tabs: 'MAP' | 'SCHEDULED_JOBS' | 'QUOTES' | 'INVOICES'
  const [activeTopView, setActiveTopView] = useState<'MAP' | 'SCHEDULED_JOBS' | 'QUOTES' | 'INVOICES'>('MAP');
  const [scheduledJobsList, setScheduledJobsList] = useState<ScheduledJobItem[]>([]);
  const [quotesList, setQuotesList] = useState<JobberQuote[]>([]);
  const [invoicesList, setInvoicesList] = useState<JobberInvoice[]>([]);

  // Load persistent store on mount
  useEffect(() => {
    fetch('/api/store')
      .then((r) => r.json())
      .then((data) => {
        if (data) {
          if (data.tickets && data.tickets.length > 0) setTickets(data.tickets);
          if (data.scheduledVisits && data.scheduledVisits.length > 0) {
            setScheduledJobsList(
              data.scheduledVisits.map((v: any, idx: number) => ({
                id: v.id || `visit-${idx}`,
                visitNumber: v.visitNumber || `VISIT-${4000 + idx}`,
                title: v.title || 'Cleaning Service Visit',
                clientName: v.clientName || 'Jobber Client',
                clientPhone: v.clientPhone || '(780) 555-0100',
                serviceAddress: v.serviceAddress || '10405 Jasper Ave NW, Edmonton, AB',
                lat: 53.5412 + (idx % 3) * 0.02 - 0.01,
                lng: -113.4988 + (idx % 4) * 0.03 - 0.015,
                startAt: v.startAt || new Date().toISOString(),
                endAt: v.endAt || new Date(Date.now() + 3600000).toISOString(),
                assignedCleaners: v.assignedCleaners || ['Melissa Clarke', 'Joel Mbatchou'],
                serviceType: v.serviceType || 'Standard Cleaning',
                status: v.status || 'SCHEDULED',
                jobberWebUri: v.jobberWebUri || 'https://secure.getjobber.com',
              }))
            );
          }
          if (data.quotes && data.quotes.length > 0) setQuotesList(data.quotes);
          if (data.invoices && data.invoices.length > 0) setInvoicesList(data.invoices);
        }
      })
      .catch((err) => console.warn('Could not load persistent store:', err));
  }, []);

  // Save tickets to local persistent database whenever updated
  const saveStateToStore = useCallback((updatedTickets: ServiceTicket[]) => {
    fetch('/api/store/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tickets: updatedTickets }),
    }).catch((err) => console.warn('Store save note:', err));
  }, []);

  // Responsive layout & collapsible component states
  const [isBoardCollapsed, setIsBoardCollapsed] = useState<boolean>(false);
  const [mobileSheetState, setMobileSheetState] = useState<'collapsed' | 'half' | 'full'>('collapsed');
  const [isLandscapeDrawerOpen, setIsLandscapeDrawerOpen] = useState<boolean>(false);

  // Viewport mode detection for mobile portrait, mobile landscape, tablet, and desktop
  const [viewportMode, setViewportMode] = useState<{
    isMobilePortrait: boolean;
    isMobileLandscape: boolean;
    isTablet: boolean;
    isDesktop: boolean;
  }>(() => {
    if (typeof window === 'undefined') {
      return { isMobilePortrait: false, isMobileLandscape: false, isTablet: false, isDesktop: true };
    }
    const w = window.innerWidth;
    const h = window.innerHeight;
    const isLandscape = w > h;
    const isMobileLand = isLandscape && (h <= 540 || (w < 960 && h < 600));
    const isMobilePort = !isLandscape && w < 768;
    const isTab = !isMobileLand && !isMobilePort && w < 1024;
    return {
      isMobilePortrait: isMobilePort,
      isMobileLandscape: isMobileLand,
      isTablet: isTab,
      isDesktop: !isMobileLand && !isMobilePort && !isTab,
    };
  });

  useEffect(() => {
    const handleResize = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      const isLandscape = w > h;
      const isMobileLand = isLandscape && (h <= 540 || (w < 960 && h < 600));
      const isMobilePort = !isLandscape && w < 768;
      const isTab = !isMobileLand && !isMobilePort && w < 1024;
      setViewportMode({
        isMobilePortrait: isMobilePort,
        isMobileLandscape: isMobileLand,
        isTablet: isTab,
        isDesktop: !isMobileLand && !isMobilePort && !isTab,
      });
    };

    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleResize);
    };
  }, []);

  // Mobile bottom sheet touch swipe gestures
  const touchStartYRef = useRef<number | null>(null);

  const handleSheetTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartYRef.current = e.touches[0].clientY;
  }, []);

  const handleSheetTouchEnd = useCallback((e: React.TouchEvent) => {
    if (touchStartYRef.current === null) return;
    const endY = e.changedTouches[0].clientY;
    const diffY = touchStartYRef.current - endY;
    touchStartYRef.current = null;

    if (diffY > 35) {
      // Swiped upwards: expand to next level
      setMobileSheetState((s) => (s === 'collapsed' ? 'half' : 'full'));
    } else if (diffY < -35) {
      // Swiped downwards: collapse to lower level
      setMobileSheetState((s) => (s === 'full' ? 'half' : 'collapsed'));
    }
  }, []);

  // Primary toggle button on peek bar:
  // When 'collapsed': clicking opens to 'half'.
  // When 'half' or 'full': button says 'Collapse' and clicking it IMMEDIATELY COLLAPSES to 'collapsed'
  const handlePrimarySheetToggle = useCallback((e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setMobileSheetState((s) => (s === 'collapsed' ? 'half' : 'collapsed'));
  }, []);

  // Full-screen toggle button
  const handleToggleFullScreen = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setMobileSheetState((s) => (s === 'full' ? 'half' : 'full'));
  }, []);
  const [isSimBarMinimized, setIsSimBarMinimized] = useState<boolean>(
    typeof window !== 'undefined' ? window.innerWidth < 1024 : false
  );
  const [isZenMode, setIsZenMode] = useState<boolean>(false);

  // Modals state
  const [isAiModalOpen, setIsAiModalOpen] = useState(false);
  const [manifestTech, setManifestTech] = useState<Technician | null>(null);
  const [isNewTicketModalOpen, setIsNewTicketModalOpen] = useState(false);
  const [isRecalculating, setIsRecalculating] = useState(false);

  // Fleet Multi-Vehicle Route Simulation Engine
  const simulation = useFleetSimulation({
    technicians,
    tickets,
    setTechnicians,
    setTickets,
  });

  // Listen for Google Maps quota exceeded event
  useEffect(() => {
    const handleQuota = () => {
      setQuotaExceeded(true);
    };
    window.addEventListener('gmp-quota-exceeded', handleQuota);
    return () => {
      window.removeEventListener('gmp-quota-exceeded', handleQuota);
    };
  }, []);

  // Listen for Google Maps auth failures (e.g. ApiProjectMapError or RefererNotAllowedMapError)
  useEffect(() => {
    const handleAuthFailure = () => {
      console.warn('Google Maps API Auth or Target Blocked detected. Enabling interactive vector territory map.');
      setMapsAuthError(true);
    };

    const handleRefererError = (e: Event) => {
      const customEvent = e as CustomEvent<{ url?: string }>;
      const origin = customEvent.detail?.url || (typeof window !== 'undefined' ? window.location.origin : '');
      console.warn('Google Maps API Referer Restriction detected for origin:', origin);
      setRefererErrorUrl(origin);
      setMapsAuthError(true);
    };

    window.addEventListener('google-maps-auth-failure', handleAuthFailure);
    window.addEventListener('google-maps-referer-error', handleRefererError);
    (window as any).gm_authFailure = handleAuthFailure;

    return () => {
      window.removeEventListener('google-maps-auth-failure', handleAuthFailure);
      window.removeEventListener('google-maps-referer-error', handleRefererError);
    };
  }, []);

  // Fetch backend Google Maps key if not in import.meta.env
  useEffect(() => {
    if (!apiKey) {
      fetch('/api/config')
        .then((res) => res.json())
        .then((data) => {
          if (data.mapsApiKey) {
            setApiKey(data.mapsApiKey);
          }
        })
        .catch((err) => console.warn('Could not load backend map config:', err));
    }
  }, [apiKey]);

  // Initial calculation of routes for all technicians on mount
  useEffect(() => {
    async function calculateInitialRoutes() {
      setIsRecalculating(true);
      const updatedTechs = await Promise.all(
        technicians.map(async (tech) => {
          if (tech.assignedTicketIds.length > 0) {
            const metrics = await computeTechnicianRoute(tech, tickets);
            return { ...tech, routeMetrics: metrics };
          }
          return tech;
        })
      );
      setTechnicians(updatedTechs);
      setIsRecalculating(false);
    }

    calculateInitialRoutes();
  }, []);

  // Recalculates route for a single technician when tickets change
  const recalculateSingleTechRoute = useCallback(
    async (techId: string, currentTickets: ServiceTicket[], currentTechs: Technician[]) => {
      const tech = currentTechs.find((t) => t.id === techId);
      if (!tech) return;

      const metrics = await computeTechnicianRoute(tech, currentTickets);
      setTechnicians((prevTechs) =>
        prevTechs.map((t) => (t.id === techId ? { ...t, routeMetrics: metrics } : t))
      );
    },
    []
  );

  // Drag and drop assignment handler
  const handleAssignTicket = useCallback(
    async (ticketId: string, techId: string) => {
      const ticketToAssign = tickets.find((t) => t.id === ticketId);
      const targetTech = technicians.find((t) => t.id === techId);
      if (!ticketToAssign || !targetTech) return;

      const previousTechId = ticketToAssign.assignedTechId;

      // 1. Update ticket model
      const updatedTickets = tickets.map((t) => {
        if (t.id === ticketId) {
          return {
            ...t,
            assignedTechId: techId,
            status: 'ASSIGNED' as const,
            stopSequence: targetTech.assignedTicketIds.length + 1,
          };
        }
        return t;
      });
      setTickets(updatedTickets);

      // 2. Update technicians model
      const updatedTechs = technicians.map((t) => {
        if (t.id === techId) {
          const newIds = t.assignedTicketIds.includes(ticketId)
            ? t.assignedTicketIds
            : [...t.assignedTicketIds, ticketId];
          return { ...t, assignedTicketIds: newIds };
        }
        if (previousTechId && t.id === previousTechId) {
          return {
            ...t,
            assignedTicketIds: t.assignedTicketIds.filter((id) => id !== ticketId),
          };
        }
        return t;
      });
      setTechnicians(updatedTechs);
      setSelectedTechId(techId);

      // 3. Recalculate routes for affected technicians via Routes API
      await recalculateSingleTechRoute(techId, updatedTickets, updatedTechs);
      if (previousTechId && previousTechId !== techId) {
        await recalculateSingleTechRoute(previousTechId, updatedTickets, updatedTechs);
      }
    },
    [tickets, technicians, recalculateSingleTechRoute]
  );

  // Unassign ticket back to pending queue
  const handleUnassignTicket = useCallback(
    async (ticketId: string) => {
      const ticket = tickets.find((t) => t.id === ticketId);
      if (!ticket || !ticket.assignedTechId) return;

      const prevTechId = ticket.assignedTechId;

      const updatedTickets = tickets.map((t) => {
        if (t.id === ticketId) {
          return {
            ...t,
            assignedTechId: undefined,
            status: 'UNASSIGNED' as const,
            stopSequence: undefined,
          };
        }
        return t;
      });
      setTickets(updatedTickets);

      const updatedTechs = technicians.map((t) => {
        if (t.id === prevTechId) {
          return {
            ...t,
            assignedTicketIds: t.assignedTicketIds.filter((id) => id !== ticketId),
          };
        }
        return t;
      });
      setTechnicians(updatedTechs);

      await recalculateSingleTechRoute(prevTechId, updatedTickets, updatedTechs);
    },
    [tickets, technicians, recalculateSingleTechRoute]
  );

  // Reorder tickets within a technician's schedule
  const handleReorderTechTickets = useCallback(
    async (techId: string, reorderedTicketIds: string[]) => {
      const updatedTickets = tickets.map((t) => {
        const idx = reorderedTicketIds.indexOf(t.id);
        if (idx !== -1) {
          return { ...t, stopSequence: idx + 1 };
        }
        return t;
      });
      setTickets(updatedTickets);

      const updatedTechs = technicians.map((t) => {
        if (t.id === techId) {
          return { ...t, assignedTicketIds: reorderedTicketIds };
        }
        return t;
      });
      setTechnicians(updatedTechs);

      await recalculateSingleTechRoute(techId, updatedTickets, updatedTechs);
    },
    [tickets, technicians, recalculateSingleTechRoute]
  );

  // Apply batch recommendations from AI Dispatch Assistant
  const handleBatchApplyRecommendations = useCallback(
    async (recommendations: AIRecommendation[]) => {
      setIsRecalculating(true);
      let curTickets = [...tickets];
      let curTechs = [...technicians];

      recommendations.forEach((rec) => {
        curTickets = curTickets.map((t) => {
          if (t.id === rec.ticketId) {
            const targetTech = curTechs.find((tech) => tech.id === rec.recommendedTechId);
            return {
              ...t,
              assignedTechId: rec.recommendedTechId,
              status: 'ASSIGNED' as const,
              stopSequence: (targetTech?.assignedTicketIds.length || 0) + 1,
            };
          }
          return t;
        });

        curTechs = curTechs.map((t) => {
          if (t.id === rec.recommendedTechId) {
            const exists = t.assignedTicketIds.includes(rec.ticketId);
            return exists
              ? t
              : { ...t, assignedTicketIds: [...t.assignedTicketIds, rec.ticketId] };
          }
          // Remove from previous technician if reassigned to prevent duplicate assignments
          if (t.assignedTicketIds.includes(rec.ticketId)) {
            return {
              ...t,
              assignedTicketIds: t.assignedTicketIds.filter((id) => id !== rec.ticketId),
            };
          }
          return t;
        });
      });

      setTickets(curTickets);

      // Recalculate routes for all technicians
      const updatedTechsWithRoutes = await Promise.all(
        curTechs.map(async (tech) => {
          if (tech.assignedTicketIds.length > 0) {
            const metrics = await computeTechnicianRoute(tech, curTickets);
            return { ...tech, routeMetrics: metrics };
          }
          return tech;
        })
      );

      setTechnicians(updatedTechsWithRoutes);
      setIsRecalculating(false);
    },
    [tickets, technicians]
  );

  // Apply single AI recommendation
  const handleApplySingleRecommendation = useCallback(
    (rec: AIRecommendation) => {
      handleAssignTicket(rec.ticketId, rec.recommendedTechId);
    },
    [handleAssignTicket]
  );

  // Add new user-created service ticket
  const handleCreateTicket = useCallback(
    (newTicket: ServiceTicket) => {
      setTickets((prev) => [newTicket, ...prev]);
      setSelectedTicketId(newTicket.id);
    },
    []
  );

  // High-level KPI aggregations
  const totalEmergencyCount = tickets.filter(
    (t) => t.urgency === 'EMERGENCY' && t.status !== 'COMPLETED'
  ).length;
  const unassignedCount = tickets.filter((t) => !t.assignedTechId).length;
  const totalFleetMiles = technicians.reduce(
    (acc, t) => acc + (t.routeMetrics?.totalDistanceMiles || 0),
    0
  );
  const totalEstimatedFuel = technicians.reduce(
    (acc, t) => acc + (t.routeMetrics?.estimatedFuelGallons || 0),
    0
  );

  // Live Date/Time for header
  const [currentTime, setCurrentTime] = useState<string>(
    new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
  );
  const [currentDate] = useState<string>(
    new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
  );

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }));
    }, 10000);
    return () => clearInterval(timer);
  }, []);

  return (
    <APIProvider 
      apiKey={apiKey}
      region="US"
      language="en"
      solutionChannel="gmp_mcp_codeassist_v1_aistudio"
      onError={(err) => {
        console.warn('APIProvider error:', err);
        setMapsAuthError(true);
      }}
    >
      <div id="cleaning-dispatch-app" className="w-screen h-screen flex flex-col bg-slate-50 text-slate-900 font-sans select-none overflow-hidden">
        {/* Quota or Rate Limit Notification Banner */}
        {quotaExceeded && (
          <div className="bg-amber-50 border-b border-amber-200 text-amber-900 px-4 py-2.5 text-xs md:text-sm text-center sticky top-0 z-50 shadow-sm flex-shrink-0">
            <span>
              Google Maps Platform API quota or request limit reached. Please check your Google Cloud Console quota and billing settings.
            </span>
          </div>
        )}

        {/* Full-Screen Zen Mode Exit Pill */}
        {isZenMode && (
          <div className="absolute top-4 left-4 z-50 animate-fadeIn pointer-events-auto">
            <button
              onClick={() => setIsZenMode(false)}
              className="min-h-[42px] px-3.5 py-2 rounded-xl bg-slate-900/90 hover:bg-slate-900 text-white text-xs font-bold flex items-center gap-2 shadow-2xl backdrop-blur-md border border-slate-750 cursor-pointer transition-all active:scale-95"
              aria-label="Exit full map mode"
            >
              <Minimize2 className="w-4 h-4 text-blue-400" />
              <span>Exit Full Map</span>
            </button>
          </div>
        )}

        {/* Global Top Application Navigation Bar (Collapsible in Zen Mode, Compact in Mobile Landscape) */}
        {!isZenMode && (
          <header
            id="global-header"
            className="h-14 min-h-[56px] landscape:max-md:h-11 landscape:max-md:min-h-[44px] px-2 sm:px-3 md:px-4 lg:px-5 bg-white border-b border-slate-200 flex items-center justify-between flex-shrink-0 z-20 shadow-xs gap-1.5 sm:gap-2.5 md:gap-3 overflow-x-auto no-scrollbar"
          >
            {/* Brand & Identity */}
            <div className="flex items-center gap-1.5 sm:gap-2.5 min-w-0 flex-shrink">
              <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white shadow-xs flex-shrink-0">
                <Sparkles className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-white" />
              </div>
              <div className="flex flex-col justify-center min-w-0">
                <div className="flex items-center gap-1.5 whitespace-nowrap">
                  <h1 className="text-xs sm:text-sm md:text-base font-bold tracking-tight text-slate-800 leading-tight truncate">
                    <span className="hidden sm:inline">Cleaning Dispatch Pro</span>
                    <span className="sm:hidden">Clean Dispatch</span>
                  </h1>
                  <span className="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 font-semibold text-[9px] uppercase tracking-wider leading-none hidden sm:inline-block">
                    Edmonton, AB Canada
                  </span>
                </div>
                <p className="text-[10px] text-slate-500 leading-tight whitespace-nowrap hidden 2xl:block">
                  15 Decentralized Home Hubs • 3 Core Services • Jobber Sync
                </p>
              </div>
            </div>

            {/* Dedicated Top Bar Primary Navigation Tabs */}
            <div className="flex items-center gap-1 bg-slate-100/90 p-1 rounded-xl border border-slate-200 flex-shrink-0">
              <button
                id="nav-tab-map"
                onClick={() => setActiveTopView('MAP')}
                className={`min-h-[34px] px-3 py-1 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                  activeTopView === 'MAP'
                    ? 'bg-white text-blue-700 shadow-2xs border border-slate-200'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <MapIcon className="w-3.5 h-3.5 text-blue-600" />
                <span>Dispatch Map</span>
              </button>

              <button
                id="nav-tab-jobs"
                onClick={() => setActiveTopView('SCHEDULED_JOBS')}
                className={`min-h-[34px] px-3 py-1 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                  activeTopView === 'SCHEDULED_JOBS'
                    ? 'bg-white text-blue-700 shadow-2xs border border-slate-200'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Calendar className="w-3.5 h-3.5 text-indigo-600" />
                <span>Scheduled Jobs</span>
                {scheduledJobsList.length > 0 && (
                  <span className="px-1.5 py-0.2 rounded-full bg-blue-100 text-blue-800 text-[10px] font-mono">
                    {scheduledJobsList.length}
                  </span>
                )}
              </button>

              <button
                id="nav-tab-quotes"
                onClick={() => setActiveTopView('QUOTES')}
                className={`min-h-[34px] px-3 py-1 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                  activeTopView === 'QUOTES'
                    ? 'bg-white text-amber-800 shadow-2xs border border-slate-200'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <FileCheck className="w-3.5 h-3.5 text-amber-600" />
                <span>Quotes</span>
              </button>

              <button
                id="nav-tab-invoices"
                onClick={() => setActiveTopView('INVOICES')}
                className={`min-h-[34px] px-3 py-1 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                  activeTopView === 'INVOICES'
                    ? 'bg-white text-emerald-800 shadow-2xs border border-slate-200'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Receipt className="w-3.5 h-3.5 text-emerald-600" />
                <span>Invoices</span>
              </button>
            </div>

            {/* Right Header Actions & Controls */}
            <div className="flex items-center gap-1 sm:gap-1.5 md:gap-2 flex-shrink-0">
              <div className="hidden 2xl:block text-right border-r border-slate-200 pr-2.5 whitespace-nowrap">
                <p className="text-[9px] font-medium text-slate-500 uppercase tracking-tighter">{currentDate}</p>
                <p className="text-xs font-bold text-slate-800 font-mono leading-tight">{currentTime}</p>
              </div>

              {/* Toggle Dispatch Board (Collapses side panel to give map 100% full width) */}
              <button
                id="topbar-toggle-board-btn"
                onClick={() => {
                  if (viewportMode.isMobileLandscape) {
                    setIsLandscapeDrawerOpen((prev) => !prev);
                  } else if (viewportMode.isMobilePortrait) {
                    setMobileSheetState((s) => (s === 'collapsed' ? 'half' : 'collapsed'));
                  } else {
                    setIsBoardCollapsed((c) => !c);
                  }
                }}
                className={`min-h-[34px] sm:min-h-[36px] landscape:max-md:min-h-[32px] px-2 sm:px-2.5 md:px-3 py-1 sm:py-1.5 landscape:max-md:py-1 rounded-xl border text-xs font-semibold flex items-center gap-1 sm:gap-1.5 shadow-2xs transition-colors cursor-pointer flex-shrink-0 ${
                  (viewportMode.isMobileLandscape && !isLandscapeDrawerOpen) ||
                  (viewportMode.isMobilePortrait && mobileSheetState === 'collapsed') ||
                  (!viewportMode.isMobileLandscape && !viewportMode.isMobilePortrait && isBoardCollapsed)
                    ? 'bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100'
                    : 'bg-slate-50 hover:bg-slate-100 border-slate-200 text-slate-700'
                }`}
                title="Toggle Dispatch Board"
                aria-label="Toggle Dispatch Board"
              >
                {(viewportMode.isMobileLandscape && !isLandscapeDrawerOpen) ||
                (viewportMode.isMobilePortrait && mobileSheetState === 'collapsed') ||
                (!viewportMode.isMobileLandscape && !viewportMode.isMobilePortrait && isBoardCollapsed) ? (
                  <>
                    <PanelRightOpen className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-blue-600 shrink-0" />
                    <span className="hidden md:inline landscape:max-md:hidden">Show Board</span>
                    {unassignedCount > 0 && (
                      <span className="min-w-[18px] h-4 px-1 rounded-full bg-red-600 text-white text-[10px] font-bold flex items-center justify-center font-mono leading-none">
                        {unassignedCount}
                      </span>
                    )}
                  </>
                ) : (
                  <>
                    <PanelRightClose className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-slate-600 shrink-0" />
                    <span className="hidden md:inline landscape:max-md:hidden">Hide Board</span>
                  </>
                )}
              </button>

              {/* Full Screen Zen Map Focus Button (Only on large screens where space is plentiful) */}
              <button
                id="topbar-zen-mode-btn"
                onClick={() => setIsZenMode(true)}
                className="hidden xl:flex min-h-[34px] sm:min-h-[36px] px-2.5 py-1.5 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 text-xs font-semibold items-center gap-1 shadow-2xs transition-colors cursor-pointer flex-shrink-0"
                title="Full Screen Map Mode (hides all chrome and panels)"
                aria-label="Full screen map mode"
              >
                <Maximize2 className="w-3.5 h-3.5 text-slate-600" />
                <span>Full Map</span>
              </button>

              {/* Quo 5-Line Phone System Button */}
              <button
                id="topbar-quo-btn"
                onClick={() => setIsQuoModalOpen(true)}
                className="min-h-[34px] sm:min-h-[36px] landscape:max-md:min-h-[32px] px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-xl bg-violet-50 hover:bg-violet-100 text-violet-800 border border-violet-300 text-xs font-bold flex items-center gap-1.5 transition-all shadow-2xs whitespace-nowrap cursor-pointer flex-shrink-0"
                title="Quo (OpenPhone) 5-Line System: Call tracking and Sona voice transcription"
                aria-label="Open Quo Phone Integration"
              >
                <PhoneCall className="w-3.5 h-3.5 text-violet-600 shrink-0" aria-hidden="true" />
                <span className="hidden sm:inline">Quo (5 Lines)</span>
                <span className="sm:hidden">Quo</span>
              </button>

              {/* Book Online (Option A Intake for bookmycleaning.net) */}
              <button
                id="topbar-public-book-btn"
                onClick={() => setIsPublicBookingModalOpen(true)}
                className="min-h-[34px] sm:min-h-[36px] landscape:max-md:min-h-[32px] px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-xl bg-teal-50 hover:bg-teal-100 text-teal-800 border border-teal-300 text-xs font-bold flex items-center gap-1.5 transition-all shadow-2xs whitespace-nowrap cursor-pointer flex-shrink-0"
                title="Public Customer Booking Form for bookmycleaning.net"
                aria-label="Open Public Booking Form"
              >
                <Globe className="w-3.5 h-3.5 text-teal-600 shrink-0" aria-hidden="true" />
                <span className="hidden sm:inline">Book Online</span>
                <span className="sm:hidden">Book</span>
              </button>

              {/* Jobber Integration Hub Button */}
              <button
                id="topbar-jobber-btn"
                onClick={() => setIsJobberModalOpen(true)}
                className="min-h-[34px] sm:min-h-[36px] landscape:max-md:min-h-[32px] px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-300 text-xs font-bold flex items-center gap-1.5 transition-all shadow-2xs whitespace-nowrap cursor-pointer flex-shrink-0"
                title="Jobber Integration: Sync clients, invoices, quotes & visits"
                aria-label="Open Jobber Integration Hub"
              >
                <Database className="w-3.5 h-3.5 text-emerald-600 shrink-0" aria-hidden="true" />
                <span className="hidden sm:inline">Jobber Sync</span>
                <span className="sm:hidden">Jobber</span>
              </button>

              {/* Create Service Ticket Button */}
              <button
                id="topbar-new-ticket-btn"
                onClick={() => setIsNewTicketModalOpen(true)}
                className="min-h-[34px] sm:min-h-[36px] landscape:max-md:min-h-[32px] px-2 sm:px-2.5 md:px-3 py-1 sm:py-1.5 landscape:max-md:py-1 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold flex items-center gap-1 sm:gap-1.5 transition-colors shadow-xs whitespace-nowrap cursor-pointer flex-shrink-0"
                aria-label="Create New Service Ticket with Voice or Text"
                title="Create New Service Ticket (Microphone Voice-to-Text Supported)"
              >
                <Plus className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-blue-400 shrink-0" aria-hidden="true" />
                <span>Ticket</span>
              </button>

              {/* Desktop/Tablet Simulation Trigger in Header (Hidden on mobile portrait & landscape where FleetSimulationBar is immediately visible) */}
              <button
                id="topbar-simulation-btn"
                onClick={simulation.isRunning && !simulation.isPaused ? simulation.pauseSimulation : simulation.startSimulation}
                className={`hidden md:flex landscape:max-md:hidden min-h-[34px] sm:min-h-[36px] px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-xl text-xs font-bold items-center gap-1.5 transition-all shadow-xs active:scale-95 whitespace-nowrap cursor-pointer flex-shrink-0 ${
                  simulation.isRunning && !simulation.isPaused
                    ? 'bg-amber-500 hover:bg-amber-400 text-slate-950'
                    : 'bg-emerald-600 hover:bg-emerald-500 text-white'
                }`}
                title="Simulate both mobile cleaning vans executing scheduled service stops"
              >
                {simulation.isRunning && !simulation.isPaused ? (
                  <>
                    <Clock className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Pause</span>
                  </>
                ) : (
                  <>
                    <Play className="w-3.5 h-3.5 fill-current" aria-hidden="true" />
                    <span>Simulate</span>
                  </>
                )}
              </button>

              {/* AI Dispatch Assistant Button - Always fully visible, never clipped or cut off */}
              <button
                id="topbar-ai-dispatcher-btn"
                onClick={() => setIsAiModalOpen(true)}
                className="min-h-[34px] sm:min-h-[36px] landscape:max-md:min-h-[32px] px-2.5 sm:px-3 py-1 sm:py-1.5 landscape:max-md:py-1 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold flex items-center gap-1.5 shadow-xs active:scale-95 transition-all whitespace-nowrap cursor-pointer flex-shrink-0"
                aria-label="Open AI Dispatch Assistant"
                title="Open AI Dispatch Assistant"
              >
                <Sparkles className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-blue-200 shrink-0" aria-hidden="true" />
                <span className="font-semibold">AI Dispatch</span>
              </button>
            </div>
          </header>
        )}

        {/* Global Multi-Vehicle Route Simulation Control Bar (Minimizable to save map space) */}
        {!isZenMode && activeTopView === 'MAP' && (
          <FleetSimulationBar
            isRunning={simulation.isRunning}
            isPaused={simulation.isPaused}
            speedMultiplier={simulation.speedMultiplier}
            onSetSpeed={simulation.setSpeedMultiplier}
            onStart={simulation.startSimulation}
            onPause={simulation.pauseSimulation}
            onReset={simulation.resetSimulation}
            fleetProgressPercent={simulation.fleetProgressPercent}
            completedTicketsCount={simulation.completedTicketsCount}
            inProgressTicketsCount={simulation.inProgressTicketsCount}
            enRouteTicketsCount={simulation.enRouteTicketsCount}
            totalAssignedTickets={simulation.totalAssignedTickets}
            events={simulation.events}
            activeMessage={simulation.activeMessage}
            isMinimized={isSimBarMinimized}
            onToggleMinimize={() => setIsSimBarMinimized(!isSimBarMinimized)}
          />
        )}

        {/* View Switching: Scheduled Jobs, Quotes, Invoices, or Main Dispatch Map */}
        {activeTopView === 'SCHEDULED_JOBS' ? (
          <ScheduledJobsView
            jobs={scheduledJobsList}
            technicians={technicians}
            onRefreshJobs={() => {
              fetch('/api/jobber/sync-calendar', { method: 'POST' })
                .then((r) => r.json())
                .then((data) => {
                  if (data.visits) {
                    setScheduledJobsList(
                      data.visits.map((v: any, idx: number) => ({
                        id: v.id || `visit-${idx}`,
                        visitNumber: v.visitNumber || `VISIT-${4000 + idx}`,
                        title: v.title || 'Cleaning Service Visit',
                        clientName: v.clientName || 'Jobber Client',
                        clientPhone: v.clientPhone || '(780) 555-0100',
                        serviceAddress: v.serviceAddress || '10405 Jasper Ave NW, Edmonton, AB',
                        lat: 53.5412 + (idx % 3) * 0.02 - 0.01,
                        lng: -113.4988 + (idx % 4) * 0.03 - 0.015,
                        startAt: v.startAt || new Date().toISOString(),
                        endAt: v.endAt || new Date(Date.now() + 3600000).toISOString(),
                        assignedCleaners: v.assignedCleaners || ['Melissa Clarke', 'Joel Mbatchou'],
                        serviceType: v.serviceType || 'Standard Cleaning',
                        status: v.status || 'SCHEDULED',
                        jobberWebUri: v.jobberWebUri || 'https://secure.getjobber.com',
                      }))
                    );
                  }
                });
            }}
          />
        ) : activeTopView === 'QUOTES' ? (
          <QuotesView
            quotes={quotesList}
            onRefreshQuotes={() => {
              fetch('/api/jobber/sync-quotes', { method: 'POST' })
                .then((r) => r.json())
                .then((data) => {
                  if (data.quotes) setQuotesList(data.quotes);
                });
            }}
          />
        ) : activeTopView === 'INVOICES' ? (
          <InvoicesView
            invoices={invoicesList}
            onRefreshInvoices={() => {
              fetch('/api/jobber/sync-invoices', { method: 'POST' })
                .then((r) => r.json())
                .then((data) => {
                  if (data.invoices) setInvoicesList(data.invoices);
                });
            }}
          />
        ) : (
          /* Main Dashboard: Dedicated Full-Bleed Map Backdrop with Collapsible Layered Panes */
          <main id="main-split-dashboard" className="flex-1 relative overflow-hidden bg-slate-50 flex flex-col md:flex-row">
          {/* Territory Map Panel - ALWAYS mounted and visible across ALL devices */}
          <section
            id="panel-map-view"
            role="region"
            aria-label="Interactive Territory Map"
            className="flex-1 h-full w-full relative overflow-hidden bg-slate-100 z-0"
          >
            <TerritoryMap
              technicians={technicians}
              tickets={tickets}
              selectedTechId={selectedTechId}
              onSelectTech={setSelectedTechId}
              selectedTicketId={selectedTicketId}
              onSelectTicket={setSelectedTicketId}
              urgencyFilter={urgencyFilter}
              onUrgencyFilterChange={setUrgencyFilter}
              onAssignTicketToTech={handleAssignTicket}
              isMapsAuthError={mapsAuthError}
              refererErrorUrl={refererErrorUrl}
            />
          </section>

          {/* Floating Trigger for Mobile Landscape Side Drawer */}
          {viewportMode.isMobileLandscape && !isLandscapeDrawerOpen && (
            <div className="absolute top-3 right-3 z-30 pointer-events-auto">
              <button
                onClick={() => setIsLandscapeDrawerOpen(true)}
                className="min-h-[38px] px-3 py-1.5 rounded-xl bg-slate-900/90 hover:bg-slate-900 backdrop-blur-md text-white text-xs font-bold flex items-center gap-1.5 shadow-lg border border-slate-700 cursor-pointer active:scale-95"
                aria-label="Open Dispatch Board Drawer"
              >
                <Truck className="w-3.5 h-3.5 text-blue-400" />
                <span>Board ({unassignedCount})</span>
              </button>
            </div>
          )}

          {/* Tablet Backdrop Overlay when Drawer is Open (Tablet Portrait) */}
          {viewportMode.isTablet && !isBoardCollapsed && (
            <div
              onClick={() => setIsBoardCollapsed(true)}
              className="absolute inset-0 bg-slate-900/30 backdrop-blur-xs z-20 cursor-pointer transition-opacity"
              aria-label="Close dispatch board drawer"
            />
          )}

          {/* Mobile Landscape Backdrop Overlay when Drawer is Open */}
          {viewportMode.isMobileLandscape && isLandscapeDrawerOpen && (
            <div
              id="mobile-landscape-backdrop"
              onClick={() => setIsLandscapeDrawerOpen(false)}
              className="fixed inset-0 top-11 bg-slate-950/40 backdrop-blur-xs z-35 cursor-pointer animate-fadeIn"
              aria-label="Close dispatch board drawer"
            />
          )}

          {/* Mobile Portrait Backdrop Overlay when Bottom Sheet is expanded (half or full) */}
          {viewportMode.isMobilePortrait && mobileSheetState !== 'collapsed' && (
            <div
              id="mobile-sheet-backdrop"
              onClick={() => setMobileSheetState('collapsed')}
              className="fixed inset-0 bg-slate-950/40 backdrop-blur-xs z-35 transition-opacity animate-fadeIn cursor-pointer"
              aria-label="Close dispatch board"
            />
          )}

          {/* Kanban Dispatch Queue Panel:
              - Mobile Portrait: Bottom Sheet (Peek bar, Half sheet, Full sheet)
              - Mobile Landscape: Sliding Off-Canvas Right Drawer
              - Tablet Portrait: Slide-Over Overlay Drawer (Map keeps 100% width)
              - Desktop: Collapsible Side Panel (Zero empty space when collapsed)
          */}
          <section
            id="panel-board-view"
            role="region"
            aria-label="Fleet Dispatch Board"
            className={`
              ${
                viewportMode.isMobileLandscape
                  ? `fixed top-11 right-0 bottom-0 z-40 w-[330px] sm:w-[360px] h-[calc(100%-44px)] bg-white shadow-2xl border-l border-slate-200 flex flex-col transition-transform duration-300 ease-in-out ${
                      isLandscapeDrawerOpen ? 'translate-x-0 pointer-events-auto' : 'translate-x-full pointer-events-none'
                    }`
                  : viewportMode.isMobilePortrait
                  ? `fixed inset-x-0 bottom-0 z-40 bg-white rounded-t-2xl shadow-2xl flex flex-col transition-transform duration-300 ease-in-out pointer-events-auto h-[86vh] ${
                      mobileSheetState === 'collapsed'
                        ? 'translate-y-[calc(100%-56px)]'
                        : mobileSheetState === 'half'
                        ? 'translate-y-[45%]'
                        : 'translate-y-0'
                    }`
                  : viewportMode.isTablet
                  ? `absolute top-0 right-0 bottom-0 z-40 w-[420px] h-full shadow-2xl bg-white border-l border-slate-200 flex flex-col transition-transform duration-300 ease-in-out ${
                      isBoardCollapsed ? 'translate-x-full pointer-events-none' : 'translate-x-0 pointer-events-auto'
                    }`
                  : `relative h-full bg-white flex flex-col transition-all duration-300 ease-in-out ${
                      isBoardCollapsed
                        ? 'w-0 min-w-0 p-0 border-none overflow-hidden opacity-0 pointer-events-none'
                        : 'w-[440px] xl:w-[500px] 2xl:w-[580px] border-l border-slate-200 opacity-100 pointer-events-auto flex-shrink-0'
                    }`
              }
            `}
          >
            {/* Mobile Portrait Touch Drag Handle & Peek Bar (Only in Mobile Portrait) */}
            {viewportMode.isMobilePortrait && (
              <div
                id="mobile-dispatch-peek-bar"
                onTouchStart={handleSheetTouchStart}
                onTouchEnd={handleSheetTouchEnd}
                onClick={handlePrimarySheetToggle}
                className="flex flex-col items-center justify-center h-[56px] min-h-[56px] px-3.5 cursor-pointer bg-white border-b border-slate-200 select-none shrink-0 active:bg-slate-50 transition-colors"
                role="button"
                aria-expanded={mobileSheetState !== 'collapsed'}
                aria-label="Toggle Dispatch Board Drawer"
              >
                {/* Top Drag Indicator */}
                <div className="w-12 h-1 bg-slate-300 rounded-full mb-1.5" />
                
                <div className="flex items-center justify-between w-full text-xs font-bold text-slate-800">
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center flex-shrink-0">
                      <Truck className="w-3.5 h-3.5" />
                    </div>
                    <span className="text-xs sm:text-sm font-bold text-slate-900">Dispatch Board</span>
                    {unassignedCount > 0 ? (
                      <span className="px-1.5 py-0.5 rounded-full text-[10px] font-mono bg-red-600 text-white font-bold">
                        {unassignedCount} Queue
                      </span>
                    ) : (
                      <span className="text-slate-500 font-normal text-[11px]">(15 Vans)</span>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5">
                    {/* Secondary Full/Half Toggle Button (only when open) */}
                    {mobileSheetState !== 'collapsed' && (
                      <button
                        type="button"
                        onClick={handleToggleFullScreen}
                        className="min-h-[34px] px-2 py-1 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 text-xs font-semibold flex items-center gap-1 transition-all cursor-pointer"
                        title={mobileSheetState === 'full' ? 'Restore to half view' : 'Maximize to full view'}
                        aria-label={mobileSheetState === 'full' ? 'Restore to half view' : 'Maximize to full view'}
                      >
                        {mobileSheetState === 'full' ? (
                          <>
                            <Minimize2 className="w-3.5 h-3.5 text-slate-600" />
                            <span className="text-[11px]">Half</span>
                          </>
                        ) : (
                          <>
                            <Maximize2 className="w-3.5 h-3.5 text-slate-600" />
                            <span className="text-[11px]">Full</span>
                          </>
                        )}
                      </button>
                    )}

                    {/* Primary Action Button: Swipe Up when collapsed, Collapse when open */}
                    <button
                      type="button"
                      id="mobile-swipe-up-btn"
                      onClick={handlePrimarySheetToggle}
                      className="min-h-[34px] px-3 py-1 rounded-xl bg-blue-50 hover:bg-blue-100 active:bg-blue-200 text-blue-700 border border-blue-200 text-xs font-bold flex items-center gap-1.5 transition-all shadow-2xs cursor-pointer"
                      aria-expanded={mobileSheetState !== 'collapsed'}
                      aria-controls="panel-board-view"
                      title={mobileSheetState === 'collapsed' ? 'Open dispatch board' : 'Collapse dispatch board'}
                    >
                      <span>{mobileSheetState === 'collapsed' ? 'Swipe Up' : 'Collapse'}</span>
                      <span className="text-blue-600 font-bold">{mobileSheetState === 'collapsed' ? '▴' : '▾'}</span>
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Kanban Content */}
            <div className="flex-1 overflow-hidden">
              <DispatchKanban
                technicians={technicians}
                tickets={tickets}
                selectedTechId={selectedTechId}
                onSelectTech={setSelectedTechId}
                selectedTicketId={selectedTicketId}
                onSelectTicket={setSelectedTicketId}
                onAssignTicket={handleAssignTicket}
                onUnassignTicket={handleUnassignTicket}
                onReorderTechTickets={handleReorderTechTickets}
                onOpenAiAssistant={() => setIsAiModalOpen(true)}
                onOpenManifest={(tech) => setManifestTech(tech)}
                onOpenNewTicketModal={() => setIsNewTicketModalOpen(true)}
                onOpenJobberModal={() => setIsJobberModalOpen(true)}
                activeTab={kanbanActiveTab}
                onActiveTabChange={setKanbanActiveTab}
                onClose={() => {
                  setIsBoardCollapsed(true);
                  setIsLandscapeDrawerOpen(false);
                  setMobileSheetState('collapsed');
                }}
              />
            </div>
          </section>
        </main>
        )}

        {/* Professional Polish Footer Bar (Hidden in Zen Mode and Mobile Landscape) */}
        {!isZenMode && (
          <footer
            id="global-footer"
            className="h-8 bg-slate-800 text-slate-400 hidden sm:flex landscape:max-md:hidden items-center px-4 justify-between text-[10px] shrink-0 font-medium z-20 border-t border-slate-700"
          >
            <div className="flex items-center gap-4">
              <span>Fleet Health: <span className="text-emerald-400 font-bold">Optimal</span></span>
              <span>Cleaners: <span className="text-slate-200 font-mono">15 Active Cleaners (Decentralized Hubs)</span></span>
              <span className="hidden md:inline">Jobber Sync: <span className="text-emerald-300 font-semibold">Live GraphQL (developer.getjobber.com)</span></span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></div>
              <span className="uppercase tracking-widest text-slate-300">Clean Dispatch YEG v4.22</span>
            </div>
          </footer>
        )}

        {/* AI Dispatch Assistant Modal */}
        <AiDispatchModal
          isOpen={isAiModalOpen}
          onClose={() => setIsAiModalOpen(false)}
          technicians={technicians}
          tickets={tickets}
          onBatchApplyRecommendations={handleBatchApplyRecommendations}
          onApplySingleRecommendation={handleApplySingleRecommendation}
        />

        {/* Exportable Daily Manifest Modal */}
        <DailyManifestModal
          isOpen={!!manifestTech}
          onClose={() => setManifestTech(null)}
          technician={manifestTech}
          tickets={tickets}
        />

        {/* Create New Cleaning Booking Modal */}
        <NewTicketModal
          isOpen={isNewTicketModalOpen}
          onClose={() => setIsNewTicketModalOpen(false)}
          onCreateTicket={handleCreateTicket}
        />

        {/* Jobber Backend Integration & Sync Hub Modal */}
        <JobberSyncModal
          isOpen={isJobberModalOpen}
          onClose={() => setIsJobberModalOpen(false)}
          tickets={tickets}
          onTicketsUpdated={setTickets}
        />

        {/* Public Booking Modal (Option A for bookmycleaning.net) */}
        <PublicBookingModal
          isOpen={isPublicBookingModalOpen}
          onClose={() => setIsPublicBookingModalOpen(false)}
          onBookingCreated={(newTicket) => {
            setTickets((prev) => [newTicket, ...prev]);
            setSelectedTicketId(newTicket.id);
          }}
        />

        {/* Quo (OpenPhone) 5-Line Phone System Modal */}
        <QuoModal
          isOpen={isQuoModalOpen}
          onClose={() => setIsQuoModalOpen(false)}
        />
      </div>
    </APIProvider>
  );
}

export default App;
