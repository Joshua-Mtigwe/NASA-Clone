from typing import Literal

from pydantic import BaseModel, Field


class SyncEventIn(BaseModel):
    client_event_id: str = Field(min_length=1, max_length=100, description="Unique per device; resending is safe")
    entity_type: Literal["task_assignment", "scheduled_recovery"]
    entity_id: str = Field(min_length=1, max_length=100)
    action: str = Field(description="task_assignment: start | complete | skip. "
                                    "scheduled_recovery: completed | skipped")
    at: str | None = Field(None, description="Mission time (ISO-8601 UTC) when it happened on the device")
    base_version: str | None = Field(None, max_length=64, description="sync_version the device last saw "
                                     "(from /sync/pull). Leave empty to build on this device's previous event "
                                     "for the same record.")
    payload: dict[str, str] = Field(default_factory=dict, description="reason (task skip) or feedback (recovery)")


class SyncBatchIn(BaseModel):
    device_id: str = Field(min_length=1, max_length=100)
    events: list[SyncEventIn] = Field(min_length=1, max_length=200)


class ResolveConflictIn(BaseModel):
    resolution: Literal["keep_server", "reapply"]
    notes: str = Field(min_length=1, max_length=500)
