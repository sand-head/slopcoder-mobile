/**
 * The transcript's media and link handling, as the app root provides it (see
 * `transcriptServices.tsx` for why it is provided rather than imported).
 */
import type { TranscriptServices } from './transcriptServices';
import { useOpenLink } from './links';
import { ArtifactMedia, ImageViewer, ProseImage } from './media';

export const transcriptMedia: TranscriptServices = {
  useOpenLink,
  ProseImage,
  ArtifactMedia,
  ImageViewer,
};
