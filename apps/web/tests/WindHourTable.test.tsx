import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { WindHourTable } from '../src/components/WindHourTable';
import type { HourlyWind } from '@stp/core';

const rows: HourlyWind[] = [
  { hour: 6, dir_from_deg: 90, speed_ms: 4 },
  { hour: 7, dir_from_deg: 180, speed_ms: 6 },
];

afterEach(cleanup);

describe('WindHourTable', () => {
  it('renders a row per hour', () => {
    render(<WindHourTable rows={rows} edited={new Set()} onChange={() => {}} onReset={() => {}} />);
    expect(screen.getByText('06:00')).toBeTruthy();
    expect(screen.getByText('07:00')).toBeTruthy();
  });

  it('calls onChange with the parsed speed', () => {
    const onChange = vi.fn();
    render(<WindHourTable rows={rows} edited={new Set()} onChange={onChange} onReset={() => {}} />);
    const speedInputs = screen.getAllByLabelText(/styrka/i);
    fireEvent.change(speedInputs[0], { target: { value: '9' } });
    expect(onChange).toHaveBeenCalledWith(6, { speed_ms: 9 });
  });

  it('marks edited rows', () => {
    const { container } = render(
      <WindHourTable rows={rows} edited={new Set([6])} onChange={() => {}} onReset={() => {}} />,
    );
    expect(container.querySelector('.wind-row.edited')).toBeTruthy();
  });
});
