# Open-source icon library research

Research date: 2026-09-20

This note compares icon libraries that could replace the current icon artwork
without assuming the icons are only for groups. The shortlist considers visual
style, breadth, licensing, maintenance, and how well a library can support a
consistent product-wide language.

## MIT candidates

| Library | Visual direction | Scale and formats | License | Assessment |
| --- | --- | --- | --- | --- |
| Phosphor | Friendly, soft, expressive; the weight system ranges from Thin through Duotone | Official core assets are raw SVGs with catalog metadata; the official pack exposes Regular, Thin, Light, Bold, Fill, and Duotone selections | MIT | Best overall balance of cute, elegant, and adaptable. The multiple weights make it possible to use a quieter outline for navigation and a warmer filled or duotone treatment for identity icons. |
| Tabler Icons | Clean, rounded, polished, slightly playful when using its filled variants | 6,202 icons in the current website catalog; 24×24 grid, outline and filled styles, React and other official packages | MIT | Best for coverage and consistency. It has enough breadth for a whole application and a strong style system, though it feels more utilitarian than Phosphor. |
| Iconoir | Refined, airy, editorial, with a distinctive geometric line quality | 1,600+ SVG icons on a 24×24 grid; regular and solid assets; React, Vue, Flutter, Figma, and other integrations | MIT | Best if the target is elegant and quiet. Its smaller catalog is a tradeoff, and some playful or unusual concepts may need manual selection. |
| Eva Icons | Rounded, friendly, mobile-oriented, with a clearly cute edge | 480+ icons; Fill and Outline variants; SVG, font, Sketch, and animated modes | MIT | Best for a more obviously approachable product. It is visually warmer, but the library is older and the animations can make the overall system feel less restrained if used broadly. |
| Heroicons | Minimal, premium, restrained; outline and solid styles | Official 16, 20, and 24px SVG sets with React and Vue packages | MIT | Very polished for core UI actions. It is a strong supporting set, but less expressive for a large custom icon picker. |
| Bootstrap Icons | Neutral, compact, dependable | 2,000+ SVG icons with sprite, CSS, and Figma usage | MIT | Reliable fallback with broad coverage. It is less distinctive and less cute than the top three. |
| CSS.gg | Compact, geometric, technical | 700+ UI icons plus SVG and Figma assets | MIT | Interesting for a deliberately minimal or pixel-like look, but not the best fit for a soft, elegant product identity. |
| Doodle Icons | Hand-drawn, whimsical, visibly cute | 439 icons in the React package; categories include emoji, gestures, objects, food, and interface icons | MIT | Strongest “cute” option. It would change the product personality substantially and has less mature coverage for conventional product UI. |

## Strong visual candidates with a different license

| Library | Why it is interesting | License caveat |
| --- | --- | --- |
| MingCute | Its official description is specifically “simple, elegant”; the visual language is close to a softer, more modern product UI | Apache-2.0, not MIT |
| Lucide | Very coherent, familiar, and well maintained for general UI | ISC, not MIT; permissive, but not the requested license |
| Solar | Expressive and attractive, with a large modern catalog | The repository includes third-party icons under CC BY 4.0, so it is not a clean MIT replacement |

## Recommendation

The first library I would prototype is **Phosphor**. It offers the clearest
path to a product that feels warmer and more alive while retaining a disciplined
system. Its six weights let the product use one family instead of mixing a
playful icon picker with a separate utility icon language.

The second choice is **Tabler** if coverage and long-term consistency matter more
than personality. It is the safest full replacement for a large existing catalog.

The third choice is **Iconoir** if the goal is a quieter, more elegant sidebar
with less visual noise.

For a more radical personality change, **Doodle Icons** is the cute option, but I
would use it only after a small visual prototype because hand-drawn icons can
make dense developer tooling feel less precise.

## Sources

- Phosphor core and license: https://github.com/phosphor-icons/core
- Phosphor weight pack: https://pack.phosphoricons.com/
- Tabler Icons repository and license: https://github.com/tabler/tabler-icons
- Tabler current catalog: https://tabler.io/icons
- Iconoir repository and license: https://github.com/iconoir-icons/iconoir
- Iconoir package metadata: https://github.com/iconoir-icons/iconoir/blob/main/package.json
- Eva Icons repository and license: https://github.com/akveo/eva-icons
- Heroicons repository and license: https://github.com/tailwindlabs/heroicons
- Bootstrap Icons repository: https://github.com/twbs/icons
- CSS.gg repository: https://github.com/astrit/css.gg
- Doodle Icons React package: https://github.com/agilek/react-doodle-icons
- MingCute repository and Apache-2.0 license: https://github.com/mingcute-design/mingcute-icons
- Lucide license: https://github.com/lucide-icons/lucide/blob/main/LICENSE
- Solar third-party license notice: https://github.com/saoudi-h/solar-icons/blob/main/LICENSE-THIRD-PARTY
