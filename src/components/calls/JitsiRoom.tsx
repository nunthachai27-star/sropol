'use client';

// Embedded Jitsi conference via the external_api.js iframe API. Media flows
// browser ↔ Jitsi only. Script-load failure degrades to a direct room link.
import { useEffect, useRef, useState } from 'react';
import { JITSI_DOMAIN } from '@/config/video-call';

interface JitsiApi {
  dispose(): void;
  addListener(event: string, listener: () => void): void;
}

type JitsiConstructor = new (domain: string, options: Record<string, unknown>) => JitsiApi;

declare global {
  interface Window {
    JitsiMeetExternalAPI?: JitsiConstructor;
  }
}

let scriptPromise: Promise<void> | null = null;

function loadJitsiScript(): Promise<void> {
  if (window.JitsiMeetExternalAPI) return Promise.resolve();
  if (!scriptPromise) {
    scriptPromise = new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = `https://${JITSI_DOMAIN}/external_api.js`;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => {
        scriptPromise = null; // allow retry on next mount
        reject(new Error('jitsi script failed to load'));
      };
      document.head.appendChild(script);
    });
  }
  return scriptPromise;
}

interface JitsiRoomProps {
  roomId: string;
  displayName: string;
  /** Fired when the local user leaves the conference (hangs up). */
  onLeft: () => void;
}

export function JitsiRoom({ roomId, displayName, onLeft }: JitsiRoomProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const onLeftRef = useRef(onLeft);
  const [failed, setFailed] = useState(false);

  // Keep the latest onLeft without re-initializing the Jitsi iframe.
  useEffect(() => {
    onLeftRef.current = onLeft;
  }, [onLeft]);

  useEffect(() => {
    let disposed = false;
    let api: JitsiApi | null = null;

    loadJitsiScript()
      .then(() => {
        if (disposed || !containerRef.current || !window.JitsiMeetExternalAPI) {
          if (!disposed) setFailed(true);
          return;
        }
        api = new window.JitsiMeetExternalAPI(JITSI_DOMAIN, {
          roomName: roomId,
          parentNode: containerRef.current,
          width: '100%',
          height: '100%',
          userInfo: { displayName },
          configOverwrite: {
            prejoinConfig: { enabled: false },
            disableDeepLinking: true,
          },
        });
        api.addListener('videoConferenceLeft', () => onLeftRef.current());
      })
      .catch(() => {
        if (!disposed) setFailed(true);
      });

    return () => {
      disposed = true;
      api?.dispose();
    };
  }, [roomId, displayName]);

  if (failed) {
    return (
      <div className="grid h-full place-items-center p-6 text-center">
        <div>
          <p className="text-[15px] font-semibold text-white">ไม่สามารถโหลดระบบวิดีโอคอลได้</p>
          <p className="mt-1 text-[13px] text-white/70">
            กรุณาตรวจสอบการเชื่อมต่ออินเทอร์เน็ต หรือเปิดห้องสนทนาโดยตรง
          </p>
          <a
            href={`https://${JITSI_DOMAIN}/${roomId}`}
            target="_blank"
            rel="noreferrer"
            className="mt-4 inline-block rounded-md bg-emerald-600 px-4 py-2 text-[13px] font-semibold text-white hover:bg-emerald-700"
          >
            เปิดห้องสนทนาในแท็บใหม่
          </a>
        </div>
      </div>
    );
  }

  return <div ref={containerRef} className="h-full w-full" />;
}
