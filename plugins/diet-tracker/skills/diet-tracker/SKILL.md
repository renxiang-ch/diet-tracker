---
name: diet-tracker
description: Record meals and nutrition, search saved foods, review daily or weekly intake, and manage supported personal health logs through the Diet Tracker MCP server.
---

# Diet Tracker

Use the Diet Tracker MCP tools whenever the user wants to record or review food, nutrition, bowel, or menstrual-cycle data.

1. Call `list_people` when the intended person is unclear.
2. Before estimating a food already used before, call `search_food_library` and reuse the saved nutrition values when a match exists.
3. Use `log_meal` for new meal entries. Respect the user's stated date and meal; otherwise use the tool defaults.
4. After a write, report the recorded items and totals returned by the tool. Do not claim success when the tool returns an error.
5. Use `get_diary` before editing or deleting when an `item_id` is not already available.
6. Use `get_weekly_summary` for trends and multi-day summaries.

Treat nutrition estimates as approximate unless the user supplies a product label or other authoritative values. Avoid medical diagnosis or treatment advice.
