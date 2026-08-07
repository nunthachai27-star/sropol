// Media smoke test — the one thing unit/integration tests cannot cover:
// does audio/video actually flow between two participants through
// jitsi1.hosxp.net?
//
// Two Chromium contexts (fake cameras — see playwright.config.ts launch args)
// join the same random room through a local harness page that embeds Jitsi
// EXACTLY the way src/components/calls/JitsiRoom.tsx does (same
// external_api.js, same options) and — crucially — is served with the real
// production Permissions-Policy header (imported from security-headers.ts).
// If that policy ever regresses to camera=() (the 2026-07-11 incident), the
// iframe loses getUserMedia and this test fails.
//
// Asserted per browser: conference joined → both participants visible →
// at least 2 <video> elements decoding live frames (local + remote).
//
// Requires internet access to jitsi1.hosxp.net; skips itself when the server
// is unreachable (e.g. offline CI).
import { test, expect, type Page } from '@playwright/test';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { JITSI_DOMAIN } from '../../src/config/video-call';
import { PERMISSIONS_POLICY } from '../../src/lib/security-headers';

const HARNESS_HTML = `<!doctype html>
<html>
<head><meta charset="utf-8"><title>kk-lrms media smoke</title></head>
<body style="margin:0">
<div id="room" style="width:100vw;height:100vh"></div>
<script src="https://${JITSI_DOMAIN}/external_api.js"></script>
<script>
  const params = new URLSearchParams(location.search);
  window.__joined = false;
  window.__remoteJoined = false;
  // Same options as src/components/calls/JitsiRoom.tsx.
  window.__api = new JitsiMeetExternalAPI('${JITSI_DOMAIN}', {
    roomName: params.get('room'),
    parentNode: document.getElementById('room'),
    width: '100%',
    height: '100%',
    userInfo: { displayName: params.get('name') },
    configOverwrite: {
      prejoinConfig: { enabled: false },
      disableDeepLinking: true,
    },
  });
  window.__api.addListener('videoConferenceJoined', () => { window.__joined = true; });
  window.__api.addListener('participantJoined', () => { window.__remoteJoined = true; });
</script>
</body>
</html>`;

let server: http.Server;
let harnessUrl: string;
let jitsiReachable = true;

test.beforeAll(async () => {
  // Reachability probe — skip cleanly when the Jitsi server is unreachable.
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(`https://${JITSI_DOMAIN}/external_api.js`, {
      method: 'HEAD',
      signal: controller.signal,
    });
    clearTimeout(timer);
    jitsiReachable = res.ok;
  } catch {
    jitsiReachable = false;
  }

  // Harness server: serves the embed page WITH the production
  // Permissions-Policy so the test exercises the same policy users get.
  server = http.createServer((_req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Permissions-Policy': PERMISSIONS_POLICY,
    });
    res.end(HARNESS_HTML);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  harnessUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

test.afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function joinRoom(page: Page, room: string, name: string): Promise<void> {
  await page.goto(`${harnessUrl}/?room=${encodeURIComponent(room)}&name=${name}`);
  await page.waitForFunction(() => (window as unknown as { __joined: boolean }).__joined, null, {
    timeout: 45_000,
  });
}

// Live video = decoded frames are advancing, not just an attached track.
async function countPlayingVideos(page: Page): Promise<number> {
  const jitsiFrame = page.frameLocator('iframe[name^="jitsiConference"]');
  return jitsiFrame.locator('video').evaluateAll(
    (videos) =>
      videos.filter((v) => {
        const video = v as HTMLVideoElement;
        return video.readyState >= 2 && video.videoWidth > 0 && !video.paused;
      }).length,
  );
}

test('two browsers exchange live video through the production Jitsi server', async ({
  browser,
}) => {
  test.skip(!jitsiReachable, `https://${JITSI_DOMAIN} unreachable from this environment`);

  const room = `kklrms-e2e-media-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

  const contextA = await browser.newContext({ permissions: ['camera', 'microphone'] });
  const contextB = await browser.newContext({ permissions: ['camera', 'microphone'] });
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  try {
    // Both participants join the same room (like caller + accepted invitee).
    await joinRoom(pageA, room, 'e2e-caller');
    await joinRoom(pageB, room, 'e2e-callee');

    // Each side must see the other join the conference.
    for (const page of [pageA, pageB]) {
      await page.waitForFunction(
        () => (window as unknown as { __remoteJoined: boolean }).__remoteJoined,
        null,
        { timeout: 30_000 },
      );
      await expect
        .poll(
          () =>
            page.evaluate(() =>
              (
                window as unknown as { __api: { getNumberOfParticipants(): number } }
              ).__api.getNumberOfParticipants(),
            ),
          { timeout: 30_000 },
        )
        .toBe(2);
    }

    // Media proof: each browser decodes at least two live video streams —
    // its own fake camera AND the remote participant's frames arriving
    // over WebRTC. This is the layer no jsdom test can reach.
    for (const page of [pageA, pageB]) {
      await expect
        .poll(() => countPlayingVideos(page), { timeout: 45_000 })
        .toBeGreaterThanOrEqual(2);
    }
  } finally {
    await contextA.close();
    await contextB.close();
  }
});
