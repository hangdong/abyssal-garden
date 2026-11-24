# Coastal Quest

**A procedural coastal cove you can swim through, walk around and play in, right in your browser: as a swimmer, a sea lion, a gull or the lifeguard.**

Towering kelp forests, sunbeams pouring through a rippling surface, a sunken ship, manta rays gliding overhead.
And all of it is made by code: no images, no 3D models, no sound files. The whole world fits in **one small HTML file** (about 150 KB).

![Kelp forest with a stone whale tail and a manta ray](.github/screenshots/whale-fluke.jpg)

## Try it

1. Download [`index.html`](index.html).
2. Open it in **Chrome** or **Edge** on a desktop computer.
3. Wait a few seconds while the world is built, then press **Dive in** and start swimming.

Nothing to install, and it works offline. It needs a browser with **WebGPU**. If you see *"This scene needs WebGPU"*, update your browser or switch to Chrome / Edge.

## What's down there

- **Kelp forests** that sway in the current and sparkle with tiny gold and green specks
- **Light rays** streaming down from a wavy surface, with shimmering caustics on the sea floor
- **A sunken wooden ship**, a **giant stone whale tail**, rock arches, canyons and floating boulders
- **Manta rays**, schools of fish, rising bubbles and drifting particles
- **A sandy cove** on the east edge, in the spirit of La Jolla Cove: pale sand and turquoise shallows with surf foam, two 10 m sandstone points with sea stacks off the north one, a stairway up the side of each point, and a clifftop with a paved promenade, stainless rails, benches, lamps, palms, wind-sculpted trees and a lifeguard tower cantilevered over the beach. A sea cave with two arched tunnels runs through the south point. Families and kids relax on the north side of the beach (they chat, wave, dig, walk the shore, and step aside or run off if you come close), a group of sea lions hauls out on the south side (they raise their heads and bark when you approach; the shy ones gallop into the sea, the bold ones rear up, bark a warning, charge and bite, which knocks you back, so keep your distance; they haul out again once you have gone). About a dozen pups sleep among them; when the grown-ups bolt, the pups stay behind, lift their heads, call out and shuffle about on their own, and only waddle off if you come very close. Animals and people never overlap, and more sea lions and snorkelers swim in the cove: the sea lions (large, with ear flaps, rowing with their big fore flippers) come to circle you when you swim, the snorkelers stop and look up, and the shy spotted harbour seals (no ear flaps, powered by their hind flippers) keep their distance. Gulls strut and peck on the sand, float on the sea and wheel overhead, taking off with a squawk when you come near. A lifeguard in the tower watches the beach and shouts (caption, whistle and, if your browser has a voice, speech) at anyone who gets too close to the sea lions. Out in the open water, well away from the cove and the swimmers, kayakers and stand-up paddle boarders paddle about and surfers wait on their boards, paddle out and ride the swell. Friendly chipmunks scamper over the clifftop turf and run up to you or the tourists, sitting up to beg for food Surfgrass beds grow in the clear shallows and orange garibaldi patrol over them (keys `7` and `8`)
- **A purple grotto** with glowing magenta ground cover, coral and barrel sponges
- **A soundscape** made up as you listen: a deep rumble, distant whale calls, soft chimes and bubbles

| | |
|---|---|
| ![Shipwreck](.github/screenshots/shipwreck.jpg) | ![Looking up through the kelp](.github/screenshots/kelp-forest.jpg) |
| ![Barrel sponges](.github/screenshots/sponge-garden.jpg) | ![Light rays over the kelp basin](.github/screenshots/light-rays.jpg) |

![The purple grotto](.github/screenshots/purple-grotto.jpg)

## Controls

| | Keyboard & mouse |
|---|---|
| Look around | Move the mouse |
| Swim | `W` `A` `S` `D` |
| Up / down | `E` / `Q` (at the surface `E` puts your head out of the water, `Q` or looking down while swimming forward dives again) |
| Swim faster | Hold `Shift` |
| Jump to a viewpoint | `1` to `8` (the spots in the screenshots, the sand cove underwater, and the beach) |
| Menu | `Esc` releases the mouse and opens the menu with the list of controls; **Resume** takes you back |
| Play as another character | `T` cycles Swimmer → Sea lion → Gull → Lifeguard → Pelican |
| Call | `B`: bark (sea lion), squawk (gull), warn the visitors away from the sea lions (lifeguard), plunge-dive for fish (pelican) |
| Chase camera / own eyes | `V` (the animals and the lifeguard are shown from behind by default) |
| Sound on / off | `M` (sound starts when you dive in) |
| Performance stats | `H` |
| Detail level | **Low**, **Medium** or **High** in the menu (reloads the page) |

**Playing as someone else:** press `T`. As a **sea lion** you waddle or gallop over the sand (`Shift` to run), slip into the sea and swim fast with the fore flippers, haul out again, and bark with `B`; the other sea lions treat you as one of them. A baby sea lion follows you everywhere, on the sand and through the water, and squeaks when you leave it behind. As a **gull** you fly (look up and down to climb and dive, `W` to speed up), let go of `W` and press `S` to settle onto the sand or the water, walk around or paddle, and take off again with `E`. As a **pelican** you fly the same way, but with `B` over deep water you fold your wings and plunge-dive, spend a couple of seconds under the surface after a fish (`E` brings you up early), then surface and swallow; the HUD counts the fish you catch. The computer-run pelicans do the same thing: they perch on the cliff and a sea stack, float in the cove, and now and then take off, circle, dive for fish with a splash, and land again. As the **lifeguard** you walk the cliff top and the beach; every so often a few visitors wander over to the sea lions, and `B` blows your whistle and tells them to stay back (the sea lions bolt if they get too close). With you as the lifeguard the tower is yours; otherwise its lifeguard watches the beach for you.

**The beach:** swim into the cove on the east side (key `7` takes you there underwater, `8` stands you on the sand), pop your head out and wade ashore. The stairways climb to the clifftop; you can't step off the cliff edge, and the trees and palms are not solid (you walk through them). On land you walk with `W` `A` `S` `D` (`Shift` to jog), the eye stays at standing height over the sand, and cliffs and steep rocks stop you. Walk back into the water until it is too deep to stand and you are swimming again.

The seabed, cliffs and arches are solid: you glide along the rock instead of swimming into it, and you still fit through every tunnel and arch. Kelp, plants, corals, sponges, loose rocks, the floating boulders, the ship and the whale tail you can swim through.

**On a touchscreen:** hold one finger down to swim forward and slide it to steer. Put a second finger down to go faster. The `≡` button in the corner opens the menu. Phones always show the scene in landscape and start on Low or Medium detail. (Touch support is experimental.)

## Detail levels

The **Low**, **Medium** and **High** buttons in the menu pick the detail level; the current one is lit. Each level is the same world, built with less in it:

| Level | What it is | Picked on a first visit for |
|---|---|---|
| **High** | The full scene | Computers |
| **Medium** | Half of the leaves, sparkles and pebbles; small rocks, sponges and corals cast no shadows | Phones with 8 GB of memory |
| **Low** | A quarter of the leaves, no anti-aliasing, coarser rocks and corals, simpler lighting, 480p to start with | Other phones, and computers with 4 GB of memory or less |

If loading crashes the tab, or the graphics driver gives up, the page starts again one level lower. Your browser remembers the level, and the resolution and draw distance the scene settled on, for the next visit.

## How it works

- The seabed is sculpted on your graphics card every time the page opens, then decorated with about two million kelp leaves and plants, tens of thousands of rocks, and thousands of sponges, corals and fish.
- Everything is drawn with **WebGPU** directly. No game engine or 3D library is used.
- The ship, whale tail, mantas, fish and corals are built from simple mathematical shapes.
- The sound is synthesized live with the Web Audio API.
- It's built to run smoothly: about 180 fps at 2560×1440 on an RTX 5070 Ti. On slower hardware it aims for 60 fps by lowering first the resolution and then how far away plants and rocks are drawn, in small steps. The scene is already running, blurred, behind the start menu, so most of that tuning is done before you dive in. A low-end phone (Samsung Galaxy A16) reaches about 20 fps at 670×372 on Low.

## Make it your own

The readable source code is in the [`source`](source) folder. To change something and rebuild `index.html` you need [Node.js](https://nodejs.org) 18 or newer:

```bash
cd source
npm install
npm run build
```

This writes a new `index.html` next to this README. `npm run build:readable` writes an unminified version instead, which is easier to debug in the browser's developer tools.

`npm run build:dev` writes a separate `dev.html` with two extra tools that are not part of `index.html`: `F` flies the camera along a one-minute path through the whole world, and `B` runs that flight as a benchmark and reports frame and GPU times.

| File | What's inside |
|---|---|
| [`source/src/world.js`](source/src/world.js) | The world layout: rock walls, arches, tunnels, kelp forests, sponge gardens, fish schools, mantas, the ship and the whale tail. **A good place to start.** |
| [`source/src/shaders.js`](source/src/shaders.js) | The look: water and fog colors, lighting, kelp, rocks, the water surface and light rays (WGSL shader code) |
| [`source/src/main.js`](source/src/main.js) | The renderer, the camera, the controls, the six viewpoints and the camera path the world is laid out around |
| [`source/src/audio.js`](source/src/audio.js) | The soundscape |
| [`source/src/quality.js`](source/src/quality.js) | The detail levels: which one a device starts on, and what is remembered between visits |
| [`source/src/math.js`](source/src/math.js) | Noise, random numbers and mesh-building helpers |
| [`source/src/dev.js`](source/src/dev.js) | Development tools (fly-through and benchmark), only in `dev.html` |
| [`source/template.html`](source/template.html) | The page around the scene: loading bar, start menu, links and their styles |

Some easy first tweaks:

- **Water color:** `WCOL` (blue-green water) and `PCOL` (purple grotto) near the top of the shared scene code in `shaders.js`
- **Sunlight color:** `SUNC` right next to them
- **Brightness and light rays:** `EXPO` and `RAYS` in `main.js`
- **Swimming speed:** search for `26 : 7` in `main.js` (fast speed : normal speed)

## License

[MIT](LICENSE): free to use, change and share, including in your own projects.
