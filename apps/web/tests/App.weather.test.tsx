import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { App } from '../src/App';
import { WeatherPanel } from '../src/components/WeatherPanel';

afterEach(() => vi.restoreAllMocks());

describe('App weather panel', () => {
  it('shows the weather modes and a manual constant entry', () => {
    render(<App />);
    expect(screen.getByRole('button', { name: 'Manuell' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Manuell' }));
    expect(screen.getByText('Applicera på alla timmar')).toBeTruthy();
  });
});

describe('WeatherPanel fetchError prop', () => {
  const baseProps = {
    mode: 'fetched' as const,
    onModeChange: () => {},
    rows: [],
    edited: new Set<number>(),
    fetchStatus: 'error' as const,
    sources: [],
    reduced: false,
    windRef: 'felt' as const,
    onFetch: () => {},
    onEdit: () => {},
    onResetHour: () => {},
    onApplyConstant: () => {},
    onWindRefChange: () => {},
  };

  it('shows generic text when fetchError is undefined', () => {
    render(<WeatherPanel {...baseProps} />);
    expect(screen.getByText(/Hämtning misslyckades/)).toBeTruthy();
    expect(screen.queryByText(/GPX elevation/)).toBeNull();
  });

  it('appends the error message when fetchError is provided', () => {
    render(
      <WeatherPanel {...baseProps} fetchError="GPX elevation data missing: no trkpt ele found" />,
    );
    expect(screen.getByText(/Hämtning misslyckades.*GPX elevation data missing/)).toBeTruthy();
  });
});
