export type MediaKind = "photo" | "video";

export interface MediaDraft {
  uri: string;
  kind: MediaKind;
  bytes: number;
  thumbnailUri?: string;
  duration?: number;
  /** Capture time (or the original sender's time), before processing/queueing. */
  createdAt?: number;
}

export interface MediaItem {
  id: string;
  kind: MediaKind;
  fileName: string;
  thumbnailName?: string;
  bytes: number;
  duration?: number;
  createdAt: number;
  direction: "received" | "outgoing";
  sender?: string;
  read: boolean;
}

export interface MediaFiles {
  save: (
    id: string,
    draft: MediaDraft,
  ) => Promise<Pick<MediaItem, "fileName" | "thumbnailName">>;
  remove: (
    item: Pick<MediaItem, "fileName" | "thumbnailName">,
  ) => Promise<void>;
}
