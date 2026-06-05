/**
 * Manual-wind reference toggle.
 *
 * In manual mode the user states whether the wind they typed is a 10 m forecast
 * or the wind they feel on the road. That choice drives
 * apply_wind_height_correction in the pipeline input: "felt" -> false (take the
 * number as-is at rider level), "10 m" -> true (scale the forecast down).
 *
 * We render the whole App and capture the PipelineInput the worker is posted, by
 * stubbing the Worker constructor (jsdom has no Worker, and we only need to read
 * postMessage's argument).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within, cleanup } from '@testing-library/react';
import { App } from '../src/App';
import type { PipelineInput } from '../src/worker/solve.worker';

// Capture every payload posted to the (stubbed) compute worker.
const posted: PipelineInput[] = [];

class FakeWorker {
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  postMessage(msg: PipelineInput) {
    posted.push(msg);
  }
  terminate() {}
}

beforeEach(() => {
  posted.length = 0;
  vi.stubGlobal('Worker', FakeWorker as unknown as typeof Worker);
});

afterEach(() => {
  // globals:false disables @testing-library's automatic cleanup, so without this
  // each render(<App />) stacks in the DOM and queries match across instances.
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function lastInput(): PipelineInput {
  return posted[posted.length - 1];
}

describe('WeatherPanel manual-wind toggle', () => {
  it('renders both reference options in manual mode', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Manuell' }));
    expect(screen.getByLabelText(/10 m prognosvind/)).toBeTruthy();
    expect(screen.getByLabelText(/vinden jag känner på vägen/)).toBeTruthy();
  });

  it('defaults to "felt" -> apply_wind_height_correction is false', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Manuell' }));
    // "felt" is the default selection.
    const felt = screen.getByLabelText(/vinden jag känner på vägen/) as HTMLInputElement;
    expect(felt.checked).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Beräkna plan' }));
    expect(lastInput().form.apply_wind_height_correction).toBe(false);
  });

  it('"10 m" -> apply_wind_height_correction is true', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Manuell' }));
    fireEvent.click(screen.getByLabelText(/10 m prognosvind/));

    fireEvent.click(screen.getByRole('button', { name: 'Beräkna plan' }));
    expect(lastInput().form.apply_wind_height_correction).toBe(true);
  });

  it('the manual wind-ref fieldset carries the explanatory helptext', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Manuell' }));
    const group = screen.getByRole('radiogroup', { name: /Vad vinden jag angav är/ });
    expect(within(group).getByText(/Väderprognoser anger vind på 10 meters höjd/)).toBeTruthy();
  });
});
