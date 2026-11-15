from pydantic import BaseModel, Field


class ChatMessageIn(BaseModel):
    message: str = Field(min_length=1, max_length=1000, description="How you feel right now, in your own words")
    conversation_id: str | None = Field(None, description="Continue a conversation; leave out to start a new one")
    simulation_run_id: str | None = Field(None, description="Whose mission clock to use. Default: RUN-DEMO-001")


class ReviewIn(BaseModel):
    note: str = Field(min_length=1, max_length=500, description="What follow-up was done")


class ShareIn(BaseModel):
    shared: bool = Field(True, description="true = let the medical officer read it; false = make it private again")


class AcknowledgeIn(BaseModel):
    note: str = Field(min_length=1, max_length=500, description="What follow-up was done")


class JournalEntryIn(BaseModel):
    text: str = Field(min_length=1, max_length=4000, description="Your journal entry, in your own words")
    simulation_run_id: str | None = Field(None, description="Whose mission clock to use. Default: RUN-DEMO-001")


class ConsentIn(BaseModel):
    research_consent: bool = Field(description="true = my journal THEMES (never text) may be counted in "
                                               "crew-level research figures")


class DemoEntriesIn(BaseModel):
    days: int = Field(14, ge=1, le=90, description="How many days before 'now' to fill")
    simulation_run_id: str | None = None
