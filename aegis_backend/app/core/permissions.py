"""Role names (from roles.csv) and which roles may do what.

Change access rules here rather than inside individual routes.
"""

ASTRONAUT = "astronaut"
MISSION_LEADER = "mission_leader"
MEDICAL_RESEARCHER = "medical_researcher"
MEDICAL_OFFICER = "medical_officer"

ALL_ROLES = (ASTRONAUT, MISSION_LEADER, MEDICAL_RESEARCHER, MEDICAL_OFFICER)

# Roles that may see every astronaut's records. An astronaut sees only their own.
CREW_WIDE_ROLES = (MISSION_LEADER, MEDICAL_RESEARCHER, MEDICAL_OFFICER)

# Create, start, pause, change speed of, or jump a simulation run.
SIMULATION_CONTROL_ROLES = (MISSION_LEADER,)

# Import status, provenance registry, audit log.
ADMIN_READ_ROLES = (MISSION_LEADER, MEDICAL_OFFICER)

# The admin crew-health views: every astronaut's health data and how it has changed,
# plus sensor data-quality checks. Viewing the crew-wide changes is written to audit_logs.
HEALTH_ADMIN_ROLES = (MISSION_LEADER, MEDICAL_OFFICER)

# Research (Phase 5). Staff may read analyses, results, charts and reports.
RESEARCH_READ_ROLES = CREW_WIDE_ROLES
# Define analyses, run analysis jobs, draft reports, evaluate planning effectiveness.
RESEARCH_RUN_ROLES = (MEDICAL_RESEARCHER,)
# Approve or reject a draft report. A reviewer can never review a report on a job they ran.
REPORT_REVIEW_ROLES = (MEDICAL_OFFICER,)

# Recovery planner: generate, approve, reject and book recovery recommendations, and record outcomes
# for anyone. An astronaut can always record the outcome of their own booked recovery.
RECOVERY_PLAN_ROLES = (MEDICAL_OFFICER,)

# Create missions, register users and astronauts, deactivate accounts, reset passwords.
# There is no open sign-up: an account's role decides who can read the crew's medical data.
USER_ADMIN_ROLES = (MISSION_LEADER,)

# Phase 6 (AI). Asking the model to explain something follows who owns that decision.
AI_TASK_EXPLAIN_ROLES = (MISSION_LEADER,)
AI_RECOVERY_EXPLAIN_ROLES = RECOVERY_PLAN_ROLES
AI_REPORT_ROLES = RESEARCH_RUN_ROLES
