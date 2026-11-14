/**
 * The watermark icons (contract/cardIcon.ts), as stroke paths on a 24×24 grid —
 * drawn by RecordCard large and faint behind a card's rows, and small in Table
 * settings' picker. Plain shapes only: at 10% opacity anything finer is mush.
 */
import type { CardIconId } from '../../contract/cardIcon';

export const CARD_ICON_PATHS: Record<CardIconId, string[]> = {
  // a strip of film: the frame, its sprocket rails, one frame line
  video: ['M3 3h18v18H3z', 'M7 3v18', 'M17 3v18', 'M3 7h4M3 12h4M3 17h4M17 7h4M17 12h4M17 17h4', 'M7 12h10'],
  // a waveform
  audio: ['M3 12h1', 'M6 8v8', 'M9 4v16', 'M12 7v10', 'M15 10v4', 'M18 6v12', 'M21 11v2'],
  // frames stacked one behind another
  sequence: ['M8 8h13v13H8z', 'M5 5h13', 'M5 5v13', 'M2 2h13', 'M2 2v13'],
  // a screen with two caption lines
  captions: ['M2 5h20v14H2z', 'M6 13h7', 'M15 13h3', 'M6 16h4', 'M12 16h6'],
  // a page with its corner folded, and lines
  document: ['M5 2h10l4 4v16H5z', 'M15 2v4h4', 'M8 11h8', 'M8 14h8', 'M8 17h5'],
  // a box
  package: ['M3 7l9-4 9 4v10l-9 4-9-4z', 'M3 7l9 4 9-4', 'M12 11v10'],
  // tracks of a timeline, clips on them
  timeline: ['M2 4v16', 'M5 6h7v3H5z', 'M13 6h6v3h-6z', 'M5 11h10v3H5z', 'M8 16h11v3H8z'],
  // a target: what is asked for
  deliverable: ['M12 2a10 10 0 1 0 0.01 0z', 'M12 6a6 6 0 1 0 0.01 0z', 'M12 10a2 2 0 1 0 0.01 0z'],
  // a plain tile
  generic: ['M4 4h16v16H4z', 'M9 12h6'],
};
