export const ORB_MAX_FRAMES_PER_SECOND = 30;
export const ORB_FRAME_INTERVAL_MS = 1_000 / ORB_MAX_FRAMES_PER_SECOND;

type OrbFrameSubscriber = (timestamp: DOMHighResTimeStamp) => void;

interface OrbFrameDriver {
  requestFrame: (callback: FrameRequestCallback) => number;
  cancelFrame: (frameId: number) => void;
  setTimer: (callback: () => void, delayMs: number) => number;
  clearTimer: (timerId: number) => void;
}

export function createOrbAnimationScheduler(
  driver: OrbFrameDriver,
  frameIntervalMs = ORB_FRAME_INTERVAL_MS,
) {
  const subscribers = new Set<OrbFrameSubscriber>();
  let frameId: number | null = null;
  let timerId: number | null = null;

  const scheduleFrame = () => {
    if (frameId === null && timerId === null && subscribers.size > 0) {
      frameId = driver.requestFrame(tick);
    }
  };

  function tick(timestamp: DOMHighResTimeStamp) {
    frameId = null;
    if (subscribers.size === 0) {
      return;
    }
    for (const subscriber of subscribers) {
      subscriber(timestamp);
    }
    timerId = driver.setTimer(() => {
      timerId = null;
      scheduleFrame();
    }, frameIntervalMs);
  }

  return {
    subscribe(subscriber: OrbFrameSubscriber): () => void {
      subscribers.add(subscriber);
      scheduleFrame();
      return () => {
        subscribers.delete(subscriber);
        if (subscribers.size === 0) {
          if (frameId !== null) {
            driver.cancelFrame(frameId);
            frameId = null;
          }
          if (timerId !== null) {
            driver.clearTimer(timerId);
            timerId = null;
          }
        }
      };
    },
  };
}

let browserScheduler: ReturnType<typeof createOrbAnimationScheduler> | null = null;

export function subscribeOrbAnimationFrame(subscriber: OrbFrameSubscriber): () => void {
  browserScheduler ??= createOrbAnimationScheduler({
    requestFrame: (callback) => window.requestAnimationFrame(callback),
    cancelFrame: (frameId) => window.cancelAnimationFrame(frameId),
    setTimer: (callback, delayMs) => window.setTimeout(callback, delayMs),
    clearTimer: (timerId) => window.clearTimeout(timerId),
  });
  return browserScheduler.subscribe(subscriber);
}
