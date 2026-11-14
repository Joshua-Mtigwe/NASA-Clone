from pydantic import BaseModel, Field


class ChatMessageIn(BaseModel):
    message: str = Field(min_length=1, max_length=1000, description="How you feel right now, in your own words")
    conversation_id: str | None = Field(None, description="Continue a conversation; leave out to start a new one")
    simulation_run_id: str | None = Field(None, description="Whose mission clock to use. Default: RUN-DEMO-001")


class ReviewIn(BaseModel):
    note: str = Field(min_length=1, max_length=500, description="What follow-up was done")
