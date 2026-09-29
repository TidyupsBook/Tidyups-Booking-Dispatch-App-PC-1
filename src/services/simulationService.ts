import { Technician, ServiceTicket, LocationPoint } from '../types/dispatch';
import { decodePolyline } from './routesApi';

export interface SimulationEvent {
  id: string;
  timestamp: string;
  type: 'STARTED' | 'EN_ROUTE' | 'ON_SITE' | 'JOB_COMPLETED' | 'DEPOT_RETURN' | 'ALL_FINISHED';
  techId: string;
  techVan: string;
  techName: string;
  techColor: string;
  ticketId?: string;
  ticketNumber?: string;
  customerName?: string;
  message: string;
}

export interface RouteLeg {
  fromName: string;
  toName: string;
  targetTicketId: string | null; // null if destination is depot
  points: Array<{ lat: number; lng: number }>;
  dwellDurationSeconds: number;
}

export interface VehicleSimState {
  techId: string;
  legs: RouteLeg[];
  currentLegIndex: number;
  currentPointIndex: number;
  isDwell: boolean;
  dwellRemainingSeconds: number;
  isFinished: boolean;
  totalPoints: number;
  completedStopsCount: number;
}

/**
 * Calculates Euclidean distance between two GPS coordinates
 */
function getCoordinateDistance(p1: { lat: number; lng: number }, p2: { lat: number; lng: number }): number {
  const dLat = (p2.lat - p1.lat);
  const dLng = (p2.lng - p1.lng) * Math.cos(((p1.lat + p2.lat) / 2) * (Math.PI / 180));
  return Math.sqrt(dLat * dLat + dLng * dLng);
}

/**
 * Generates interpolated points along a direct segment if polyline is sparse or unavailable
 */
function interpolatePoints(
  start: { lat: number; lng: number },
  end: { lat: number; lng: number },
  steps: number = 40
): Array<{ lat: number; lng: number }> {
  const points: Array<{ lat: number; lng: number }> = [];
  for (let i = 0; i <= steps; i++) {
    const fraction = i / steps;
    points.push({
      lat: start.lat + (end.lat - start.lat) * fraction,
      lng: start.lng + (end.lng - start.lng) * fraction,
    });
  }
  return points;
}

/**
 * Builds high-fidelity route legs respecting the decoded polyline geometry for a technician.
 * If encodedPolyline exists from Google Routes API, it segments the polyline at each stop.
 */
export function buildTechnicianRouteLegs(
  technician: Technician,
  tickets: ServiceTicket[]
): RouteLeg[] {
  const assignedTickets = tickets
    .filter((t) => technician.assignedTicketIds.includes(t.id))
    .sort((a, b) => (a.stopSequence || 0) - (b.stopSequence || 0));

  if (assignedTickets.length === 0) {
    return [];
  }

  const stops: Array<{
    name: string;
    location: LocationPoint;
    ticketId: string | null;
    dwellSec: number;
  }> = [
    ...assignedTickets.map((t) => ({
      name: `${t.ticketNumber} - ${t.customerName}`,
      location: t.location,
      ticketId: t.id,
      dwellSec: t.urgency === 'EMERGENCY' ? 2.5 : t.urgency === 'SAME_DAY' ? 2.0 : 1.5,
    })),
    {
      name: `${technician.depotLocation.name} (Depot)`,
      location: technician.depotLocation,
      ticketId: null,
      dwellSec: 0,
    },
  ];

  let rawPolylinePoints: Array<{ lat: number; lng: number }> = [];
  if (technician.routeMetrics?.encodedPolyline) {
    rawPolylinePoints = decodePolyline(technician.routeMetrics.encodedPolyline);
  }

  const legs: RouteLeg[] = [];
  let currentStart = { lat: technician.currentLocation.lat, lng: technician.currentLocation.lng };
  let currentStartName = `Current Position (${technician.vanNumber})`;

  if (rawPolylinePoints.length >= 10) {
    // Find closest polyline indices for each sequential stop
    let lastPolyIndex = 0;

    for (let s = 0; s < stops.length; s++) {
      const stop = stops[s];
      const target = stop.location;

      // Find nearest point on rawPolylinePoints after lastPolyIndex
      let bestIdx = lastPolyIndex;
      let minDistance = Infinity;

      for (let i = lastPolyIndex; i < rawPolylinePoints.length; i++) {
        const d = getCoordinateDistance(rawPolylinePoints[i], target);
        if (d < minDistance) {
          minDistance = d;
          bestIdx = i;
        }
      }

      // Ensure we advance at least a few points
      if (bestIdx <= lastPolyIndex && lastPolyIndex < rawPolylinePoints.length - 1) {
        bestIdx = Math.min(rawPolylinePoints.length - 1, lastPolyIndex + 5);
      }

      // Slice the polyline points for this leg
      let legPoints = rawPolylinePoints.slice(lastPolyIndex, bestIdx + 1);

      // If sliced segment is too small, interpolate
      if (legPoints.length < 5) {
        legPoints = interpolatePoints(
          rawPolylinePoints[lastPolyIndex] || currentStart,
          target,
          25
        );
      }

      // Ensure exact arrival on target coordinates
      if (legPoints.length > 0) {
        legPoints[legPoints.length - 1] = { lat: target.lat, lng: target.lng };
      }

      legs.push({
        fromName: currentStartName,
        toName: stop.name,
        targetTicketId: stop.ticketId,
        points: legPoints,
        dwellDurationSeconds: stop.dwellSec,
      });

      lastPolyIndex = bestIdx;
      currentStart = { lat: target.lat, lng: target.lng };
      currentStartName = stop.name;
    }
  } else {
    // Fallback: interpolate smooth segments between stops
    for (let s = 0; s < stops.length; s++) {
      const stop = stops[s];
      const legPoints = interpolatePoints(currentStart, stop.location, 35);
      legs.push({
        fromName: currentStartName,
        toName: stop.name,
        targetTicketId: stop.ticketId,
        points: legPoints,
        dwellDurationSeconds: stop.dwellSec,
      });
      currentStart = { lat: stop.location.lat, lng: stop.location.lng };
      currentStartName = stop.name;
    }
  }

  return legs;
}
