# 🥗 Diet Tracker

A single-file HTML diet tracking web app for two people. Features AI calorie estimation, a food library, fitness planning, bowel movement logging, and real-time cloud sync via Supabase.

**Live:** https://renxiang-ch.github.io/diet-tracker/

---

## Features

### Food Diary
- Log meals (breakfast, lunch, dinner) by date with full date navigation
- All nutrition fields (calories, protein, carbs, fat) are always editable directly in the diary row
- Changes sync back to the food library automatically on blur
- Autocomplete from saved food library when typing food names
- Add brand-new foods inline — data saves to library when you fill in calories and leave the field
- Record by weight (g/ml), by count (个), or by number of servings (份)
- Custom serving size per food (e.g. 220 ml per serving for a drink)
- Per-meal and daily nutrition totals update in real time
- Daily calorie progress bar vs. goal

### Food Library
- Store per-serving nutrition data for frequently used foods
- Three unit types: g, ml, 个 (count)
- Custom serving size support (e.g. a 220 ml carton)
- Edit food data directly from the diary — library stays in sync

### AI Estimation (GPT-4o)
- Describe a meal or upload a photo — AI estimates calories and macros
- Uses OpenAI function calling to automatically save new foods to the library
- Confirmation card shown in chat when foods are saved

### Fitness Plan
- Set daily goals for calories, protein, carbs, fat, and target weight
- Log daily weight; view a long-term weight trend chart (30 / 90 / 180 / all days)
- Weekly calorie bar chart: green = on target, red = over, blue = under
- This-week bowel movement summary grid

### Bowel Movement Log
- Log time and optional notes per day
- Full date navigation — browse any historical date
- Per-person records, independent from the other user

### Two-Person Support
- Both users share one Supabase project — data syncs in real time across devices
- Each person's diary, fitness, and bowel movement data is stored separately
- Person tabs visible in diary, fitness, and poop panels

### Cloud Sync (Supabase)
- All data stored in a `kv_store` table (`key TEXT PRIMARY KEY, value JSONB, updated_at TIMESTAMPTZ`)
- Supabase Realtime pushes changes instantly to both devices
- localStorage used as a local cache — works offline too
- Synced keys: `diet_data2`, `custom_foods`, `fitness_goals`, `weight_logs`, `person_names`, `poop_logs`
- API keys and Supabase credentials are stored only in localStorage and never synced to the cloud

---

## Getting Started

1. Open https://renxiang-ch.github.io/diet-tracker/
2. Click the ☁ icon (top right) and enter your Supabase project URL and Anon Key
3. Use **Push local data** or **Pull cloud data** to do the initial sync
4. *(Optional)* Enter your OpenAI API Key to enable AI estimation

### Supabase Table Setup

Run this in the Supabase SQL editor:

```sql
CREATE TABLE kv_store (
  key         TEXT PRIMARY KEY,
  value       JSONB,
  updated_at  TIMESTAMPTZ DEFAULT now()
);
```

Then go to **Database → Publications → supabase_realtime** and enable the `kv_store` table so both devices receive live updates.

---

## Running Locally

No build step needed — just open the file in a browser:

```bash
open index.html
```

---

## Tech Stack

| Layer | Choice |
|---|---|
| Frontend | Vanilla HTML / CSS / JS (single file, no framework) |
| Cloud storage | Supabase (`kv_store` table + Realtime) |
| Local cache | `localStorage` |
| AI | OpenAI GPT-4o with function calling |
| Charts | HTML Canvas API |
| Hosting | GitHub Pages (auto-deploy on push to `main`) |
