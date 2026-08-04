// The Blizzard overlay: the half of the toolbar pair that the engine knows nothing about.
//
// Pure decoration, deliberately. `Toolbar.Action` is for a host's OWN actions, and the
// clearest way to show that is an action with no possible engine meaning sitting beside one
// whose enabled state the engine owns.
//
// CSS animation rather than a canvas loop: a few dozen absolutely-positioned flakes on
// `transform` stay on the compositor, so the blizzard cannot steal frames from layout or
// paint while the user is typing underneath it.

const FLAKES = 60;

/** Deterministic, so the blizzard looks the same every time it is switched on. */
function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

const flakes = (() => {
  const random = makeRandom(0xb112);
  return Array.from({ length: FLAKES }, (_, index) => ({
    key: index,
    left: `${random() * 100}%`,
    size: `${2 + random() * 5}px`,
    duration: `${4 + random() * 7}s`,
    delay: `${-random() * 10}s`,
    drift: `${(random() - 0.5) * 160}px`,
    opacity: 0.25 + random() * 0.55,
  }));
})();

export function Blizzard() {
  return (
    <div className="igloo-blizzard" aria-hidden="true">
      {flakes.map((flake) => (
        <span
          key={flake.key}
          className="igloo-blizzard__flake"
          style={{
            left: flake.left,
            width: flake.size,
            height: flake.size,
            opacity: flake.opacity,
            animationDuration: flake.duration,
            animationDelay: flake.delay,
            ['--igloo-drift' as string]: flake.drift,
          }}
        />
      ))}
    </div>
  );
}
