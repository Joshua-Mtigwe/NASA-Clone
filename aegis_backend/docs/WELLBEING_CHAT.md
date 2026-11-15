# Reflective Coach (chat and journal): frontend guide

Two screens for an astronaut: a **chat** ("how I feel right now") and a private **journal**. Show both
only when the chosen persona is an **astronaut**. The medical officer gets a small review area.

The coach is a guided-reflection tool, not a therapist or a doctor. Do not label it "therapy",
"counselling" or "AI doctor" anywhere in the interface.

## Always on screen

Every chat and journal response includes two short texts. Show both near the input box at all times:

* `safety_note`: it is a reflection tool, not medical advice, and not a substitute for the crew.
* `privacy_note`: what they write is private unless they share it, with one exception (serious risk
  signs are flagged to the medical officer as an indicator, never their words).

People write more honestly when they know who can read it, so do not hide the privacy note behind a link.

## Chat

```
POST /api/v1/wellbeing/chat
X-AEGIS-User: crew2
{"message": "I feel exhausted and foggy this morning."}
```

Send back `conversation_id` to continue the same conversation. Response (shortened):

```json
{"conversation_id": "CHT-…", "flagged": false, "medical_officer_alerted": null,
 "message": {"message_id": "MSG-…", "sender": "astronaut", "text": "I feel exhausted…",
             "coach_summary": {"mood": "negative", "themes": ["sleep"], "stress_triggers": [],
                               "thinking_patterns": []}},
 "reply":   {"message_id": "MSG-…", "sender": "assistant", "source": "gemma", "text": "…"},
 "safety_note": "…", "privacy_note": "…"}
```

* **`reply.source`:**
  * `gemma`: written by the model and checked;
  * `rules`: the model was off or its answer failed a check. Show it the same way;
  * `escalation`: urgent. Show this reply **prominently** (for example a red banner with
    "Contact the medical officer now").
* **`medical_officer_alerted`** is `null`, `"immediate"` or `"persistent"`. When it is not null, show a
  plain line such as "The medical officer has been told you may need support. They were told the
  reason, not your words." Never hide this from the astronaut.
* `coach_summary` is optional to display (for example as small tags under their message).
* A reply can take 30 to 60 seconds on a laptop (the coach analyses first, then writes). Show a
  typing indicator.
* Messages are at most 1000 characters (422 otherwise).

Past conversations:

```
GET  /api/v1/wellbeing/conversations                    list (newest first)
GET  /api/v1/wellbeing/conversations/{id}               all messages, oldest first
POST /api/v1/wellbeing/conversations/{id}/share         {"shared": true}   or false to take it back
```

Give each conversation a clear "Share with the medical officer" switch, off by default.

## Journal

```
POST /api/v1/journal/entries     {"text": "Long day, but dinner with the crew was good."}
```

```json
{"entry": {"entry_id": "JRN-…", "mission_day": 20, "text": "…",
           "reflection_text": "…", "reflection_source": "gemma",
           "writing_prompt": "Next time, you could write about one moment with a crewmate that went well.",
           "coach_summary": {"mood": "mixed", "themes": ["interactions with crewmates", "food"], "…": "…"},
           "shared_with_medical_officer": false, "is_synthetic_demo": false},
 "your_patterns": {"recent_entries": 5, "earlier_entries": 9,
                   "rising_themes": [{"theme": "sleep", "recent_count": 4, "of_recent_entries": 5,
                                      "earlier_count": 1, "of_earlier_entries": 9}]},
 "medical_officer_alerted": null, "safety_note": "…", "privacy_note": "…"}
```

* Show `reflection_text` under the entry, and `writing_prompt` as a gentle suggestion for next time.
* `reflection_source` works like `reply.source` above, including `escalation`.
* Entries are at most 4000 characters.

| Screen | Call |
|---|---|
| My entries | `GET /journal/entries` (`?from_day=&to_day=`) |
| One entry | `GET /journal/entries/{id}` |
| Share or unshare an entry | `POST /journal/entries/{id}/share` `{"shared": true}` |
| My trends | `GET /journal/trends` |
| Research consent | `GET /journal/consent`, `PUT /journal/consent` `{"research_consent": true}` |
| Fill with demo entries | `POST /journal/demo-entries` `{"days": 14}` |

* **Trends** returns `by_week` (entries, themes and mood per mission week) and
  `compared_with_your_own_earlier_entries` (the same shape as `your_patterns`). Word it as "you wrote
  about sleep more often lately", never as a judgement or a score.
* **Consent** returns `what_this_means`; show that text next to the switch. Off by default.
* **Demo entries** carry `is_synthetic_demo: true`. Mark them "demo" in the list. Jump the run to day
  15 or later first, so there are days to fill.

## Medical officer (persona `medical_officer`)

| Screen | Call |
|---|---|
| Risk flags (show an open-count badge) | `GET /wellbeing/risk-flags?open_only=true` |
| Record a follow-up | `POST /wellbeing/risk-flags/{id}/acknowledge` `{"note": "…"}` |
| Conversations | `GET /wellbeing/conversations` |
| Shared journal entries | `GET /journal/entries` |
| Crew-level journal themes | `GET /journal/research-summary` |

```json
{"open_count": 1, "flags": [{"flag_id": "RSK-…", "astronaut_id": "AST-003", "level": "persistent",
  "source": "journal", "open": true,
  "indicators": [{"marker": "hopelessness", "meaning": "hopelessness", "count": 3, "of_last": 5}]}],
 "note": "Flags carry the indicator only. …"}
```

* A flag never contains the astronaut's words. Show `meaning`, and `count` of `of_last` when present.
* Opening a conversation the astronaut has **not** shared returns `"private": true` and an empty
  `messages` list. Show "Not shared" rather than an error.
* A shared conversation shows every message plus, on each reply, `facts.shown_to_model` (what the model
  was given) and `check_problems` (why a model answer was replaced, if it was).
* `research-summary` returns `"available": false` with a `reason` until at least 3 astronauts consent.
  Show the reason. It never returns text or per-person figures.

## Who sees what

| Persona | Can |
|---|---|
| Astronaut | Chat, write journal entries, see only their own writing, trends and flags; share or unshare; give or withdraw research consent |
| Medical officer | See risk flags and acknowledge them; read only what astronauts shared; crew-level theme counts; cannot chat or write |
| Researcher | Crew-level theme counts only |
| Mission leader | Nothing here (403) |
