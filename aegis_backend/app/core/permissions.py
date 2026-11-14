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
