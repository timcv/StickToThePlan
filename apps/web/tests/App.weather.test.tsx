import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { App } from '../src/App';

afterEach(() => vi.restoreAllMocks());

describe('App weather panel', () => {
  it('shows the weather modes and a manual constant entry', () => {
    render(<App />);
    expect(screen.getByRole('button', { name: 'Manuell' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Manuell' }));
    expect(screen.getByText('Applicera på alla timmar')).toBeTruthy();
  });
});
