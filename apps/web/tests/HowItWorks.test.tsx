/**
 * Render tests for the HowItWorks deep-dive accordions (jsdom +
 * @testing-library/react, web vitest project). Asserts the engineer-depth
 * content carries the exact constants from packages/core.
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { HowItWorks } from '../src/components/HowItWorks';

describe('HowItWorks deep dives', () => {
  it('renders the forces deep dive collapsed with exact constants', () => {
    const { container } = render(<HowItWorks onBack={() => {}} />);
    const deeps = container.querySelectorAll('details.howto-deep');
    expect(deeps.length).toBeGreaterThanOrEqual(1);
    for (const d of deeps) expect(d.hasAttribute('open')).toBe(false);
    const text = container.textContent ?? '';
    expect(text).toContain('0,0045'); // crr
    expect(text).toContain('0,32'); // CdA på täten
    expect(text).toContain('0,21'); // CdA i lä
    expect(text).toContain('0,97'); // drivlina
    expect(text).toContain('96 kg'); // massa
  });

  it('renders air/wind and group deep dives with exact constants', () => {
    const { container } = render(<HowItWorks onBack={() => {}} />);
    expect(container.querySelectorAll('details.howto-deep').length).toBeGreaterThanOrEqual(3);
    const text = container.textContent ?? '';
    expect(text).toContain('287,058'); // Rd
    expect(text).toContain('0,001'); // z0 vatten
    expect(text).toContain('45 s'); // dragens längd
    expect(text).toContain('f_front'); // rotationsandel
  });
});
