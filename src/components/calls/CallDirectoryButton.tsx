'use client';

// TopNavBar entry point for video calls. Renders nothing when no
// CallProvider is mounted (e.g. isolated TopNavBar tests, public pages).
import { Video } from 'lucide-react';
import { useVideoCall } from './CallProvider';

export function CallDirectoryButton() {
  const calls = useVideoCall();
  if (!calls) return null;
  return (
    <button
      onClick={calls.openDirectory}
      className="cursor-pointer rounded-sm p-1.5 text-white/70 transition-colors hover:bg-white/10 hover:text-white"
      aria-label="โทรวิดีโอ"
      title="โทรวิดีโอระหว่างโรงพยาบาล"
    >
      <Video className="h-4 w-4" />
    </button>
  );
}
