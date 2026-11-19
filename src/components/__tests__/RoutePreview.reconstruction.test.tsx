import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { Polyline } from 'react-native-svg';
import { RoutePreview } from '../RoutePreview';

describe('RoutePreview estimated GPS prefix', () => {
  it('draws the measured route solid and the reconstructed prefix dashed, with separate totals', () => {
    render(<RoutePreview large session={{
      id: 'gps-1', walkId: 'walk-1', familyId: 'family-1', dogId: 'dog-1', distanceMeters: 400, pointCount: 4,
      routePoints: [0, 1, 2, 3].map((i) => ({ latitude: 32.002 + i * 0.0001, longitude: 34, timestamp: 1_800_100_000_000 + i * 60_000 })),
      reconstruction: { routePoints: [{ latitude: 32, longitude: 34, timestamp: 0 }, { latitude: 32.001, longitude: 34, timestamp: 0 }], distanceMeters: 200, durationSeconds: 300, confidence: 'low', sourceWalkId: 'walk-old' },
      source: 'device_gps', createdAt: 'c', updatedAt: 'u',
    }} />);
    const lines = screen.UNSAFE_getAllByType(Polyline);
    expect(lines[0].props.strokeDasharray).toBeUndefined();
    expect(lines[1].props.strokeDasharray).toBeDefined();
    expect(screen.getByText(/GPS מדוד/)).toBeTruthy();
    expect(screen.getByText(/סה״כ משוער/)).toBeTruthy();
    expect(screen.getByText(/רמת ביטחון נמוכה/)).toBeTruthy();
  });

  it('shows a short reconstructed prefix before enough measured samples arrive', () => {
    render(<RoutePreview large live session={{
      id: 'gps-2', walkId: 'walk-2', familyId: 'family-1', dogId: 'dog-1', distanceMeters: 0, pointCount: 1,
      routePoints: [{ latitude: 32.002, longitude: 34, timestamp: 1_800_100_000_000 }],
      reconstruction: { routePoints: [{ latitude: 32, longitude: 34, timestamp: 0 }, { latitude: 32.001, longitude: 34, timestamp: 0 }], distanceMeters: 200, durationSeconds: 300, confidence: 'high', sourceWalkId: 'walk-old' },
      source: 'device_gps', createdAt: 'c', updatedAt: 'u',
    }} />);
    const lines = screen.UNSAFE_getAllByType(Polyline);
    expect(lines).toHaveLength(2);
    expect(lines[1].props.strokeDasharray).toBeDefined();
  });
});
