/**
 * Shared Swedish display labels for @stp/core enums, kept in one place so the
 * tempokort, summary and any future view show the same wording. Add new maps
 * here rather than inlining label strings in components.
 */
import type { ExposureClass } from '@stp/core';

/** Landscape exposure class -> Swedish label shown in the UI. */
export const EXPOSURE_LABELS: Record<ExposureClass, string> = {
  open: 'Öppet',
  semi_open: 'Halvöppet',
  sheltered: 'Skyddat',
  forest: 'Skog',
  urban: 'Bebyggt',
  water: 'Vattennära',
  bridge: 'Bro',
};

/** Swedish label for an exposure class, or a dash when unknown. */
export function exposureLabel(cls: ExposureClass | undefined): string {
  return cls ? EXPOSURE_LABELS[cls] : '–';
}
