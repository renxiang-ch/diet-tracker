# 🥗 Diet Tracker

A single-file HTML app for two people to log meals, track nutrition, and sync in real time via Supabase.

**Live:** https://renxiang-ch.github.io/diet-tracker/

---

## Features

- **Food diary** — log meals by date, autocomplete from library, per-meal and daily nutrition totals
- **Food library** — save foods with calories, protein, carbs, fat, unit (g/ml/count), and custom serving size
- **AI estimation** — describe or photograph a meal; GPT-4o estimates macros and saves to library automatically
- **Fitness plan** — daily macro goals, weight logging, weekly calorie chart, long-term weight trend
- **Bowel log** — time-stamped entries with notes, full date navigation, per-person
- **Two-person sync** — both users share one Supabase project; changes appear on both devices instantly

---

## Setup

1. Open the live link above
2. Click ☁ → enter your Supabase URL and Anon Key
3. Push or pull to sync data for the first time
4. *(Optional)* Add an OpenAI API key to enable AI estimation

**Supabase table** (run once in SQL editor):
```sql
CREATE TABLE kv_store (
  key TEXT PRIMARY KEY,
  value JSONB,
  updated_at TIMESTAMPTZ DEFAULT now()
);
```
Enable `kv_store` under **Database → Publications → supabase_realtime** for live sync.

---

## Updates

### 2026-05-23
- **Fix** typing in nutrition fields no longer loses focus — cloud sync moved to blur event; `localSave()` used during active typing to avoid Supabase Realtime triggering a re-render mid-input
- **Fix** Chrome no longer prompts to save password for API key / Supabase key fields
- **Fix** diary rows now show protein/carbs/fat from library when they were added to the library after the diary entry was recorded (stale 0/empty values auto-synced from library on render)
- **UX** serving size input hidden on new empty rows — only appears after food name is typed

### 2026-05-19
- **Fix** poop log showing wrong date — `renderPoop` now uses `currentDate` instead of always loading today
- **Fix** date navigation (prev/next buttons) now works in poop and fitness panels, not just diary
- **Fix** diary nutrition fields (cal/protein/carbs/fat) are now always editable; editing syncs back to food library on blur
- **Fix** food library unit/serving preserved when updating an existing entry from the diary
- **Fix** new food inputs no longer lock after typing one digit — save moved from `input` to `blur` event
- **Fix** diary nutrition data now always reads from library (was using stale per-item values)
- **Fix** note field no longer resets while typing when Supabase Realtime fires
- **Feature** poop log date navigation — browse and record for any historical date
- **Feature** diary rows can add brand-new foods inline; data saves to library when calories field is filled

### 2026-05-16
- **Feature** poop log panel with per-person records and cloud sync
- **Feature** custom serving sizes in food library (e.g. 220 ml per serving)
- **Feature** count unit (个) support — log foods by piece count
- **Feature** serving mode toggle in diary (g/ml foods can switch between weight and number of servings)
- **Fix** timezone bug — `todayStr()` now uses local device date instead of UTC

### 2026-05-14
- **Feature** two-person support with shared Supabase sync
- **Feature** Supabase Realtime — changes on one device appear instantly on the other
- **Feature** AI calorie estimation via GPT-4o with function calling to auto-save foods
