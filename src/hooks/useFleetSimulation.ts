import { useState, useRef, useCallback, useEffect, Dispatch, SetStateAction } from 'react';
import { Technician, ServiceTicket } from '../types/dispatch';
import { 
  buildTechnicianRouteLegs, 
  VehicleSimState, 
  SimulationEvent 
} from '../services/simulationService';

interface UseFleetSimulationProps {
  technicians: Technician[];
  tickets: ServiceTicket[];
  setTechnicians: Dispatch<SetStateAction<Technician[]>>;
  setTickets: Dispatch<SetStateAction<ServiceTicket[]>>;
}

export function useFleetSimulation({
  technicians,
  tickets,
  setTechnicians,
  setTickets,
}: UseFleetSimulationProps) {
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [speedMultiplier, setSpeedMultiplier] = useState<number>(2);
  const [events, setEvents] = useState<SimulationEvent[]>([]);
  const [activeMessage, setActiveMessage] = useState<string | null>(null);

  // Snapshot refs to restore on reset
  const initialTechsRef = useRef<Technician[] | null>(null);
  const initialTicketsRef = useRef<ServiceTicket[] | null>(null);

  // State refs for the simulation loop
  const vehiclesStateRef = useRef<Map<string, VehicleSimState>>(new Map());
  const animationFrameRef = useRef<number | null>(null);
  const lastTickTimeRef = useRef<number>(0);
  const techniciansRef = useRef<Technician[]>(technicians);
  const ticketsRef = useRef<ServiceTicket[]>(tickets);

  // Keep refs synchronized with latest props without triggering effect recreation
  useEffect(() => {
    techniciansRef.current = technicians;
  }, [technicians]);

  useEffect(() => {
    ticketsRef.current = tickets;
  }, [tickets]);

  // Save snapshots on initial mount
  useEffect(() => {
    if (!initialTechsRef.current && technicians.length > 0) {
      initialTechsRef.current = JSON.parse(JSON.stringify(technicians));
    }
    if (!initialTicketsRef.current && tickets.length > 0) {
      initialTicketsRef.current = JSON.parse(JSON.stringify(tickets));
    }
  }, [technicians, tickets]);

  const addEvent = useCallback((event: Omit<SimulationEvent, 'id' | 'timestamp'>) => {
    const newEvent: SimulationEvent = {
      ...event,
      id: `ev-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    };

    setEvents((prev) => [newEvent, ...prev.slice(0, 49)]); // keep recent 50 events
    setActiveMessage(newEvent.message);
  }, []);

  // Initialize simulation data structures
  const startSimulation = useCallback(() => {
    // If resuming from pause
    if (isPaused && isRunning) {
      setIsPaused(false);
      lastTickTimeRef.current = performance.now();
      return;
    }

    // Capture baseline snapshots if not captured
    if (!initialTechsRef.current) {
      initialTechsRef.current = JSON.parse(JSON.stringify(techniciansRef.current));
    }
    if (!initialTicketsRef.current) {
      initialTicketsRef.current = JSON.parse(JSON.stringify(ticketsRef.current));
    }

    // Build vehicle routes
    const simMap = new Map<string, VehicleSimState>();
    let totalAssignedTicketsCount = 0;

    techniciansRef.current.forEach((tech) => {
      const legs = buildTechnicianRouteLegs(tech, ticketsRef.current);
      if (legs.length > 0) {
        simMap.set(tech.id, {
          techId: tech.id,
          legs,
          currentLegIndex: 0,
          currentPointIndex: 0,
          isDwell: false,
          dwellRemainingSeconds: 0,
          isFinished: false,
          totalPoints: legs.reduce((acc, l) => acc + l.points.length, 0),
          completedStopsCount: 0,
        });
        totalAssignedTicketsCount += tech.assignedTicketIds.length;
      }
    });

    if (simMap.size === 0) {
      addEvent({
        type: 'STARTED',
        techId: 'system',
        techVan: 'ALL',
        techName: 'Fleet Coordinator',
        techColor: '#3B82F6',
        message: 'No tickets currently assigned to technicians to simulate.',
      });
      return;
    }

    vehiclesStateRef.current = simMap;
    setIsRunning(true);
    setIsPaused(false);
    lastTickTimeRef.current = performance.now();

    // Mark assigned tickets as EN_ROUTE / ASSIGNED
    setTickets((prev) =>
      prev.map((t) => (t.assignedTechId ? { ...t, status: 'ASSIGNED' as const } : t))
    );

    // Initial event
    addEvent({
      type: 'STARTED',
      techId: 'system',
      techVan: 'FLEET',
      techName: 'Simulation Engine',
      techColor: '#10B981',
      message: `Edmonton Fleet Simulation initiated with ${simMap.size} active cleaning service vans and ${totalAssignedTicketsCount} scheduled stops.`,
    });
  }, [technicians, tickets, isPaused, isRunning, addEvent, setTickets]);

  const pauseSimulation = useCallback(() => {
    setIsPaused(true);
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
  }, []);

  const resetSimulation = useCallback(() => {
    setIsRunning(false);
    setIsPaused(false);
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    vehiclesStateRef.current.clear();

    // Restore snapshots if available
    if (initialTechsRef.current) {
      setTechnicians(JSON.parse(JSON.stringify(initialTechsRef.current)));
    }
    if (initialTicketsRef.current) {
      setTickets(JSON.parse(JSON.stringify(initialTicketsRef.current)));
    }

    setActiveMessage('Simulation reset to initial fleet state.');
  }, [setTechnicians, setTickets]);

  // Main simulation tick loop
  useEffect(() => {
    if (!isRunning || isPaused) {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      return;
    }

    let isMounted = true;

    const tick = (now: number) => {
      if (!lastTickTimeRef.current) lastTickTimeRef.current = now;
      const rawDeltaSec = Math.min((now - lastTickTimeRef.current) / 1000, 0.1);
      lastTickTimeRef.current = now;

      const deltaSec = rawDeltaSec * speedMultiplier;
      const simMap = vehiclesStateRef.current;
      let allCompleted = true;
      let hasUpdates = false;

      const techUpdates: Record<string, Partial<Technician>> = {};
      const ticketUpdates: Record<string, Partial<ServiceTicket>> = {};

      simMap.forEach((vState, techId) => {
        if (vState.isFinished) return;
        allCompleted = false;

        const currentLeg = vState.legs[vState.currentLegIndex];
        if (!currentLeg) {
          vState.isFinished = true;
          return;
        }

        const techObj = techniciansRef.current.find((t) => t.id === techId);
        if (!techObj) return;

        if (vState.isDwell) {
          // On site servicing ticket
          vState.dwellRemainingSeconds -= deltaSec;

          if (vState.dwellRemainingSeconds <= 0) {
            // Finished service at this stop!
            vState.isDwell = false;
            vState.completedStopsCount += 1;

            if (currentLeg.targetTicketId) {
              const ticketId = currentLeg.targetTicketId;
              const targetTicket = ticketsRef.current.find((t) => t.id === ticketId);

              ticketUpdates[ticketId] = {
                status: 'COMPLETED' as const,
              };

              addEvent({
                type: 'JOB_COMPLETED',
                techId: techObj.id,
                techVan: techObj.vanNumber,
                techName: techObj.name,
                techColor: techObj.color,
                ticketId: ticketId,
                ticketNumber: targetTicket?.ticketNumber,
                customerName: targetTicket?.customerName,
                message: `✅ ${techObj.vanNumber} (${techObj.name}) finished service on ${targetTicket?.equipmentType || 'Unit'} at ${targetTicket?.customerName || 'Customer'} (Ticket ${targetTicket?.ticketNumber})`,
              });
            }

            // Move to next leg
            vState.currentLegIndex += 1;
            vState.currentPointIndex = 0;

            if (vState.currentLegIndex >= vState.legs.length) {
              vState.isFinished = true;
              techUpdates[techId] = {
                status: 'AVAILABLE' as const,
                completedJobsCount: (techObj.completedJobsCount || 0) + 1,
              };

              addEvent({
                type: 'DEPOT_RETURN',
                techId: techObj.id,
                techVan: techObj.vanNumber,
                techName: techObj.name,
                techColor: techObj.color,
                message: `🏢 ${techObj.vanNumber} (${techObj.name}) returned to ${techObj.depotLocation.name} after completing all stops.`,
              });
            } else {
              const nextLeg = vState.legs[vState.currentLegIndex];
              const isHeadingToDepot = !nextLeg.targetTicketId;
              techUpdates[techId] = {
                status: isHeadingToDepot ? 'RETURNING_DEPOT' as const : 'EN_ROUTE' as const,
                completedJobsCount: (techObj.completedJobsCount || 0) + 1,
              };

              if (nextLeg.targetTicketId) {
                ticketUpdates[nextLeg.targetTicketId] = {
                  status: 'EN_ROUTE' as const,
                };
              }
            }
          } else {
            // Still in dwell
            techUpdates[techId] = {
              status: 'ON_SITE' as const,
            };
            if (currentLeg.targetTicketId) {
              ticketUpdates[currentLeg.targetTicketId] = {
                status: 'IN_PROGRESS' as const,
              };
            }
          }
          hasUpdates = true;
        } else {
          // Driving along polyline points
          const points = currentLeg.points;
          const pointsCount = points.length;

          // Advance points proportional to distance and speed
          const stepAdvancement = Math.max(1, Math.round(pointsCount * (deltaSec / 4.0)));
          vState.currentPointIndex = Math.min(pointsCount - 1, vState.currentPointIndex + stepAdvancement);

          const currentPoint = points[vState.currentPointIndex];
          if (currentPoint) {
            techUpdates[techId] = {
              currentLocation: {
                lat: currentPoint.lat,
                lng: currentPoint.lng,
                address: currentLeg.toName,
              },
              status: currentLeg.targetTicketId ? ('EN_ROUTE' as const) : ('RETURNING_DEPOT' as const),
            };

            if (currentLeg.targetTicketId) {
              ticketUpdates[currentLeg.targetTicketId] = {
                status: 'EN_ROUTE' as const,
              };
            }
            hasUpdates = true;
          }

          // Check if reached destination of this leg
          if (vState.currentPointIndex >= pointsCount - 1) {
            if (currentLeg.targetTicketId) {
              // Arrived at customer location
              vState.isDwell = true;
              vState.dwellRemainingSeconds = currentLeg.dwellDurationSeconds;

              techUpdates[techId] = {
                status: 'ON_SITE' as const,
              };
              ticketUpdates[currentLeg.targetTicketId] = {
                status: 'IN_PROGRESS' as const,
              };

              const targetTicket = ticketsRef.current.find((t) => t.id === currentLeg.targetTicketId);

              addEvent({
                type: 'ON_SITE',
                techId: techObj.id,
                techVan: techObj.vanNumber,
                techName: techObj.name,
                techColor: techObj.color,
                ticketId: currentLeg.targetTicketId,
                ticketNumber: targetTicket?.ticketNumber,
                customerName: targetTicket?.customerName,
                message: `🔧 ${techObj.vanNumber} arrived on-site at ${targetTicket?.customerName} (${targetTicket?.location.address}). Diagnostics & repair in progress.`,
              });
            } else {
              // Arrived at Depot
              vState.isFinished = true;
              techUpdates[techId] = {
                status: 'AVAILABLE' as const,
                currentLocation: {
                  lat: techObj.depotLocation.lat,
                  lng: techObj.depotLocation.lng,
                  address: techObj.depotLocation.address,
                },
              };

              addEvent({
                type: 'DEPOT_RETURN',
                techId: techObj.id,
                techVan: techObj.vanNumber,
                techName: techObj.name,
                techColor: techObj.color,
                message: `🏢 ${techObj.vanNumber} (${techObj.name}) completed daily route and parked at ${techObj.depotLocation.name}.`,
              });
            }
            hasUpdates = true;
          }
        }
      });

      // Apply batch updates to React state
      if (hasUpdates) {
        if (Object.keys(techUpdates).length > 0) {
          setTechnicians((prevTechs) =>
            prevTechs.map((t) => (techUpdates[t.id] ? { ...t, ...techUpdates[t.id] } : t))
          );
        }

        if (Object.keys(ticketUpdates).length > 0) {
          setTickets((prevTickets) =>
            prevTickets.map((tk) => (ticketUpdates[tk.id] ? { ...tk, ...ticketUpdates[tk.id] } : tk))
          );
        }
      }

      if (allCompleted && simMap.size > 0) {
        setIsRunning(false);
        addEvent({
          type: 'ALL_FINISHED',
          techId: 'system',
          techVan: 'FLEET',
          techName: 'Coordinator',
          techColor: '#10B981',
          message: '🎉 All fleet routes, emergency tickets, and routine visits have been successfully completed across Greater Edmonton, AB!',
        });
        return;
      }

      if (isMounted && isRunning && !isPaused) {
        animationFrameRef.current = requestAnimationFrame(tick);
      }
    };

    animationFrameRef.current = requestAnimationFrame(tick);

    return () => {
      isMounted = false;
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [isRunning, isPaused, speedMultiplier, addEvent, setTechnicians, setTickets]);

  // Overall metrics calculation
  const totalAssignedTickets = tickets.filter((t) => t.assignedTechId).length;
  const completedTicketsCount = tickets.filter((t) => t.status === 'COMPLETED').length;
  const inProgressTicketsCount = tickets.filter((t) => t.status === 'IN_PROGRESS').length;
  const enRouteTicketsCount = tickets.filter((t) => t.status === 'EN_ROUTE').length;
  const fleetProgressPercent =
    totalAssignedTickets > 0
      ? Math.round((completedTicketsCount / totalAssignedTickets) * 100)
      : 0;

  return {
    isRunning,
    isPaused,
    speedMultiplier,
    setSpeedMultiplier,
    events,
    activeMessage,
    startSimulation,
    pauseSimulation,
    resetSimulation,
    fleetProgressPercent,
    completedTicketsCount,
    inProgressTicketsCount,
    enRouteTicketsCount,
    totalAssignedTickets,
  };
}
