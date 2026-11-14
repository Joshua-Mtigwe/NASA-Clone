"""AEGIS backend entry point.

Run:  uvicorn app.main:app --reload
Docs: http://127.0.0.1:8000/docs
"""
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api import (admin, ai, assessments, auth, demo, environment, health, missions, planning, recovery, research,
                     simulation, sync, websocket, wellbeing)
from app.core.config import get_settings
from app.core.errors import AuthenticationFailed, ServiceError
from app.database.session import connect, init_schema

API_PREFIX = "/api/v1"


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Create tables if this is a fresh database. Seeding is a separate step: scripts/import_csvs.py
    conn = connect()
    try:
        init_schema(conn)
    finally:
        conn.close()
    yield


app = FastAPI(
    title="AEGIS Backend",
    version="0.1.0",
    description=("Crew health-aware mission planning prototype. All crew data is synthetic demo data. "
                 "Open demo mode (default): no sign-in. Choose a persona from GET /api/v1/personas and send it "
                 "as the X-AEGIS-User header (use Authorize above); without it you act as the mission leader."),
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=list(get_settings().cors_origins),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(ServiceError)
async def service_error_handler(request: Request, exc: ServiceError):
    headers = {"WWW-Authenticate": "Bearer"} if isinstance(exc, AuthenticationFailed) else None
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": exc.code, "message": exc.message, "details": exc.details},
        headers=headers,
    )


@app.get("/health", tags=["health"])
def health_check():
    return {"status": "ok"}


for router in (auth.personas_router, auth.router, demo.router, missions.router, simulation.router, health.router, environment.router,
               assessments.router, planning.router, recovery.router, research.router, ai.router, wellbeing.router, sync.router, admin.router,
               websocket.router):
    app.include_router(router, prefix=API_PREFIX)
