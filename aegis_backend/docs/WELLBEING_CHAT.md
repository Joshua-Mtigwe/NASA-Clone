# Wellbeing chat: frontend guide

A chat where an astronaut describes how they feel. The backend replies using their own metrics and
stores every message and reply. Show it only when the chosen persona is an **astronaut**.

## Sending a message

```
POST /api/v1/wellbeing/chat
X-AEGIS-User: crew2
{"message": "I feel exhausted and foggy this morning."}
```

To continue the same conversation, send back its `conversation_id`:

```json
{"message": "Still tired now.", "conversation_id": "CHT-…"}
```

Response (shortened):

```json
{"conversation_id": "CHT-…", "flagged": false,
 "message": {"message_id": "MSG-…", "sender": "astronaut", "text": "I feel exhausted…", "mission_time": "…"},
 "reply":   {"message_id": "MSG-…", "sender": "assistant", "source": "gemma",
             "text": "You're saying you're feeling exhausted… Perhaps you could try a Guided paced breathing session for 8 minutes. …"},
 "safety_note": "This is general wellbeing support, not medical advice. If you feel worse or unsure, contact the medical officer."}
```

* **Show `safety_note`** under the chat at all times.
* **`reply.source`:**
  * `gemma`: written by the model and checked;
  * `rules`: the model was off or its answer failed a check, so a rule-based reply was used. Show it the same way;
  * `escalation`: an urgent message. Show this reply **prominently** (for example in a red banner with
    "Contact the medical officer"), because it asks the person to get help now.
* A reply can take several seconds when Gemma is running on a laptop, so show a typing indicator.
* Messages are at most 1000 characters (422 otherwise).

## Showing past conversations

```
GET /api/v1/wellbeing/conversations                 → list (newest first; flagged first)
GET /api/v1/wellbeing/conversations/{id}            → all messages, oldest first
```

## Medical officer view (persona `medical_officer`)

* `GET /api/v1/wellbeing/conversations?flagged=true` lists conversations needing follow-up. Show a count
  badge on their dashboard.
* Opening a conversation shows every message plus, on each reply:
  * `facts.shown_to_model`: what the model was given;
  * `facts.all`: the astronaut's full picture;
  * `check_problems`: why a model answer was replaced, if it was.

  Note that every opening is recorded in the audit log.
* After following up: `POST /api/v1/wellbeing/conversations/{id}/review` with `{"note": "…"}`.

## Who sees what
| Persona | Can |
|---|---|
| Astronaut | Chat; see only their own conversations |
| Medical officer | See every conversation and its facts; review flagged ones; cannot chat |
| Mission leader, researcher | Nothing here (403) |
