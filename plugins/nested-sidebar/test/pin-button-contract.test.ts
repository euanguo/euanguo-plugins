import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

const card = await readFile(
  new URL("../components/inbox/thread-card.tsx", import.meta.url),
  "utf8",
);
const css = await readFile(
  new URL("../components/inbox/pin-button.css", import.meta.url),
  "utf8",
);
const settleCss = await readFile(
  new URL("../components/inbox/settle-button.css", import.meta.url),
  "utf8",
);
const snoozeCss = await readFile(
  new URL("../components/inbox/snooze-button.css", import.meta.url),
  "utf8",
);

/** The stylesheet without its header comment, which explains the design. */
const rules = css.slice(css.indexOf("*/") + 2);

/** The same, without the comments that explain *why* a line is there. */
const declarations = rules.replace(/\/\*[\s\S]*?\*\//g, "");

const pinButton = card.slice(card.indexOf("function PinButton"));

/** The longest duration a stylesheet spends, so the three can be compared. */
function longest(text: string): number {
  return Math.max(...[...text.matchAll(/(\d+)ms/g)].map((m) => Number(m[1])));
}

describe("the pin button's turn and its letters", () => {
  it("ships its own stylesheet with the component that draws it", () => {
    assert.match(card, /import "\.\/pin-button\.css";/);
  });

  it("names nothing after the plugin next door", () => {
    assert.match(rules, /@keyframes nest-pin-seat \{/);
    assert.match(rules, /@keyframes nest-pin-mark \{/);
    assert.match(rules, /\.nest-pin-mark \{/);
    assert.match(
      rules,
      /\.nest-pin:is\(:hover, :focus-visible\) \.nest-pin-mark \{/,
    );
    // Both plugins can be installed at once and this stylesheet is global.
    assert.doesNotMatch(rules, /bb-sidebar/);
  });

  it("keeps the motion behind the reduced-motion gate, and the letters visible", () => {
    assert.match(css, /@media \(prefers-reduced-motion: no-preference\) \{/);
    // Outside the gate, so a reduced-motion user still gets the marks.
    assert.match(
      css,
      /\.nest-pin:is\(:hover, :focus-visible\) \.nest-pin-mark \{\n  opacity: 0\.8;\n\}/,
    );
    assert.match(css, /animation: nest-pin-seat 480ms ease-out both;/);
    assert.match(css, /animation: nest-pin-mark 560ms var\(--pin-delay\) ease-out both;/);
    // The lift and the press are utilities on the button, gated the same way the
    // park pair's are — and the hover state is the only thing that moves.
    assert.match(card, /motion-safe:group-hover\/pin:-translate-y-0\.5/);
    assert.match(card, /motion-safe:group-active\/pin:scale-90/);
    assert.match(card, /motion-reduce:transition-none/);
  });

  it("leaves three P's, each with its own delay and its own path", () => {
    assert.match(card, /\[0, 1, 2\]\.map\(\(mark\) => \(/);
    // A letter, not a pip: the snooze's `z` says *sleep* and this is its other
    // half, saying *pinned*, where a dot says only "something happened".
    assert.match(card, /className="nest-pin-mark">\s*P\s*<\/span>/);
    assert.match(declarations, /font-size: 6px;/);
    assert.match(declarations, /font-weight: 700;/);
    assert.match(declarations, /line-height: 1;/);
    assert.doesNotMatch(declarations, /border-radius: 999px;/);
    for (const index of [1, 2, 3]) {
      assert.match(
        css,
        new RegExp(`\\.nest-pin-mark:nth-of-type\\(${index}\\)`),
      );
    }
    const delays = [...rules.matchAll(/--pin-delay: (\d+)ms/g)].map((m) =>
      Number(m[1]),
    );
    assert.deepEqual(delays, [0, 90, 180]);
    // Each travels its own way: several elements, each with its own delay and
    // its own path, is the whole difference between this and a control moving.
    const paths = [...rules.matchAll(/--pin-x: (-?[\d.]+)px;\n  --pin-y: (-?[\d.]+)px;/g)];
    assert.equal(paths.length, 3);
    assert.equal(new Set(paths.map((m) => `${m[1]},${m[2]}`)).size, 3);
    // Each starts back along the same line, up and to the right of the pin.
    assert.ok(
      paths.every(([, x, y]) => Number(x) > 0 && Number(y) < 0),
      "every P starts up and to the right",
    );
    // ...and all three **land on one point** over the head's right shoulder,
    // which is the row's empty corner in every state — never on its left, where
    // the first version of this drew and read as specks of dirt.
    assert.match(rules, /left: 72%;\n  top: 6%;/);
    assert.equal(
      [...rules.matchAll(/^  left: /gm)].length,
      1,
      "one landing point, not three positions",
    );
    // And they shrink as they come in, so the fall has depth.
    const sizes = [...rules.matchAll(/font-size: ([\d.]+)px;/g)].map((m) =>
      Number(m[1]),
    );
    assert.deepEqual(sizes, [6, 7, 6, 5]);
    // And letters, not stars: settling is what stays celebrated.
    assert.doesNotMatch(rules, /clip-path/);
  });

  it("holds the pin turned, and lands its letters on it", () => {
    // A flash that leaves nothing behind is decoration, so the pin's own frame
    // is held: it stays turned in for as long as the pointer is there, the way
    // the clock stays nodded and the archive stays turned.
    const seat = css.slice(css.indexOf("@keyframes nest-pin-seat"));
    assert.match(seat, /100% \{\n    transform: translateY\(-0\.4px\) rotate\(-1\.5deg\);\n  \}/);
    // The letters are the event, and they come *to* the pin: the last keyframe
    // is the landing point, not a drift away from it. That is the difference
    // between something being kept and something leaving — and the snooze's
    // `z`s, which end out in the row above the clock, are the other half of it.
    const letters = css.slice(css.indexOf("@keyframes nest-pin-mark"));
    assert.match(
      letters,
      /100% \{\n    opacity: 0;\n    transform: translate\(0, 0\) scale\(1\.06\);\n  \}/,
    );
    const snoozeDrift = snoozeCss.slice(snoozeCss.indexOf("@keyframes nest-snooze-drift"));
    assert.match(
      snoozeDrift,
      /transform: translate\(var\(--z-drift\), var\(--z-rise\)\) scale\(1\.15\)/,
    );
  });

  it("wears the colour its neighbours wear", () => {
    // The three controls sit in one row: a pin a shade lighter than the clock
    // and the archive beside it reads as a disabled control rather than as the
    // same control in another state. The fill is the whole difference.
    assert.doesNotMatch(pinButton, /text-muted-foreground/);
    assert.match(pinButton, /"hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"/);
    assert.match(pinButton, /cn\("hover:text-foreground", PIN_MOTION\.button\)/);
  });

  it("is the shortest of the row's three effects", () => {
    // Settling is over, snoozing is later, and pinning is now: the pin is the
    // quickest act of the three, and its effect is the shortest by construction.
    assert.ok(
      longest(rules) < Math.min(longest(settleCss), longest(snoozeCss)),
      `pin ${longest(rules)}ms against settle ${longest(settleCss)}ms and snooze ${longest(snoozeCss)}ms`,
    );
  });

  it("claims no hue of its own", () => {
    // The park pair name a colour because settling and snoozing are decisions
    // the row cannot report any other way. The pin is a control like the rest of
    // the row's controls, so it takes `currentColor` and the row's own tint — a
    // hard-coded hue here would ignore a palette the user chose.
    const pin = card.slice(card.indexOf("const PIN_MOTION"), card.indexOf("function PinButton"));
    for (const text of [declarations, pin]) {
      assert.doesNotMatch(text, /#[0-9a-f]{3,6}\b|emerald|violet|amber|sky|rgb\(/i);
    }
    // The letters take `currentColor`; the ground is that same colour at 10%.
    assert.match(declarations, /color: currentColor;/);
    assert.match(
      declarations,
      /background-color: color-mix\(in oklab, currentColor 10%, transparent\);/,
    );
  });
});
