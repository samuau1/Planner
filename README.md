# Planner

A personal task manager, day planner and project manager. It runs in the browser on iPhone and Mac and keeps its data in my own Supabase project.

## How it's built

- Plain HTML, CSS and JavaScript. No build step, no libraries, nothing to install.
- Data and sign-in: Supabase (REST and Auth APIs called directly from `js/api.js`).
- Works offline: changes are kept on the device and sent when the connection returns.

| File | What it does |
| --- | --- |
| `config.js` | Supabase address and publishable key |
| `js/api.js` | Sign-in, talking to Supabase, the offline outbox |
| `js/store.js` | The data in memory, changes, and project progress |
| `js/views.js` | The HTML for each screen |
| `js/app.js` | Routing, clicks, forms, start-up |
| `styles.css` | The look, light and dark |
| `sw.js` | Lets the app open without a connection |
| `js/project.js` | The Projects overview and each project page |
| `js/charts.js` | Progress graph and roadmap timeline |
| `js/writing.js` | The dissertation word counter |
| `js/look.js` | Project colours and emojis |
| `js/plan.js` | The day timeline, daily planning, project time, drag and drop |
| `js/calendar.js` | Month and week calendar, and the timeline of all projects |
| `supabase/schema.sql` | Database tables and privacy rules |
| `supabase/002_colours_progress_writing.sql` | Update 2: emojis, colours, progress history, word counter settings |
| `supabase/003_settings.sql` | Update 3: personal settings such as your usual working hours |
| `supabase/004_ongoing_and_blocks.sql` | Update 4: ongoing tasks and project time blocks |

## Setting up from scratch

1. Create a Supabase project and run `supabase/schema.sql`, then `002_colours_progress_writing.sql`, `003_settings.sql` and `004_ongoing_and_blocks.sql`, in its SQL Editor.
2. Create your user under Authentication → Users, then turn off new sign-ups.
3. Put the project URL and publishable key in `config.js`.
4. Host the folder on any static host (GitHub Pages, Cloudflare Pages, Codeberg Pages).

## Running it locally

Any static file server works, for example `python3 -m http.server` in this folder, then open http://localhost:8000.

## Stages

1. Areas, projects, subgoals, tasks, Inbox and Today ✓
2. Daily planning with time blocks and working days ✓
3. Calendar and Timeline ✓, plus ongoing tasks and project time
4. Dissertation word counter ✓ (brought forward)
4. Focus mode
5. Insights and the Done log
