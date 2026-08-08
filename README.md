# tello-p.github.io

Personal site. Static, no build step for the site itself — GitHub Pages serves the
repo as-is (`.nojekyll`).

## Layout

```
index.html                     home page: intro, project cards, contact
assets/site.css                styles shared by every page
projects/
  <project-slug>/
    index.html                 the project's page
    demo/                      optional: a self-contained live demo
    media/                     optional: images and video for that project
    engine/                    optional: that project's own source tree
```

Everything belonging to a project lives under its own folder, so adding one never
touches anything outside `projects/<slug>/` and the card list on the home page.

## Adding a project

1. `mkdir projects/<slug>` and write `projects/<slug>/index.html`. Easiest start is
   to copy an existing project page — the shared shell is
   `<link rel="stylesheet" href="../../assets/site.css">`, a
   `<a class="back" href="../../">` link, an `.intro` header and `<section>`s.
2. Drop any images in `projects/<slug>/media/`, any live demo in
   `projects/<slug>/demo/` (must be self-contained).
3. Add a card to the `.cards` block in `index.html`:

```html
<a class="project project--link" href="./projects/<slug>/">
  <h3>Project name</h3>
  <p class="project__sub">one-line technical subtitle</p>
  <p>Two or three sentences on what makes it interesting.</p>
  <p class="project__more">Read more →</p>
</a>
```

Paths from a project page: `../../` for the site root, `./` for its own assets.

## Projects

### Embedded Qubit Engine — `projects/embedded-qubit-engine/`

Q1.14 fixed-point quantum simulator in C for AVR, with an in-browser trace
debugger. Upstream source: <https://github.com/Tello-P/Embedded-Qubit-Engine>.

- `engine/` — the C core (`src/`, `includes/`), tests, the Arduino sketch
  (`QuantumCore/`) and the web tooling (`web/`).
- `demo/` — the published WebAssembly build. Regenerate with emscripten on PATH:

  ```sh
  node projects/embedded-qubit-engine/engine/web/build-static.mjs
  ```

- Local dev server with the native gcc engine:

  ```sh
  node projects/embedded-qubit-engine/engine/web/server.mjs
  ```

### MyStrace — `projects/mystrace/`

A ptrace-based system call tracer for x86_64 Linux, written in C11. The page is a
write-up with a replayed terminal trace and two interactive figures; it is a
static page split into `index.html`, `page.css` and `page.js`, with no build step.
Upstream source: <https://github.com/Tello-P/strace-in-c>.
