export interface StreamPlayerHandle {
  seekTo: (seconds: number, options?: { play?: boolean }) => void;
  play: () => void;
  pause: () => void;
  getCurrentTime: () => number;
  getDuration: () => number;
}
